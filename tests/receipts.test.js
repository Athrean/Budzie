import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { tally, renderCard, renderBadge } from "../scripts/receipts.mjs";

/** Absolute path to the CLI under test. */
const CLI = fileURLToPath(new URL("../scripts/receipts.mjs", import.meta.url));

/**
 * Create a throwaway directory tree and clean it up after `fn` runs.
 * @param {(root: string) => Promise<void> | void} fn
 */
async function withTree(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "budzie-receipts-"));
  try {
    await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Write a fixture repo with a known, hand-counted set of markers.
 *
 * Markers (6 total budzie lines):
 *   1. with trigger,    dep avoided (stdlib)
 *   2. with trigger,    no dep
 *   3. no trigger,      dep avoided (native)
 *   4. no trigger,      no dep
 *   5. no trigger,      no dep
 *   6. with trigger,    no dep
 * Plus two non-marker lines that must be ignored.
 *
 * => markers: 6, noUpgradeTrigger: 3, depsAvoided: 2
 * @param {string} root
 */
function writeFixture(root) {
  mkdirSync(path.join(root, "src"));
  writeFileSync(
    path.join(root, "src", "a.js"),
    [
      "// budzie: stdlib path parse, upgrade to URL API once it lands",
      "// budzie: shrink the config surface upgrade later",
      "const ok = 1; // ordinary comment, not a marker",
    ].join("\n") + "\n"
  );
  writeFileSync(
    path.join(root, "src", "b.py"),
    [
      "# budzie: native http client, no requests",
      "# budzie: skip retry layer for now",
      "x = 2  # plain comment",
    ].join("\n") + "\n"
  );
  writeFileSync(
    path.join(root, "README.md"),
    [
      "<!-- budzie: delete this stub list -->",
      "<!-- budzie: yagni pagination, add upgrade trigger if needed -->",
    ].join("\n") + "\n"
  );
}

test("tally returns the three real counts over a fixture repo", async () => {
  await withTree(async (root) => {
    writeFixture(root);
    const counts = await tally(root);
    assert.deepEqual(counts, {
      markers: 6,
      noUpgradeTrigger: 3,
      depsAvoided: 2,
    });
  });
});

test("tally yields zero counts for a repo with no markers", async () => {
  await withTree(async (root) => {
    writeFileSync(path.join(root, "clean.js"), "export const n = 1;\n");
    const counts = await tally(root);
    assert.deepEqual(counts, {
      markers: 0,
      noUpgradeTrigger: 0,
      depsAvoided: 0,
    });
  });
});

test("renderCard shows all three real counts", () => {
  const card = renderCard({ markers: 6, noUpgradeTrigger: 3, depsAvoided: 2 });
  assert.match(card, /6/);
  assert.match(card, /3/);
  assert.match(card, /2/);
  assert.ok(card.includes("\n"), "card should be multi-line");
});

test("renderBadge embeds all three counts in a shields.io url", () => {
  const badge = renderBadge({ markers: 6, noUpgradeTrigger: 3, depsAvoided: 2 });
  assert.match(badge, /^https:\/\/img\.shields\.io\/badge\/budzie-/);
  assert.match(badge, /6%20markers/);
  assert.match(badge, /3%20no%20upgrade/);
  assert.match(badge, /2%20deps/);
});

test("--json prints the documented Counts shape", async () => {
  await withTree(async (root) => {
    writeFixture(root);
    const out = execFileSync("node", [CLI, "--json", root], {
      encoding: "utf8",
    });
    assert.deepEqual(JSON.parse(out), {
      markers: 6,
      noUpgradeTrigger: 3,
      depsAvoided: 2,
    });
  });
});

test("--badge prints a badge string containing the counts", async () => {
  await withTree(async (root) => {
    writeFixture(root);
    const out = execFileSync("node", [CLI, "--badge", root], {
      encoding: "utf8",
    }).trim();
    assert.equal(out, renderBadge({ markers: 6, noUpgradeTrigger: 3, depsAvoided: 2 }));
  });
});

test("default invocation prints the card with the counts", async () => {
  await withTree(async (root) => {
    writeFixture(root);
    const out = execFileSync("node", [CLI, root], { encoding: "utf8" });
    assert.match(out, /6/);
    assert.match(out, /3/);
    assert.match(out, /2/);
  });
});
