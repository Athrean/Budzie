// @ts-check
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The tokenizer heuristic: average English text is roughly four characters per
 * token. This is an ESTIMATE only — never a measured token count. Real model
 * tokenizers vary by content and model, so every figure derived from this is
 * labelled `ESTIMATE` in output.
 *
 * budzie: 4 chars/token heuristic, no tokenizer dependency. Ceiling: estimates
 * stay rough. Upgrade trigger: ship a vendored, offline byte-pair table only if
 * a user needs model-accurate counts (would add files + a benchmark snapshot).
 */
export const CHARS_PER_TOKEN = 4;

/**
 * Optional benchmark snapshot version. Cited in output when present, but never
 * a hard dependency — absence does not change behaviour.
 * @type {string | null}
 */
export const BENCHMARK_SNAPSHOT = null;

/** Directories never descended into. */
const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".budzie",
]);

/** Skip files larger than this when reading context (1 MiB). */
const MAX_BYTES = 1024 * 1024;

/**
 * Natural-language memory/instruction filenames recognised regardless of case.
 * These are agent context files, not code.
 */
const CONTEXT_BASENAMES = new Set([
  "claude.md",
  "agents.md",
  "gemini.md",
  "readme.md",
  "todo.md",
  "todos.md",
  "notes.md",
  "memory.md",
  "preferences.md",
  "context.md",
]);

/**
 * Extensions treated as natural-language context. Markdown only — code, config,
 * and data formats are excluded by construction.
 */
const CONTEXT_EXTS = new Set([".md", ".mdx", ".markdown"]);

/** Lockfiles refused by exact basename. */
const LOCKFILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "npm-shrinkwrap.json",
  "cargo.lock",
  "poetry.lock",
  "composer.lock",
  "gemfile.lock",
  "go.sum",
]);

/** Credential/key file extensions refused by suffix. */
const SECRET_EXTS = new Set([
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".jks",
  ".keystore",
  ".crt",
  ".cer",
  ".der",
  ".asc",
  ".gpg",
  ".pgp",
]);

/** Key/credential basenames refused exactly (case-insensitive). */
const SECRET_BASENAMES = new Set([
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  ".npmrc",
  ".netrc",
  ".pypirc",
  "credentials",
  ".htpasswd",
]);

/**
 * @typedef {object} ContextFile
 * @property {string} name - Path relative to the scan root.
 * @property {number} bytes - Real byte size of the file.
 * @property {number} estimatedTokens - ESTIMATE: ceil(chars / CHARS_PER_TOKEN).
 */

/**
 * @typedef {object} ScanResult
 * @property {ContextFile[]} files - Natural-language context files, sorted.
 * @property {number} totalBytes - Sum of real bytes across context files.
 * @property {number} totalEstimatedTokens - ESTIMATE: sum of per-file estimates.
 * @property {string[]} refused - Relative paths refused as sensitive.
 * @property {string} tokenizerNote - Human-readable ESTIMATE label + assumption.
 */

/**
 * @typedef {object} RewriteResult
 * @property {boolean} applied - True when the file was rewritten on disk.
 * @property {string | null} backup - Path to the `.original` backup, or null.
 * @property {number} bytesBefore - Original byte size.
 * @property {number} bytesAfter - Resulting byte size (equals before on dry run).
 */

/**
 * Estimate token count from a character count using the ~4 chars/token
 * heuristic. ESTIMATE only — see {@link CHARS_PER_TOKEN}.
 * @param {number} chars - Number of characters.
 * @returns {number} Estimated tokens, rounded up.
 */
