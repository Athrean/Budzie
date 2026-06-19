import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildReceipt, renderReceipt } from "../src/builder.mjs";

/** Absolute path to the CLI under test. */
const CLI = fileURLToPath(new URL("../src/builder.mjs", import.meta.url));

/**
 * Create a throwaway directory tree and clean it up after `fn` runs.
 * @param {(root: string) => Promise<void> | void} fn
 */
async function withTree(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "budzie-builder-"));
  try {
    await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Write a build with three markers: one full (trigger + dep avoided), one with
 * a trigger only, one bare (no trigger). => markers 3, noUpgrade 1, deps 1.
 * @param {string} root
 */
function writeBuild(root) {
  writeFileSync(
    path.join(root, "feature.js"),
    [
      "export const f = 1;",
      "// budzie: stdlib path module, no dep; upgrade when paths get exotic",
      "// budzie: in-memory map; swap for a store when entries outlive the process",
      "// budzie: skip the retry wrapper",
    ].join("\n") + "\n"
  );
}

/**
 * Write a local budget config under `.budzie/budget.json`.
 * @param {string} root
 * @param {{ ceiling: number, mode: "warn" | "stop", warnAt?: number }} cfg
 */
function writeBudget(root, cfg) {
  mkdirSync(path.join(root, ".budzie"), { recursive: true });
  writeFileSync(
    path.join(root, ".budzie", "budget.json"),
    JSON.stringify({ ceiling: cfg.ceiling, unit: "tokens", warnAt: cfg.warnAt ?? 0.8, mode: cfg.mode })
  );
}

test("receipt counts written lines, markers, and deps avoided", async () => {
  await withTree(async (root) => {
    writeBuild(root);
    const r = await buildReceipt(root, { written: 12 });

    assert.equal(r.kind, "build_run");
    assert.equal(r.linesWritten, 12, "written count is passed through verbatim");
    assert.equal(r.shortcutMarkers, 3);
    assert.equal(r.markersMissingUpgradeTrigger, 1);
    assert.equal(r.depsAvoided, 1);
  });
});

test("no budget config => ok, ceiling unknown", async () => {
  await withTree(async (root) => {
    writeBuild(root);
    const r = await buildReceipt(root, { written: 5, estimate: 999 });
    assert.equal(r.budgetStatus, "ok");
    assert.match(r.budget.reason, /no budget ceiling/);
  });
});

test("estimate over a stop-mode ceiling halts the build", async () => {
  await withTree(async (root) => {
    writeBuild(root);
    writeBudget(root, { ceiling: 100, mode: "stop" });
    const r = await buildReceipt(root, { written: 5, estimate: 150 });
    assert.equal(r.budgetStatus, "stop");
    assert.match(r.budget.reason, /exceeds budget/);
  });
});

test("estimate over a warn-mode ceiling warns, does not stop", async () => {
  await withTree(async (root) => {
    writeBuild(root);
    writeBudget(root, { ceiling: 100, mode: "warn" });
    const r = await buildReceipt(root, { written: 5, estimate: 150 });
    assert.equal(r.budgetStatus, "warn");
  });
});

test("renderReceipt leads with counted figures and shows the budget verdict", async () => {
  await withTree(async (root) => {
    writeBuild(root);
    const card = renderReceipt(await buildReceipt(root, { written: 9 }));
    assert.match(card, /lines written\s+9 \(real local count\)/);
    assert.match(card, /shortcut markers\s+3/);
    assert.match(card, /status\s+ok/);
  });
});

test("CLI --json emits receipt; exit code 2 on a stop verdict", async () => {
  await withTree(async (root) => {
    writeBuild(root);
    writeBudget(root, { ceiling: 100, mode: "stop" });

    // Under ceiling: exit 0, json receipt.
    const ok = execFileSync(
      process.execPath,
      [CLI, root, "--written", "8", "--estimate", "50", "--json"],
      { encoding: "utf8" }
    );
    const parsed = JSON.parse(ok);
    assert.equal(parsed.linesWritten, 8);
    assert.equal(parsed.budgetStatus, "ok");

    // Over ceiling in stop mode: process exits 2.
    let code = 0;
    try {
      execFileSync(process.execPath, [CLI, root, "--written", "8", "--estimate", "150"], {
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (err) {
      code = /** @type {{ status?: number }} */ (err).status ?? -1;
    }
    assert.equal(code, 2, "stop verdict exits 2");
  });
});

test("CLI rejects a negative --written", () => {
  assert.throws(() =>
    execFileSync(process.execPath, [CLI, "--written", "-3"], { encoding: "utf8", stdio: "pipe" })
  );
});
