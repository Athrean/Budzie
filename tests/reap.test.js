import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { plan } from "../scripts/reap.mjs";

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
