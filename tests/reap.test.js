import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { plan, formatReceipt } from "../src/reap.mjs";

/** Absolute path to the CLI under test. */
const CLI = fileURLToPath(new URL("../src/reap.mjs", import.meta.url));

/**
 * Create a throwaway directory tree and clean it up after `fn` runs.
 * @param {(root: string) => Promise<void> | void} fn
 */
async function withTree(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "budzie-reap-"));
  try {
    await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Write a fixture repo with one cut of each relevant tier.
 * @param {string} root
 */
function writeFixture(root) {
  writeFileSync(
    path.join(root, "src.js"),
    [
      "const a = 1;",
      "// budzie: stdlib path module instead of a dep",
      "const b = 2;",
      "// budzie: native fetch, no axios",
      "const c = 3;",
      "// budzie: shrink the config surface",
      "const d = 4;",
    ].join("\n") + "\n"
  );
}

test("plan lists auto + suggest cuts by default, never aggressive", async () => {
  await withTree(async (root) => {
    writeFixture(root);

    const results = await plan(root);
    const tags = results.map((r) => r.tag);

    assert.ok(tags.includes("stdlib"), "auto stdlib cut is listed");
    assert.ok(!tags.includes("native"), "aggressive native cut is not listed");

    const stdlib = results.find((r) => r.tag === "stdlib");
    assert.equal(stdlib?.tier, "auto");
    assert.equal(stdlib?.suggestOnly, undefined);
    assert.equal(path.basename(stdlib?.file ?? ""), "src.js");
    assert.equal(typeof stdlib?.line, "number");
    assert.match(stdlib?.text ?? "", /stdlib/);

    const shrink = results.find((r) => r.tag === "shrink");
    assert.equal(shrink?.tier, "suggest");
    assert.equal(shrink?.suggestOnly, true, "shrink is flagged suggest-only");
  });
});

test("plan with aggressive adds aggressive-tier cuts", async () => {
  await withTree(async (root) => {
    writeFixture(root);

    const results = await plan(root, { aggressive: true });
    const tags = results.map((r) => r.tag);

    assert.ok(tags.includes("stdlib"), "auto cut still listed");
    assert.ok(tags.includes("native"), "aggressive native cut now listed");

    const native = results.find((r) => r.tag === "native");
    assert.equal(native?.tier, "aggressive");
    assert.equal(native?.suggestOnly, undefined);
  });
});

test("plan ranks auto first, then aggressive, then suggest", async () => {
  await withTree(async (root) => {
    writeFixture(root);

    const results = await plan(root, { aggressive: true });
    const tiers = results.map((r) => r.tier);
    const order = { auto: 0, aggressive: 1, suggest: 2 };

    for (let i = 1; i < tiers.length; i++) {
      assert.ok(
        order[tiers[i - 1]] <= order[tiers[i]],
        `tier ${tiers[i - 1]} should not follow ${tiers[i]}`
      );
    }
  });
});

test("plan command prints the default cut plan as json", async () => {
  await withTree(async (root) => {
    writeFixture(root);

    const out = execFileSync("node", [CLI, "plan"], {
      cwd: root,
      encoding: "utf8",
    });
    /** @type {Array<{ tag: string }>} */
    const results = JSON.parse(out);

    assert.deepEqual(
      results.map((r) => r.tag),
      ["stdlib", "shrink"]
    );
  });
});

test("receipt formatter renders removed lines, deps, kept, and discarded", () => {
  const receipt = formatReceipt({
    kept: [{ file: "a.js" }, { file: "b.js" }],
    discarded: [{ file: "c.js" }],
    linesRemoved: 12,
    depsRemoved: 1,
  });

  assert.equal(receipt, "-12 lines, -1 deps, 2 cuts kept, 1 discarded");
});

test("receipt command reads results json from stdin", () => {
  const out = execFileSync("node", [CLI, "receipt"], {
    encoding: "utf8",
    input: JSON.stringify({
      kept: [{ file: "a.js" }],
      discarded: [],
      linesRemoved: 7,
      depsRemoved: 0,
    }),
  }).trim();

  assert.equal(out, "-7 lines, -0 deps, 1 cuts kept, 0 discarded");
});

test("reaper skill and command drive the loop through reap.mjs", () => {
  const skill = readFileSync("skills/budzie-reap/SKILL.md", "utf8");
  const command = readFileSync("commands/budzie-reap.toml", "utf8");

  for (const text of [skill, command]) {
    assert.match(text, /node src\/reap\.mjs plan/);
    assert.match(text, /node src\/reap\.mjs receipt/);
    assert.match(text, /no files changed/i);
    assert.match(text, /explicitly approves/i);
  }
});
