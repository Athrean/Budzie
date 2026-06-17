// @ts-check
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveDataDir } from "./hooks/mode-tracker.mjs";

/**
 * Intensity levels, ordered low to high compression. Each maps to a measured
 * reduction band documented in the budzie skill; see issue #46.
 * @typedef {"low" | "medium" | "xhigh" | "ultra"} Level
 */

/** @type {readonly Level[]} */
export const LEVELS = Object.freeze(["low", "medium", "xhigh", "ultra"]);

/** Level used when none is set. */
export const DEFAULT_LEVEL = "medium";

/** Persisted state filename inside the host data dir. */
const LEVEL_FILE = "intensity.json";

/**
 * Resolve the path to the persisted level file.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function levelPath(env = process.env) {
  return path.join(resolveDataDir(env), LEVEL_FILE);
}

/**
 * Read the active intensity level, or {@link DEFAULT_LEVEL} when unset or
 * unreadable. Never throws: a corrupt or missing file degrades to the default.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Level}
 */
export function readLevel(env = process.env) {
  const file = levelPath(env);
  if (!existsSync(file)) return DEFAULT_LEVEL;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return isLevel(parsed?.level) ? parsed.level : DEFAULT_LEVEL;
  } catch {
    return DEFAULT_LEVEL;
  }
}

/**
 * Persist the active intensity level to the host data dir.
 * @param {string} level - Must be one of {@link LEVELS}.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function writeLevel(level, env = process.env) {
  if (!isLevel(level)) {
    throw new Error(`invalid intensity level: ${level} (expected ${LEVELS.join(", ")})`);
  }
  const file = levelPath(env);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ level }) + "\n");
}

/**
 * Type guard for a valid level string.
 * @param {unknown} value
 * @returns {value is Level}
 */
function isLevel(value) {
  return typeof value === "string" && /** @type {readonly string[]} */ (LEVELS).includes(value);
}

/**
 * Destructive / security-sensitive patterns. When any matches, prose must drop
 * to full clarity so a compressed fragment can't hide an irreversible action.
 * budzie: a curated allowlist of well-known foot-guns, not an exhaustive
 * parser; add patterns as real misreads surface.
 * @type {readonly RegExp[]}
 */
const DESTRUCTIVE = Object.freeze([
  /\bdrop\s+(table|database|schema)\b/i,
  /\btruncate\s+table\b/i,
  /\bdelete\s+from\b/i,
  /\brm\s+-\w*[rf]\w*/i,
  /\bgit\s+(push\s+(--force|-f)|reset\s+--hard|clean\s+-\w*f)/i,
  /\bdd\s+if=/i,
  /\bmkfs\b/i,
  /\bchmod\s+-R\b/i,
  /:\(\)\s*\{.*\}\s*;/, // fork bomb
]);

/** Connectives whose removal during compression can flip a step's meaning. */
const CONDITIONAL = /\b(if|unless|otherwise|else|before|after|then)\b/i;

/**
 * Count ordered/bulleted step markers at line starts.
 * @param {string} text
 * @returns {number}
 */
function stepCount(text) {
  const matches = text.match(/^\s*(\d+[.)]|[-*]|step\s+\d+\b)/gim);
  return matches ? matches.length : 0;
}

/**
 * Decide whether the auto-clarity guard should engage for a block of text:
 * compression pauses for destructive/security content and for conditional
 * multi-step sequences where dropping connectives would change the meaning.
 * Pure and zero-network — a text-only predicate.
 * @param {string} text
 * @returns {boolean}
 */
export function shouldAutoClarify(text) {
  if (typeof text !== "string" || text.length === 0) return false;
  if (DESTRUCTIVE.some((re) => re.test(text))) return true;
  if (stepCount(text) >= 2 && CONDITIONAL.test(text)) return true;
  return false;
}

/**
 * CLI entry point.
 *
 *   intensity.mjs get            prints the active level
 *   intensity.mjs set <level>    persists one of: low medium xhigh ultra
 *
 * @param {string[]} argv - Arguments after `node intensity.mjs`.
 * @returns {number} Process exit code.
 */
export function main(argv) {
  const [command = "get", value] = argv;

  if (command === "get") {
    process.stdout.write(readLevel() + "\n");
    return 0;
  }

  if (command === "set") {
    if (value === undefined) {
      process.stderr.write(`set needs a level: ${LEVELS.join(" | ")}\n`);
      return 1;
    }
    writeLevel(value);
    process.stdout.write(value + "\n");
    return 0;
  }

  process.stderr.write(`usage: intensity.mjs get | set <${LEVELS.join("|")}>\n`);
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}
