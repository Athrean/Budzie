// @ts-check
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { estimateTokens, isContextFile, isSensitivePath } from "./context-receipts.mjs";
import { readLevel, shouldAutoClarify } from "./intensity.mjs";

/**
 * @typedef {import("./intensity.mjs").Level} Level
 */

/**
 * @typedef {object} CompressResult
 * @property {string} file
 * @property {Level} level
 * @property {boolean} applied
 * @property {string | null} backup
 * @property {number} bytesBefore
 * @property {number} bytesAfter
 * @property {number} tokensBefore ESTIMATE: chars / 4 heuristic.
 * @property {number} tokensAfter ESTIMATE: chars / 4 heuristic.
 */

const LEVEL_ORDER = Object.freeze({
  low: 0,
  medium: 1,
  xhigh: 2,
  ultra: 3,
});

const DROP_BY_LEVEL = Object.freeze({
  low: new Set([
    "please",
    "really",
    "very",
    "basically",
    "actually",
    "realmente",
    "vraiment",
  ]),
  medium: new Set([
    "please",
    "really",
    "very",
    "basically",
    "actually",
    "realmente",
    "vraiment",
    "that",
    "just",
    "simply",
    "carefully",
    "the",
    "a",
    "an",
    "el",
    "la",
    "los",
    "las",
    "un",
    "una",
    "unos",
    "unas",
    "o",
    "os",
    "um",
    "uma",
    "uns",
    "umas",
    "le",
    "les",
    "une",
    "des",
    "du",
  ]),
  xhigh: new Set([
    "please",
    "really",
    "very",
    "basically",
    "actually",
    "realmente",
    "vraiment",
    "that",
    "just",
    "simply",
    "carefully",
    "the",
    "a",
    "an",
    "el",
    "la",
    "los",
    "las",
    "un",
    "una",
    "unos",
    "unas",
    "o",
    "os",
    "um",
    "uma",
    "uns",
    "umas",
    "le",
    "les",
    "une",
    "des",
    "du",
    "and",
    "y",
    "e",
    "et",
    "own",
  ]),
  ultra: new Set([
    "please",
    "really",
    "very",
    "basically",
    "actually",
    "realmente",
    "vraiment",
    "that",
    "just",
    "simply",
    "carefully",
    "the",
    "a",
    "an",
    "el",
    "la",
    "los",
    "las",
    "un",
    "una",
    "unos",
    "unas",
    "o",
    "os",
    "um",
    "uma",
    "uns",
    "umas",
    "le",
    "les",
    "une",
    "des",
    "du",
    "and",
    "y",
    "e",
    "et",
    "own",
    "it",
    "is",
    "will",
    "be",
    "into",
    "their",
    "es",
    "en",
    "su",
    "é",
    "em",
    "seu",
    "est",
    "dans",
    "leur",
  ]),
});