export function estimateTokens(chars) {
  if (chars <= 0) return 0;
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * True when a path is sensitive and must never be read or counted. Covers
 * dotenv files, lockfiles, key/credential files, and anything under `.git/`.
 * @param {string} relPath - Path relative to the scan root (or a bare name).
 * @returns {boolean}
 */
export function isSensitivePath(relPath) {
  const segments = relPath.split(/[/\\]/);
  // Anything inside a `.git` directory is refused outright.
  if (segments.slice(0, -1).includes(".git")) return true;

  const base = segments[segments.length - 1];
  const lower = base.toLowerCase();

  // dotenv: `.env`, `.env.local`, `.env.production`, etc.
  if (lower === ".env" || lower.startsWith(".env.")) return true;

  if (LOCKFILES.has(lower)) return true;
  if (SECRET_BASENAMES.has(lower)) return true;

  const ext = path.extname(lower);
  if (SECRET_EXTS.has(ext)) return true;

  return false;
}

/**
 * True when a path is a natural-language agent context file (markdown memory,
 * todo, or preference file). Code, config, and data files are never context.
 * @param {string} relPath - Path relative to the scan root (or a bare name).
 * @returns {boolean}
 */
export function isContextFile(relPath) {
  if (isSensitivePath(relPath)) return false;
  const base = path.basename(relPath).toLowerCase();
  if (CONTEXT_BASENAMES.has(base)) return true;
  return CONTEXT_EXTS.has(path.extname(base));
}

/**
 * The ESTIMATE label stating the tokenizer assumption (and snapshot if present).
 * @returns {string}
 */
function tokenizerNote() {
  const base = `ESTIMATE: tokens ~= ceil(chars / ${CHARS_PER_TOKEN}); ~${CHARS_PER_TOKEN} chars/token heuristic`;
  return BENCHMARK_SNAPSHOT ? `${base} (snapshot ${BENCHMARK_SNAPSHOT})` : base;
}

/**
 * Recursively collect candidate file paths under `root`, skipping excluded
 * directories and oversized/unreadable files. Never throws for one bad entry.
 * @param {string} root - Scan root.
 * @param {string} dir - Current directory (absolute).
 * @param {string[]} out - Accumulator of absolute file paths.
 */
function collect(root, dir, out) {
  /** @type {string[]} */
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return; // unreadable directory: skip it
  }

  for (const name of entries) {
    const full = path.join(dir, name);

    /** @type {import("node:fs").Stats} */
    let st;
    try {
      st = statSync(full);
    } catch {
      continue; // dangling symlink or vanished entry
    }

    if (st.isDirectory()) {
      if (EXCLUDED_DIRS.has(name)) continue;
      collect(root, full, out);
      continue;
    }

    if (!st.isFile() || st.size > MAX_BYTES) continue;
    out.push(full);
  }
}

/**
 * Read-only scan of `root` for natural-language context files. Refuses
 * sensitive paths and counts only markdown memory/instruction files. Reports
 * real bytes and ESTIMATE tokens.
 * @param {string} root - Directory to scan.
 * @returns {Promise<ScanResult>}
 */
export async function scanContext(root) {
  /** @type {string[]} */
  const candidates = [];
  collect(root, root, candidates);

  /** @type {ContextFile[]} */
  const files = [];
  /** @type {string[]} */
  const refused = [];

  for (const full of candidates) {
    const rel = path.relative(root, full) || path.basename(full);

    if (isSensitivePath(rel)) {
      refused.push(rel);
      continue;
    }
    if (!isContextFile(rel)) continue;

    /** @type {string} */
    let text;
    try {
      text = readFileSync(full, "utf8");
    } catch {
      continue; // unreadable: skip rather than fail the whole scan
    }

    files.push({
      name: rel,
      bytes: Buffer.byteLength(text),
      estimatedTokens: estimateTokens(text.length),
    });
  }

  files.sort((a, b) => a.name.localeCompare(b.name));
  refused.sort((a, b) => a.localeCompare(b));

  const totalBytes = files.reduce((n, f) => n + f.bytes, 0);
  const totalEstimatedTokens = files.reduce((n, f) => n + f.estimatedTokens, 0);

  return {
    files,
    totalBytes,
    totalEstimatedTokens,
    refused,
    tokenizerNote: tokenizerNote(),
  };
}

/**
 * Split markdown into preserved spans (fenced code blocks, inline code, URLs,
 * and filesystem-looking paths) and rewritable prose spans. Each span is a
 * tuple `[preserved, text]`.
 * @param {string} src - Markdown source.
 * @returns {Array<[boolean, string]>}
 */
function tokenizeSpans(src) {
  /** @type {Array<[boolean, string]>} */
  const spans = [];
  // Fenced code blocks, inline code, URLs, then slash- or dot-bearing paths.
  const re =
    /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`]*`|https?:\/\/[^\s)]+|[\w./-]*\/[\w./-]+|[\w-]+\.[A-Za-z][\w]*)/g;

  let last = 0;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    if (m.index > last) spans.push([false, src.slice(last, m.index)]);
    spans.push([true, m[0]]);
    last = m.index + m[0].length;
  }
  if (last < src.length) spans.push([false, src.slice(last)]);
  return spans;
}

