import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { compressFile, compressMarkdown, renderReport } from "../scripts/compress.mjs";
import { writeLevel } from "../scripts/intensity.mjs";

const CLI = fileURLToPath(new URL("../scripts/compress.mjs", import.meta.url));
const LEVELS = /** @type {const} */ (["low", "medium", "xhigh", "ultra"]);

/**
 * Run `fn` inside a throwaway directory and remove it afterwards.
 * @param {(root: string) => void | Promise<void>} fn
 */
async function withTree(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "budzie-compress-"));
  try {
    await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function proseMemory() {
  return [
    "# Agent Memory",
    "",
    "Please remember that you should always make sure to keep the implementation very small and carefully prefer the standard library whenever possible.",
    "It is important to preserve exact commands because other agents will copy them into their own sessions.",
    "",
  ].join("\n");
}

test("dry run reports estimated token counts without writing", async () => {
  await withTree(async (root) => {
    const target = path.join(root, "CLAUDE.md");
    const original = proseMemory();
    writeFileSync(target, original);

    const result = compressFile(target, {
      dryRun: true,
      env: { BUDZIE_DATA_DIR: root },
    });

    assert.equal(readFileSync(target, "utf8"), original);
    assert.equal(existsSync(target + ".bak"), false);
    assert.equal(result.applied, false);
    assert.equal(result.backup, null);
    assert.ok(result.tokensBefore > result.tokensAfter);

    const report = renderReport(result);
    assert.match(report, /tokens before\s+\d+ \(ESTIMATE\)/);
    assert.match(report, /tokens after\s+\d+ \(ESTIMATE\)/);
  });
});

test("default run rewrites the file in place with a .bak backup", async () => {
  await withTree(async (root) => {
    const target = path.join(root, "AGENTS.md");
    const original = proseMemory();
    writeFileSync(target, original);

    const result = compressFile(target, { env: { BUDZIE_DATA_DIR: root } });

    assert.equal(result.applied, true);
    assert.equal(result.backup, target + ".bak");
    assert.equal(readFileSync(target + ".bak", "utf8"), original);
    assert.notEqual(readFileSync(target, "utf8"), original);
    assert.ok(result.tokensAfter < result.tokensBefore);
  });
});

test("compression preserves code blocks, URLs, paths, API names, and exact errors", () => {
  const codeBlock = [
    "```js",
    "const   value   =   runBudgetCheck();",
    "```",
  ].join("\n");
  const source = [
    "# Memory",
    "",
    "Please make sure to open scripts/lib/scan.mjs and https://example.com/docs before changing OpenAIClient.",
    "Keep the exact error string \"TypeError: Cannot read property userId\" in the notes.",
    "",
    codeBlock,
    "",
  ].join("\n");

  const out = compressMarkdown(source, "ultra");

  assert.ok(out.includes(codeBlock), "fenced code block must survive byte-for-byte");
  assert.ok(out.includes("https://example.com/docs"), "URL must survive byte-for-byte");
  assert.ok(out.includes("scripts/lib/scan.mjs"), "path must survive byte-for-byte");
  assert.ok(out.includes("OpenAIClient"), "API name must survive byte-for-byte");
  assert.ok(
    out.includes("\"TypeError: Cannot read property userId\""),
    "exact error string must survive byte-for-byte"
  );
});

test("compression preserves CLI commands, identifiers, and localized errors byte-for-byte", () => {
  const command = "npm   run test -- --grep=usuario";
  const call = "fetchUser( userId, APIClient )";
  const exactError = "\"Erreur: la connexion est refusée\"";
  const inline = "`git status --short`";
  const source = [
    `Por favor ejecuta ${command}`,
    `Después llama ${call} en src/usuarios/api-client.mjs.`,
    `Conserva exactamente ${exactError}.`,
    `No cambies ${inline}.`,
    "",
  ].join("\n");

  const out = compressMarkdown(source, "ultra");

  for (const span of [command, call, exactError, inline]) {
    assert.ok(out.includes(span), `protected span changed: ${span}`);
  }
});

test("Spanish filler is removed at every intensity without switching languages", () => {
  const source =
    "Por favor, realmente asegúrate de mantener la implementación pequeña y conservar la biblioteca estándar.\n";

  for (const level of LEVELS) {
    const out = compressMarkdown(source, level);

    assert.doesNotMatch(out, /\b(?:por favor|realmente|asegúrate de)\b/i);
    assert.match(out, /\bmantener\b/i);
    assert.match(out, /\bconservar\b/i);
    assert.match(out, /\bbiblioteca estándar\b/i);
    assert.doesNotMatch(out, /\b(?:please|make sure|remember to)\b/i);
  }
});

test("Portuguese hedging is removed at every intensity without switching languages", () => {
  const source =
    "Por favor, na verdade, realmente certifique-se de manter a implementação pequena e preservar a biblioteca padrão.\n";

  for (const level of LEVELS) {
    const out = compressMarkdown(source, level);

    assert.doesNotMatch(
      out,
      /\b(?:por favor|na verdade|realmente|certifique-se de)\b/i
    );
    assert.match(out, /\bmanter\b/i);
    assert.match(out, /\bpreservar\b/i);
    assert.match(out, /\bbiblioteca padrão\b/i);
    assert.doesNotMatch(out, /\b(?:please|make sure|remember to)\b/i);
  }
});

test("French filler is removed at every intensity without switching languages", () => {
  const source =
    "S'il vous plaît, en fait, assurez-vous de garder l'implémentation petite et préserver la bibliothèque standard.\n";

  for (const level of LEVELS) {
    const out = compressMarkdown(source, level);

    assert.doesNotMatch(
      out,
      /\b(?:s['’]il vous plaît|en fait|assurez-vous de)\b/i
    );
    assert.match(out, /\bgarder\b/i);
    assert.match(out, /\bpréserver\b/i);
    assert.match(out, /\bbibliothèque standard\b/i);
    assert.doesNotMatch(out, /\b(?:please|make sure|remember to)\b/i);
  }
});

test("intensity increases compression in Spanish, Portuguese, and French", () => {
  const cases = [
    {
      source:
        "Realmente mantener la implementación y conservar los términos es importante en su contexto.\n",
      marker: "mantener",
    },
    {
      source:
        "Realmente manter a implementação e preservar os termos é importante em seu contexto.\n",
      marker: "manter",
    },
    {
      source:
        "Vraiment garder la mise en œuvre et préserver les termes est important dans leur contexte.\n",
      marker: "garder",
    },
  ];

  for (const { source, marker } of cases) {
    const low = compressMarkdown(source, "low");
    const medium = compressMarkdown(source, "medium");
    const xhigh = compressMarkdown(source, "xhigh");
    const ultra = compressMarkdown(source, "ultra");

    assert.ok(medium.length < low.length, `${marker}: medium should beat low`);
    assert.ok(xhigh.length < medium.length, `${marker}: xhigh should beat medium`);
    assert.ok(ultra.length < xhigh.length, `${marker}: ultra should beat xhigh`);
    for (const out of [low, medium, xhigh, ultra]) {
      assert.match(out, new RegExp(`\\b${marker}\\b`, "i"));
      assert.doesNotMatch(out, /\b(?:please|make sure|remember to)\b/i);
    }
  }
});

test("current intensity controls compression strength", async () => {
  await withTree(async (root) => {
    const lowFile = path.join(root, "low.md");
    const ultraFile = path.join(root, "ultra.md");
    const body = proseMemory() + proseMemory() + proseMemory();
    writeFileSync(lowFile, body);
    writeFileSync(ultraFile, body);

    writeLevel("low", { BUDZIE_DATA_DIR: root });
    const low = compressFile(lowFile, {
      dryRun: true,
      env: { BUDZIE_DATA_DIR: root },
    });
    writeLevel("ultra", { BUDZIE_DATA_DIR: root });
    const ultra = compressFile(ultraFile, {
      dryRun: true,
      env: { BUDZIE_DATA_DIR: root },
    });

    assert.equal(low.level, "low");
    assert.equal(ultra.level, "ultra");
    assert.ok(ultra.tokensAfter < low.tokensAfter);
  });
});

test("ultra compression clears the >46% target on memory-style prose", async () => {
  await withTree(async (root) => {
    const target = path.join(root, "memory.md");
    const body = Array.from({ length: 8 }, () => proseMemory()).join("\n");
    writeFileSync(target, body);
    writeLevel("ultra", { BUDZIE_DATA_DIR: root });

    const result = compressFile(target, {
      dryRun: true,
      env: { BUDZIE_DATA_DIR: root },
    });

    const saved = result.tokensBefore - result.tokensAfter;
    assert.ok(saved / result.tokensBefore > 0.46);
  });
});

test("CLI --dry-run prints accurate token counts without writing", async () => {
  await withTree(async (root) => {
    const target = path.join(root, "CLAUDE.md");
    const original = proseMemory();
    writeFileSync(target, original);
    writeLevel("xhigh", { BUDZIE_DATA_DIR: root });

    const out = execFileSync("node", [CLI, "--dry-run", "--json", target], {
      env: { ...process.env, BUDZIE_DATA_DIR: root },
      encoding: "utf8",
    });
    const parsed = JSON.parse(out);
    const direct = compressFile(target, {
      dryRun: true,
      env: { BUDZIE_DATA_DIR: root },
    });

    assert.equal(readFileSync(target, "utf8"), original);
    assert.equal(existsSync(target + ".bak"), false);
    assert.equal(parsed.tokensBefore, direct.tokensBefore);
    assert.equal(parsed.tokensAfter, direct.tokensAfter);
    assert.equal(parsed.level, "xhigh");
  });
});

test("command and skill document the compressor entrypoint", () => {
  const command = readFileSync("commands/budzie-compress.toml", "utf8");
  const skill = readFileSync("skills/budzie-compress/SKILL.md", "utf8");

  assert.match(command, /node scripts\/compress\.mjs/);
  assert.match(command, /--dry-run/);
  assert.match(skill, /name: budzie-compress/);
  assert.match(skill, /\.bak/);
  assert.match(skill, /preserv/i);
});
