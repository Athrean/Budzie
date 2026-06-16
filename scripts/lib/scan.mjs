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