/** @type {readonly (readonly [RegExp, string])[]} */
const PHRASES = Object.freeze([
  [/\bmake sure to\b/gi, ""],
  [/\bremember to\b/gi, ""],
  [/\bpor favor\b(?:,\s*)?/gi, ""],
  [/\basegúrate de\b/gi, ""],
  [/\bna verdade\b(?:,\s*)?/gi, ""],
  [/\bcertifique-se de\b/gi, ""],
  [/\bs['’]il vous plaît\b(?:,\s*)?/gi, ""],
  [/\ben fait\b(?:,\s*)?/gi, ""],
  [/\bassurez-vous de\b/gi, ""],
  [/\bin order to\b/gi, "to"],
  [/\bit is important to\b/gi, ""],
  [/\byou should always\b/gi, "always"],
  [/\byou should\b/gi, ""],
  [/\bwhenever possible\b/gi, "when possible"],
]);

/** @type {readonly (readonly [RegExp, string])[]} */
const ABBREVIATIONS = Object.freeze([
  [/\bstandard library\b/gi, "stdlib"],
  [/\bimplementation\b/gi, "impl"],
  [/\bconfiguration\b/gi, "config"],
  [/\bdatabase\b/gi, "DB"],
  [/\bauthentication\b/gi, "auth"],
  [/\brepository\b/gi, "repo"],
  [/\bdependencies\b/gi, "deps"],
  [/\bdependency\b/gi, "dep"],
  [/\bbecause\b/gi, "bc"],
  [/\bwithout\b/gi, "w/o"],
  [/\bwith\b/gi, "w/"],
]);

const PRESERVE_PATTERNS = [
  /`[^`]*`/,
  /"(?:\\.|[^"\\\n])*"/,
  /'(?:[^'\n]*(?:Error|Exception|failed|Cannot|cannot|Erreur|erro|falló|falhou|échoué)[^'\n]*)'/iu,
  /\b(?:npm|pnpm|yarn|bun|npx|node|git|gh|python3?|pip3?|cargo|docker|kubectl|cmake|mvn|gradle|dotnet|java|javac|curl|wget|ssh|scp|rsync|rg)\b(?:[ \t]+[^\s,;!?]+)*/i,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s)]+/i,
  /"(?:[^"\n]*(?:Error|Exception|failed|Cannot|cannot)[^"\n]*)"/,
  /\b[A-Za-z]*(?:Error|Exception):[^\n"`]*/,
  /(?:\.{1,2}\/|\/)[\w./@-]*[\w@-]/,
  /\b[\w-]+(?:\.[\w-]+)+\b/,
  /\b[$A-Za-z_][\w$]*(?:\.[$A-Za-z_][\w$]*)*\([^()\n]*\)/,
  /\b\w+\(\)/,
  /\b\w*[_/]\w[\w/.-]*\b/,
  /\b[A-Z][A-Z0-9_]{2,}\b/,
  /\b[A-Z][A-Za-z0-9]+(?:[A-Z][A-Za-z0-9]+)+\b/,
];

/**
 * @param {Level} level
 * @param {Level} threshold
 * @returns {boolean}
 */
function atLeast(level, threshold) {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[threshold];
}

/**
 * @param {string} text
 * @param {number} from
 * @returns {{ start: number, end: number, value: string } | null}
 */
function nextPreserve(text, from) {
  const slice = text.slice(from);
  /** @type {{ start: number, end: number, value: string } | null} */
  let best = null;
  for (const pattern of PRESERVE_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags.replace("g", ""));
    const match = re.exec(slice);
    if (!match) continue;
    const start = from + match.index;
    if (best === null || start < best.start) {
      best = { start, end: start + match[0].length, value: match[0] };
    }
  }
  return best;
}

/**
 * @param {string} chunk
 * @param {Level} level
 * @returns {string}
 */
function compressPlainChunk(chunk, level) {
  let text = chunk.replace(/[ \t]{2,}/g, " ");
  for (const [pattern, replacement] of PHRASES) {
    text = text.replace(pattern, replacement);
  }
  if (atLeast(level, "xhigh")) {
    for (const [pattern, replacement] of ABBREVIATIONS) {
      text = text.replace(pattern, replacement);
    }
  }

  const drop = DROP_BY_LEVEL[level];
  const out = [];
  for (const token of text.split(/\s+/)) {
    if (!token) continue;
    const bare = token
      .replace(/^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_]+$/gu, "")
      .toLowerCase();
    if (drop.has(bare) && /^[^\p{L}\p{N}_]*\p{L}/u.test(token)) continue;
    out.push(token);
  }
  return out.join(" ").replace(/ +([.,;:!?])(\s|$)/g, "$1$2").trim();
}

/**
 * Compress plain prose while preserving load-bearing spans byte-for-byte.
 * @param {string} text
 * @param {Level} level
 * @returns {string}
 */
function compressPreservingSpans(text, level) {
  const pieces = [];
  let cursor = 0;
  while (cursor < text.length) {
    const hit = nextPreserve(text, cursor);
    if (!hit) {
      pieces.push(compressPlainChunk(text.slice(cursor), level));
      break;
    }
    pieces.push(compressPlainChunk(text.slice(cursor, hit.start), level));
    pieces.push(hit.value);
    cursor = hit.end;
  }
  return pieces.filter((p) => p !== "").join(" ").trim();
}

