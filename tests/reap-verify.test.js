// @ts-check
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { verify } from "../src/reap.mjs";

/**
 * Stand up a throwaway git repo with the given files committed, and clean it up.
 * @param {Record<string, string>} files
 * @param {(root: string) => void} fn
 */
function withGitRepo(files, fn) {
  const root = mkdtempSync(path.join(tmpdir(), "budzie-reapverify-"));
  try {
    const git = (/** @type {string[]} */ args) =>
      execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@t",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@t",
        },
      });
    git(["init", "-q"]);
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(root, name), content);
    }
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "init"]);
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * @param {string} root
 * @param {string} file
 * @param {number} line
 * @returns {import("../src/reap.mjs").Cut}
 */
function cut(root, file, line) {
  return {
    file: path.join(root, file),
    line,
    tag: /** @type {any} */ ("delete"),
    tier: /** @type {any} */ ("auto"),
    text: "x",
  };
}

// A two-line module: line 1 is dead, line 2 is load-bearing. A test imports it.
const SUM = `export const EXTRA = 1; // budzie: delete unused\nexport function sum(a, b) { return a + b; }\n`;
const TEST = `import { sum } from "./sum.mjs";\nif (sum(1, 2) !== 3) process.exit(1);\n`;

test("verify keeps a green cut and discards a red one, each in its own worktree", () => {
  withGitRepo({ "sum.mjs": SUM, "t.mjs": TEST }, (root) => {
    const green = cut(root, "sum.mjs", 1); // removing EXTRA keeps tests passing
    const red = cut(root, "sum.mjs", 2); // removing sum() breaks the import
    const results = verify([green, red], { root, test: "node t.mjs" });

    assert.equal(results.kept.length, 1);
    assert.equal(results.discarded.length, 1);
    assert.equal(results.kept[0].line, 1);
    assert.equal(results.discarded[0].line, 2);
    assert.equal(results.linesRemoved, 1);
  });
});

test("verify never touches the user's working tree or leaves worktrees behind", () => {
  withGitRepo({ "sum.mjs": SUM, "t.mjs": TEST }, (root) => {
    verify([cut(root, "sum.mjs", 1)], { root, test: "node t.mjs" });

    // The source line is still present in the real tree — only the worktree changed.
    assert.match(readFileSync(path.join(root, "sum.mjs"), "utf8"), /EXTRA = 1/);
    // No leftover worktrees: the main work tree is the only entry.
    const list = execFileSync("git", ["worktree", "list"], { cwd: root, encoding: "utf8" });
    assert.equal(list.trim().split("\n").length, 1);
  });
});

test("verify skips suggest-only cuts and refuses without a test command", () => {
  withGitRepo({ "sum.mjs": SUM, "t.mjs": TEST }, (root) => {
    const suggest = { ...cut(root, "sum.mjs", 1), suggestOnly: /** @type {const} */ (true) };
    const results = verify([suggest], { root, test: "node t.mjs" });
    assert.equal(results.kept.length, 0);
    assert.equal(results.discarded.length, 0);

    assert.throws(() => verify([cut(root, "sum.mjs", 1)], { root, test: "" }), /test command/);
  });
});

test("verify refuses a directory that is not a git work tree", () => {
  const root = mkdtempSync(path.join(tmpdir(), "budzie-nogit-"));
  try {
    assert.throws(() => verify([], { root, test: "true" }), /git work tree/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
