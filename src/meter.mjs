// @ts-check
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatCount } from "./ledger.mjs";
import { readSession, renderReceipt } from "./session.mjs";

/**
 * Real session-token meter. Resolves the live agent transcript and reports the
 * tokens it actually used — real counted figures, never an estimate unless one
 * is explicitly requested. Local file reads only; zero network, zero telemetry.
 */

/**
 * Encode a working directory the way Claude Code names its per-project
 * transcript folder: every "/" and "." becomes "-".
 * e.g. `/Users/x/Desktop/budzie` -> `-Users-x-Desktop-budzie`.
 * @param {string} cwd
 * @returns {string}
 */
export function encodeProjectDir(cwd) {
  return cwd.replace(/[/.]/g, "-");
}

/**
 * Resolve Claude Code's transcripts root: `$CLAUDE_CONFIG_DIR/projects`, else
 * `~/.claude/projects`.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [home]
 * @returns {string}
 */
export function transcriptsRoot(env = process.env, home = homedir()) {
  const configured = env.CLAUDE_CONFIG_DIR;
  const base = configured && configured.trim() !== "" ? configured : path.join(home, ".claude");
  return path.join(base, "projects");
}

/**
 * Find the active session transcript. Resolution order, first hit wins:
 *   1. `explicit` (e.g. a `--session` path), used as-is when it exists.
 *   2. `transcriptPath` (e.g. a Claude Code hook's `transcript_path`).
 *   3. The newest `*.jsonl` under `<transcriptsRoot>/<encoded cwd>`.
 * Returns the resolved path, or `null` when none is found.
 * @param {{ explicit?: string, transcriptPath?: string, cwd?: string, env?: NodeJS.ProcessEnv, home?: string }} [opts]
 * @returns {string | null}
 */
export function findTranscript(opts = {}) {
  const { explicit, transcriptPath } = opts;
  if (typeof explicit === "string" && explicit.trim() !== "" && existsSync(explicit)) {
    return explicit;
  }
  if (
    typeof transcriptPath === "string" &&
    transcriptPath.trim() !== "" &&
    existsSync(transcriptPath)
  ) {
    return transcriptPath;
  }

  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();
  const dir = path.join(transcriptsRoot(env, home), encodeProjectDir(cwd));

  /** @type {string[]} */
  let names;
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return null; // no project transcript dir yet
  }

  /** @type {string | null} */
  let newest = null;
  let newestMtime = -Infinity;
  for (const name of names) {
    const full = path.join(dir, name);
    try {
      const mtime = statSync(full).mtimeMs;
      if (mtime > newestMtime) {
        newestMtime = mtime;
        newest = full;
      }
    } catch {
      // unreadable entry: skip it
    }
  }
  return newest;
}

/**
 * The result of metering a session.
 * @typedef {object} MeterResult
 * @property {string | null} transcript - The resolved transcript path, or null when none was found.
 * @property {import("./session.mjs").SessionUsage | null} usage - Real counted usage, or null when no transcript was found.
 */

/**
 * Resolve the live transcript and read its real counted usage.
 * @param {{ explicit?: string, transcriptPath?: string, cwd?: string, env?: NodeJS.ProcessEnv, estimate?: boolean }} [opts]
 * @returns {MeterResult}
 */
export function meter(opts = {}) {
  const transcript = findTranscript(opts);
  if (!transcript) return { transcript: null, usage: null };
  const usage = readSession(transcript, { estimate: opts.estimate ?? false });
  return { transcript, usage };
}

/**
 * Render a compact statusline segment for the live session, e.g.
 * `session 3.2k out / 18k in`. Returns "" when usage is unknown so the badge
 * never shows a fabricated number.
 * @param {MeterResult} result
 * @returns {string}
 */
export function renderMeterBadge(result) {
  const u = result.usage;
  if (!u || u.tokensSource !== "counted") return "";
  const out = u.outputTokens;
  const inn = u.inputTokens;
  if (out === null && inn === null) return "";
  const parts = [];
  if (out !== null) parts.push(`${formatCount(out)} out`);
  if (inn !== null) parts.push(`${formatCount(inn)} in`);
  return `session ${parts.join(" / ")}`;
}

/**
 * Render the full terminal meter report: the resolved transcript path followed
 * by the session usage receipt, or a plain note when no transcript was found.
 * @param {MeterResult} result
 * @returns {string}
 */
export function renderMeter(result) {
  if (!result.transcript || !result.usage) {
    return "Budzie meter: no session transcript found (pass --session <path> to point at one).";
  }
  return `Budzie meter\n  transcript: ${result.transcript}\n${renderReceipt(result.usage)}`;
}

/**
 * Parse the flags this CLI needs.
 * @param {string[]} argv
 * @returns {{ session: string | undefined, estimate: boolean, json: boolean, badge: boolean }}
 */
function parseFlags(argv) {
  let session;
  let estimate = false;
  let json = false;
  let badge = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--estimate") estimate = true;
    else if (arg === "--json") json = true;
    else if (arg === "--badge") badge = true;
    else if (arg === "--session") session = argv[++i];
    else if (arg.startsWith("--session=")) session = arg.slice("--session=".length);
  }
  return { session, estimate, json, badge };
}

/**
 * CLI entry point. Auto-discovers the live transcript (or `--session <path>`)
 * and prints the real counted session usage. `--badge` prints the one-line
 * statusline segment; `--json` prints the raw result.
 * @param {string[]} argv
 * @returns {number}
 */
export function main(argv) {
  const { session, estimate, json, badge } = parseFlags(argv);
  const result = meter({ explicit: session, estimate });

  if (json) {
    process.stdout.write(JSON.stringify(result) + "\n");
  } else if (badge) {
    const line = renderMeterBadge(result);
    if (line) process.stdout.write(line + "\n");
  } else {
    process.stdout.write(renderMeter(result) + "\n");
  }
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
