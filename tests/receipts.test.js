import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { tally } from "../scripts/receipts.mjs";

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