/**
 * @param {string} line
 * @param {Level} level
 * @returns {string}
 */
function compressLine(line, level) {
  if (/^\s*$/.test(line)) return "";
  if (/^\s{0,3}#{1,6}\s/.test(line)) return line.trimEnd();
  if (shouldAutoClarify(line)) return line.trimEnd();

  const marker = line.match(/^(\s*(?:[-*+]\s+|\d+[.)]\s+|>\s+)?)([\s\S]*)$/);
  const prefix = marker?.[1] ?? "";
  const body = marker?.[2] ?? line;
  const compressed = compressPreservingSpans(body, level);
  return prefix + compressed;
}

/**
 * Compress markdown memory text while keeping fenced blocks untouched.
 * @param {string} text
 * @param {Level} level
 * @returns {string}
 */
export function compressMarkdown(text, level) {
  const pieces = [];
  const fence = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;
  let last = 0;
  for (let match = fence.exec(text); match !== null; match = fence.exec(text)) {
    if (match.index > last) {
      pieces.push(
        text
          .slice(last, match.index)
          .split("\n")
          .map((line) => compressLine(line, level))
          .join("\n")
      );
    }
    pieces.push(match[0]);
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    pieces.push(
      text
        .slice(last)
        .split("\n")
        .map((line) => compressLine(line, level))
        .join("\n")
    );
  }
  return pieces.join("").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/**
 * Compress a natural-language memory file. Default writes in place with a
 * `.bak` backup; `dryRun` returns counts without touching disk.
 * @param {string} file
 * @param {{ dryRun?: boolean, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {CompressResult}
 */
export function compressFile(file, opts = {}) {
  if (isSensitivePath(file) || !isContextFile(file)) {
    throw new Error("refused: not a natural-language context file");
  }

  const level = readLevel(opts.env);
  const original = readFileSync(file, "utf8");
  const compressed = compressMarkdown(original, level);
  const result = {
    file,
    level,
    applied: opts.dryRun !== true,
    backup: /** @type {string | null} */ (opts.dryRun === true ? null : file + ".bak"),
    bytesBefore: Buffer.byteLength(original),
    bytesAfter: Buffer.byteLength(compressed),
    tokensBefore: estimateTokens(original.length),
    tokensAfter: estimateTokens(compressed.length),
  };

  if (opts.dryRun === true) return result;

  writeFileSync(file + ".bak", original, { flag: "wx" });
  writeFileSync(file, compressed);
  return result;
}

/**
 * @param {CompressResult} result
 * @returns {string}
 */
export function renderReport(result) {
  const saved = result.tokensBefore - result.tokensAfter;
  const pct =
    result.tokensBefore === 0 ? 0 : Math.round((saved / result.tokensBefore) * 100);
  const lines = [
    "Budzie memory compressor",
    `  file           ${result.file}`,
    `  level          ${result.level}`,
    `  bytes before   ${result.bytesBefore}`,
    `  bytes after    ${result.bytesAfter}`,
    `  tokens before  ${result.tokensBefore} (ESTIMATE)`,
    `  tokens after   ${result.tokensAfter} (ESTIMATE)`,
    `  tokens saved   ${saved} (${pct}%, ESTIMATE)`,
  ];
  if (result.applied && result.backup) lines.push(`  backup         ${result.backup}`);
  else lines.push("  dry run        no files written");
  return lines.join("\n");
}

/**
 * CLI entry point.
 * @param {string[]} argv
 * @returns {number}
 */
export function main(argv) {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });
  const file = parsed.positionals[0];
  if (!file) {
    process.stderr.write("usage: compress.mjs [--dry-run] [--json] <file>\n");
    return 1;
  }
  const result = compressFile(file, { dryRun: parsed.values["dry-run"] === true });
  process.stdout.write(
    parsed.values.json ? JSON.stringify(result) + "\n" : renderReport(result) + "\n"
  );
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}
