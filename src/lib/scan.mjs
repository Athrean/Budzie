// @ts-check
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * One physical line of one text file.
 * @typedef {object} LineRow
 * @property {string} file - Path to the file the line came from.
 * @property {number} line - 1-based line number within the file.
 * @property {string} text - Line content, without its trailing newline.
 */

/**
 * Options for {@link walk}.
 * @typedef {object} WalkOpts
 * @property {number} [maxBytes] - Skip files larger than this (default 1 MiB).
 * @property {(file: string) => boolean} [exclude] - Skip matching absolute paths before reading.
 */

/**
 * Classification of a single source line as a budzie marker.
 * @typedef {object} Marker
 * @property {boolean} isBudzie - Line is a `budzie:` marker comment.
 * @property {boolean} hasUpgradeTrigger - Marker names an upgrade trigger.
 * @property {boolean} depAvoided - Marker claims a dependency was avoided.
 * @property {CutTag | null} cutTag - First named cut tag, else null.
 * @property {Tier | null} tier - Tier implied by the cut tag, else null.
 */

/**
 * @typedef {"delete" | "stdlib" | "native" | "yagni" | "shrink"} CutTag
 * @typedef {"auto" | "aggressive" | "suggest"} Tier
 */

/** Directories never descended into. */
const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".budzie",
]);

/** Default ceiling for a file we are willing to read line-by-line. */
const DEFAULT_MAX_BYTES = 1024 * 1024;

/** Matches a budzie marker opened by a `#`, `//`, or `<!--` comment. */
const MARKER_RE = /(?:#|\/\/|<!--)\s*budzie:/i;

/** Cut tags in priority order; first match wins. */
const CUT_TAGS = /** @type {const} */ (["delete", "stdlib", "native", "yagni", "shrink"]);

/** @type {Record<CutTag, Tier>} */
const TIER_BY_TAG = {
  delete: "auto",
  stdlib: "auto",
  native: "aggressive",
  yagni: "aggressive",
  shrink: "suggest",
};

/**
 * Heuristic: treat a buffer as binary if it contains a NUL byte in its head.
 * @param {Buffer} buf
 * @returns {boolean}
 */
function looksBinary(buf) {
  const limit = Math.min(buf.length, 8000);
  for (let i = 0; i < limit; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/**
 * Yield every text line under `root`, depth-first.
 *
 * Skips excluded directories, binary files, and files over `maxBytes`.
 * Never throws for a single unreadable entry — it is skipped instead.
 *
 * @param {string} root - Directory to scan.
 * @param {WalkOpts} [opts]
 * @returns {AsyncGenerator<LineRow>}
 */
export async function* walk(root, opts = {}) {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  /** @type {string[]} */
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return; // unreadable directory: skip it
  }

  for (const name of entries) {
    const full = path.join(root, name);
    if (opts.exclude?.(full)) continue;

    /** @type {import("node:fs").Stats} */
    let st;
    try {
      st = statSync(full);
    } catch {
      continue; // dangling symlink or vanished entry
    }

    if (st.isDirectory()) {
      if (EXCLUDED_DIRS.has(name)) continue;
      yield* walk(full, opts);
      continue;
    }

    if (!st.isFile() || st.size > maxBytes) continue;

    /** @type {Buffer} */
    let buf;
    try {
      buf = readFileSync(full);
    } catch {
      continue; // unreadable file: skip it
    }

    if (looksBinary(buf)) continue;

    const lines = buf.toString("utf8").split("\n");
    // Drop a trailing empty element produced by a final newline.
    const count = lines.length > 0 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
    for (let i = 0; i < count; i++) {
      yield { file: full, line: i + 1, text: lines[i] };
    }
  }
}

/**
 * Classify a single source line as a budzie marker.
 * @param {string} text - Raw line content.
 * @returns {Marker}
 */
export function classifyMarker(text) {
  const isBudzie = MARKER_RE.test(text);
  if (!isBudzie) {
    return {
      isBudzie: false,
      hasUpgradeTrigger: false,
      depAvoided: false,
      cutTag: null,
      tier: null,
    };
  }

  const lower = text.toLowerCase();
  const hasUpgradeTrigger = lower.includes("upgrade") || lower.includes("when");
  const depAvoided = lower.includes("native") || lower.includes("stdlib");

  /** @type {CutTag | null} */
  let cutTag = null;
  for (const tag of CUT_TAGS) {
    if (lower.includes(tag)) {
      cutTag = tag;
      break;
    }
  }
  const tier = cutTag ? TIER_BY_TAG[cutTag] : null;

  return { isBudzie, hasUpgradeTrigger, depAvoided, cutTag, tier };
}

/** Manifest filename → test command. First present manifest wins. */
const TEST_COMMAND_BY_MANIFEST = /** @type {const} */ ([
  ["package.json", "npm test"],
  ["pyproject.toml", "pytest"],
  ["setup.cfg", "pytest"],
  ["Cargo.toml", "cargo test"],
  ["go.mod", "go test ./..."],
]);

/**
 * Detect the project's test command from its manifest files.
 * Returns null when no known manifest is present — never guesses.
 * @param {string} root - Project root directory.
 * @returns {string | null}
 */
export function detectTestCommand(root) {
  for (const [manifest, command] of TEST_COMMAND_BY_MANIFEST) {
    try {
      if (statSync(path.join(root, manifest)).isFile()) return command;
    } catch {
      // manifest absent: try the next one
    }
  }
  return null;
}
