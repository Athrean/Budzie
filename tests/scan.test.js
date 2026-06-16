import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { walk } from "../scripts/lib/scan.mjs";

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
