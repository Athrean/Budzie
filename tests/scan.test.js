import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { walk, classifyMarker } from "../scripts/lib/scan.mjs";

/**
 * Create a throwaway directory tree and clean it up after `fn` runs.
 * @param {(root: string) => Promise<void> | void} fn
 */
async function withTree(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "budzie-scan-"));
  try {
    await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Collect an async iterable into an array.
 * @template T
 * @param {AsyncIterable<T>} iter
 * @returns {Promise<T[]>}
 */
async function collect(iter) {
  /** @type {T[]} */
  const out = [];
  for await (const item of iter) out.push(item);
  return out;
}

test("walk yields included lines with 1-based line numbers", async () => {
  await withTree(async (root) => {
    writeFileSync(path.join(root, "a.txt"), "first\nsecond\nthird\n");

    const rows = await collect(walk(root));
    const a = rows.filter((r) => path.basename(r.file) === "a.txt");

    assert.deepEqual(
      a.map((r) => [r.line, r.text]),
      [
        [1, "first"],
        [2, "second"],
        [3, "third"],
      ]
    );
  });
});

test("walk skips excluded directories", async () => {
  await withTree(async (root) => {
    for (const dir of [
      ".git",
      "node_modules",
      "dist",
      "build",
      "coverage",
      ".budzie",
    ]) {
      mkdirSync(path.join(root, dir));
      writeFileSync(path.join(root, dir, "skip.txt"), "should not appear\n");
    }
    writeFileSync(path.join(root, "keep.txt"), "kept\n");

    const rows = await collect(walk(root));

    assert.ok(rows.some((r) => path.basename(r.file) === "keep.txt"));
    assert.ok(
      rows.every((r) => path.basename(r.file) !== "skip.txt"),
      "no excluded-dir files should be yielded"
    );
  });
});

test("walk survives an unreadable / binary file", async () => {
  await withTree(async (root) => {
    // NUL byte marks this as binary; it must be skipped, not crash the walk.
    writeFileSync(path.join(root, "binary.bin"), Buffer.from([0, 1, 2, 0, 255]));
    writeFileSync(path.join(root, "text.txt"), "ok\n");

    const rows = await collect(walk(root));

    assert.ok(rows.some((r) => path.basename(r.file) === "text.txt"));
    assert.ok(rows.every((r) => path.basename(r.file) !== "binary.bin"));
  });
});

test("classifyMarker recognises a budzie marker with an upgrade trigger", () => {
  const m = classifyMarker("// budzie: delete this when we add a real parser");
  assert.equal(m.isBudzie, true);
  assert.equal(m.hasUpgradeTrigger, true);
  assert.equal(m.cutTag, "delete");
  assert.equal(m.tier, "auto");
});

test("classifyMarker flags a budzie marker without a trigger", () => {
  const m = classifyMarker("# budzie: shrink the config surface");
  assert.equal(m.isBudzie, true);
  assert.equal(m.hasUpgradeTrigger, false);
  assert.equal(m.cutTag, "shrink");
  assert.equal(m.tier, "suggest");
});

test("classifyMarker detects native/stdlib dep-avoided markers", () => {
  const native = classifyMarker("<!-- budzie: native fetch, no axios -->");
  assert.equal(native.depAvoided, true);
  assert.equal(native.cutTag, "native");
  assert.equal(native.tier, "aggressive");

  const stdlib = classifyMarker("// BUDZIE: stdlib path module instead of a dep");
  assert.equal(stdlib.depAvoided, true);
  assert.equal(stdlib.cutTag, "stdlib");
  assert.equal(stdlib.tier, "auto");
});

test("classifyMarker maps each cut tag to its tier", () => {
  /** @type {Array<[string, string, string]>} */
  const cases = [
    ["// budzie: delete", "delete", "auto"],
    ["// budzie: stdlib", "stdlib", "auto"],
    ["// budzie: native", "native", "aggressive"],
    ["// budzie: yagni", "yagni", "aggressive"],
    ["// budzie: shrink", "shrink", "suggest"],
  ];
  for (const [text, cutTag, tier] of cases) {
    const m = classifyMarker(text);
    assert.equal(m.cutTag, cutTag, `cutTag for ${text}`);
    assert.equal(m.tier, tier, `tier for ${text}`);
  }
});

test("classifyMarker ignores a non-marker line", () => {
  const m = classifyMarker("const x = 1; // just a normal comment");
  assert.equal(m.isBudzie, false);
  assert.equal(m.hasUpgradeTrigger, false);
  assert.equal(m.depAvoided, false);
  assert.equal(m.cutTag, null);
  assert.equal(m.tier, null);
});
