import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  estimateTokens,
  isSensitivePath,
  isContextFile,
  scanContext,
  rewriteFile,
  renderReport,
  CHARS_PER_TOKEN,
} from "../src/context-receipts.mjs";

/** Absolute path to the CLI under test. */
const CLI = fileURLToPath(new URL("../src/context-receipts.mjs", import.meta.url));

/**
 * Create a throwaway directory tree and clean it up after `fn` runs.
 * @param {(root: string) => Promise<void> | void} fn
 */
async function withTree(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "budzie-context-"));
  try {
    await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("estimateTokens uses the ~4 chars/token heuristic", () => {
  assert.equal(CHARS_PER_TOKEN, 4);
  assert.equal(estimateTokens(0), 0);
  assert.equal(estimateTokens(4), 1);
  assert.equal(estimateTokens(10), 3); // ceil(10/4)
});

test("scanContext reports bytes + ESTIMATE tokens for a natural-language fixture", async () => {
  await withTree(async (root) => {
    const body = "# Memory\n\nRemember to keep things small and cheap.\n";
    writeFileSync(path.join(root, "CLAUDE.md"), body);

    const result = await scanContext(root);

    assert.equal(result.files.length, 1);
    const file = result.files[0];
    assert.equal(file.name, "CLAUDE.md");
    assert.equal(file.bytes, Buffer.byteLength(body));
    assert.equal(file.estimatedTokens, estimateTokens(body.length));
    assert.equal(result.totalBytes, Buffer.byteLength(body));
    assert.equal(result.totalEstimatedTokens, estimateTokens(body.length));
    // The estimate must be labelled and name the tokenizer assumption.
    assert.match(result.tokenizerNote, /ESTIMATE/);
    assert.match(result.tokenizerNote, /chars\/token/);
  });
});

test("sensitive paths are refused by default", async () => {
  await withTree(async (root) => {
    mkdirSync(path.join(root, ".git"));
    writeFileSync(path.join(root, ".git", "config.md"), "secretish\n");
    writeFileSync(path.join(root, ".env"), "TOKEN=abc\n");
    writeFileSync(path.join(root, ".env.local"), "TOKEN=abc\n");
    writeFileSync(path.join(root, "package-lock.json"), "{}\n");
    writeFileSync(path.join(root, "id_rsa"), "PRIVATE KEY\n");
    writeFileSync(path.join(root, "secrets.pem"), "PRIVATE KEY\n");
    // A legitimate context file that should survive the refusal sweep.
    writeFileSync(path.join(root, "AGENTS.md"), "do less\n");

    const result = await scanContext(root);
    const names = result.files.map((f) => f.name);

    assert.deepEqual(names, ["AGENTS.md"]);
    assert.ok(result.refused.includes(".env"));
    assert.ok(result.refused.includes(".env.local"));
    assert.ok(result.refused.includes("package-lock.json"));
    assert.ok(result.refused.includes("id_rsa"));
    assert.ok(result.refused.includes("secrets.pem"));
    // Nothing under .git/ should ever appear, refused or scanned.
    assert.ok(result.refused.every((r) => !r.includes(".git")));
    assert.ok(names.every((n) => !n.includes(".git")));
  });
});

test("isSensitivePath refuses env, keys, lockfiles, and .git contents", () => {
  for (const p of [
    ".env",
    ".env.local",
    ".env.production",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "Cargo.lock",
    "id_rsa",
    "server.key",
    "cert.pem",
    "creds.p12",
    "keystore.jks",
    path.join(".git", "anything.md"),
  ]) {
    assert.equal(isSensitivePath(p), true, `${p} should be sensitive`);
  }
  for (const ok of ["CLAUDE.md", "AGENTS.md", "notes.md", "docs/todo.md"]) {
    assert.equal(isSensitivePath(ok), false, `${ok} should not be sensitive`);
  }
});

test("code/config files are not counted as natural-language context", async () => {
  await withTree(async (root) => {
    writeFileSync(path.join(root, "index.js"), "export const x = 1;\n");
    writeFileSync(path.join(root, "style.css"), "body { margin: 0; }\n");
    writeFileSync(path.join(root, "config.json"), "{}\n");
    writeFileSync(path.join(root, "tsconfig.json"), "{}\n");
    writeFileSync(path.join(root, "Makefile"), "all:\n\techo hi\n");
    writeFileSync(path.join(root, "NOTES.md"), "real context\n");

    const result = await scanContext(root);
    const names = result.files.map((f) => f.name);

    assert.deepEqual(names, ["NOTES.md"]);
    assert.equal(isContextFile("index.js"), false);
    assert.equal(isContextFile("config.json"), false);
    assert.equal(isContextFile("style.css"), false);
    assert.equal(isContextFile("NOTES.md"), true);
    assert.equal(isContextFile("CLAUDE.md"), true);
    assert.equal(isContextFile("AGENTS.md"), true);
    assert.equal(isContextFile("GEMINI.md"), true);
  });
});

test("rewrite preserves code blocks, inline code, URLs, paths, headings and writes a .original backup", async () => {
  await withTree(async (root) => {
    const target = path.join(root, "CLAUDE.md");
    const original = [
      "# Heading One",
      "",
      "Some   prose   with    extra    spaces.",
      "",
      "Use `npm run typecheck` and visit https://example.com/docs for more.",
      "",
      "Edit the file at src/lib/scan.mjs when needed.",
      "",
      "```js",
      "const   x   =   1;   // spacing inside code must survive",
      "```",
      "",
      "## Heading Two",
      "",
      "Trailing prose here.",
      "",
    ].join("\n");
    writeFileSync(target, original);

    const result = rewriteFile(target, { apply: true });

    // A .original backup is written with the exact original bytes.
    const backup = target + ".original";
    assert.ok(existsSync(backup), ".original backup must exist");
    assert.equal(readFileSync(backup, "utf8"), original);

    const rewritten = readFileSync(target, "utf8");

    // Headings preserved verbatim.
    assert.match(rewritten, /^# Heading One$/m);
    assert.match(rewritten, /^## Heading Two$/m);
    // Fenced code block content preserved byte-for-byte (spacing intact).
    assert.match(rewritten, /const   x   =   1;   \/\/ spacing inside code must survive/);
    // Inline code preserved.
    assert.match(rewritten, /`npm run typecheck`/);
    // URL preserved.
    assert.match(rewritten, /https:\/\/example\.com\/docs/);
    // Path preserved.
    assert.match(rewritten, /src\/lib\/scan\.mjs/);

    assert.equal(result.backup, backup);
    assert.equal(result.applied, true);
  });
});

test("rewrite is read-only without an explicit apply flag (dry run, no backup, no write)", async () => {
  await withTree(async (root) => {
    const target = path.join(root, "CLAUDE.md");
    const original = "# Title\n\nbody text\n";
    writeFileSync(target, original);

    const result = rewriteFile(target, { apply: false });

    // File untouched, no backup created.
    assert.equal(readFileSync(target, "utf8"), original);
    assert.ok(!existsSync(target + ".original"), "no backup in dry run");
    assert.equal(result.applied, false);
  });
});

test("renderReport labels every token figure as an ESTIMATE", async () => {
  await withTree(async (root) => {
    writeFileSync(path.join(root, "CLAUDE.md"), "# C\n\nkeep it small\n");
    const result = await scanContext(root);
    const out = renderReport(result);

    assert.match(out, /Budzie context receipts/);
    assert.match(out, /ESTIMATE/);
    assert.match(out, /chars\/token/);
    assert.match(out, /CLAUDE\.md/);
  });
});

test("CLI default run prints a context report; --json prints the scan result", async () => {
  await withTree(async (root) => {
    writeFileSync(path.join(root, "CLAUDE.md"), "# C\n\nkeep it small\n");

    const card = execFileSync("node", [CLI, root], { encoding: "utf8" });
    assert.match(card, /Budzie context receipts/);
    assert.match(card, /ESTIMATE/);

    const json = execFileSync("node", [CLI, "--json", root], { encoding: "utf8" });
    const parsed = JSON.parse(json);
    assert.equal(parsed.totalBytes, Buffer.byteLength("# C\n\nkeep it small\n"));
    assert.equal(parsed.files[0].name, "CLAUDE.md");
  });
});

test("skill documents read-only scanning and the explicit rewrite opt-in", () => {
  const skill = readFileSync("skills/budzie-context/SKILL.md", "utf8");
  assert.match(skill, /name: budzie-context/);
  assert.match(skill, /ESTIMATE/);
  assert.match(skill, /--rewrite/);
  assert.match(skill, /\.original/);
});
