// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  symlinkSync,
  lstatSync,
  statSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { writeFileAtomic } from "../src/lib/atomic-write.mjs";

/**
 * Run `fn` in a fresh temp dir, cleaned up afterward.
 * @param {(dir: string) => void} fn
 */
function inTmp(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "budzie-atomic-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("creates missing parent dirs and writes the content", () => {
  inTmp((dir) => {
    const file = path.join(dir, "nested", "deep", "state.json");
    writeFileAtomic(file, '{"ok":true}\n');
    assert.equal(readFileSync(file, "utf8"), '{"ok":true}\n');
  });
});

test("writes with 0600 permissions", () => {
  inTmp((dir) => {
    const file = path.join(dir, "state.json");
    writeFileAtomic(file, "x");
    // Compare the low 9 permission bits; honor the process umask-independent mode.
    assert.equal(statSync(file).mode & 0o777, 0o600);
  });
});

test("overwrites an existing destination atomically", () => {
  inTmp((dir) => {
    const file = path.join(dir, "state.json");
    writeFileAtomic(file, "old");
    writeFileAtomic(file, "new");
    assert.equal(readFileSync(file, "utf8"), "new");
  });
});

test("a symlinked destination is replaced, not written through", () => {
  inTmp((dir) => {
    const outside = path.join(dir, "outside.txt");
    writeFileSync(outside, "SECRET");
    const link = path.join(dir, "state.json");
    symlinkSync(outside, link);

    writeFileAtomic(link, "owned");

    // The symlink target must be untouched...
    assert.equal(readFileSync(outside, "utf8"), "SECRET");
    // ...and the destination is now a regular file holding the new content.
    assert.equal(lstatSync(link).isSymbolicLink(), false);
    assert.equal(readFileSync(link, "utf8"), "owned");
  });
});

test("leaves no temp files behind", () => {
  inTmp((dir) => {
    const file = path.join(dir, "state.json");
    writeFileAtomic(file, "x");
    const leftovers = readdirSync(dir).filter((n) => n.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
  });
});