/**
 * Collapse runs of spaces/tabs in a prose span without touching newlines or
 * leading indentation that begins a line. Headings (lines starting with `#`)
 * and their structure are preserved because `#` and newlines are untouched.
 * @param {string} text - Prose span.
 * @returns {string}
 */
function tightenProse(text) {
  return text
    .split("\n")
    .map((line) => {
      const indent = line.match(/^[ \t]*/)?.[0] ?? "";
      const rest = line.slice(indent.length).replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/, "");
      return indent + rest;
    })
    .join("\n");
}

/**
 * Rewrite a markdown context file to trim redundant prose whitespace while
 * preserving every code block, inline code span, URL, path, and heading. This
 * is opt-in: with `apply: false` it is a pure read-only dry run that touches
 * nothing on disk. With `apply: true` it writes a `.original` backup first,
 * then the rewritten file.
 *
 * budzie: prose rewrite tightens whitespace only. Ceiling: no semantic
 * summarisation. Upgrade trigger: add a heavier compaction pass only behind a
 * separate flag once preservation here is proven in the field.
 *
 * @param {string} filePath - Absolute path to the markdown file.
 * @param {{ apply?: boolean }} [opts]
 * @returns {RewriteResult}
 */
export function rewriteFile(filePath, opts = {}) {
  const apply = opts.apply === true;
  const original = readFileSync(filePath, "utf8");
  const bytesBefore = Buffer.byteLength(original);

  const rewritten = tokenizeSpans(original)
    .map(([preserved, text]) => (preserved ? text : tightenProse(text)))
    .join("");

  if (!apply) {
    return { applied: false, backup: null, bytesBefore, bytesAfter: bytesBefore };
  }

  // Backup first — data-loss safety. Never overwrite an existing backup.
  const backup = filePath + ".original";
  writeFileSync(backup, original, { flag: "wx" });
  writeFileSync(filePath, rewritten);

  return {
    applied: true,
    backup,
    bytesBefore,
    bytesAfter: Buffer.byteLength(rewritten),
  };
}

/**
 * Render a scan result as a terminal card. Token figures are always labelled
 * `ESTIMATE` and the tokenizer assumption is stated.
 * @param {ScanResult} result
 * @returns {string}
 */
export function renderReport(result) {
  const lines = [
    "Budzie context receipts",
    "  context files       " + result.files.length,
    "  total bytes         " + result.totalBytes + " (real local count)",
    "  est. tokens         " + result.totalEstimatedTokens + " (ESTIMATE)",
  ];

  if (result.files.length > 0) {
    lines.push("");
    lines.push("  file\tbytes\test. tokens");
    for (const f of result.files) {
      lines.push(`  ${f.name}\t${f.bytes}\t${f.estimatedTokens}`);
    }
  }

  if (result.refused.length > 0) {
    lines.push("");
    lines.push("  refused (sensitive): " + result.refused.join(", "));
  }

  lines.push("");
  lines.push("  " + result.tokenizerNote);
  return lines.join("\n");
}

/**
 * CLI entry point. Default prints the report; `--json` prints the raw scan
 * result; `--rewrite <file>` opts into the preserving prose rewrite (writes a
 * `.original` backup). An optional positional arg sets the scan root.
 * @param {string[]} argv - Arguments after `node script.mjs`.
 * @returns {Promise<void>}
 */
export async function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const positional = argv.filter((a) => !a.startsWith("--"));

  if (flags.has("--rewrite")) {
    const target = positional[0];
    if (!target) {
      process.stderr.write("usage: context-receipts.mjs --rewrite <file>\n");
      process.exitCode = 1;
      return;
    }
    if (isSensitivePath(target) || !isContextFile(target)) {
      process.stderr.write("refused: not a natural-language context file\n");
      process.exitCode = 1;
      return;
    }
    const res = rewriteFile(path.resolve(target), { apply: true });
    process.stdout.write(
      `rewrote ${target}: ${res.bytesBefore} -> ${res.bytesAfter} bytes; backup ${res.backup}\n`
    );
    return;
  }

  const root = positional[0] ?? process.cwd();
  const result = await scanContext(root);

  if (flags.has("--json")) {
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  process.stdout.write(renderReport(result) + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(String(err?.stack ?? err) + "\n");
    process.exitCode = 1;
  });
}
