// @ts-check
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Lifetime savings ledger. A local-only, append-on-write record of what Budzie
 * saved per session, plus a cumulative tokens-saved badge for the statusline.
 * Zero network, zero telemetry — every byte stays on this machine.
 */

/**
 * One recorded session of savings.
 * @typedef {object} LedgerEntry
 * @property {string} timestamp - ISO timestamp of the session.
 * @property {number} tokensSaved - Output-compression tokens avoided.
 * @property {number} linesAvoided - Lines of code avoided (YAGNI ladder).
 * @property {number} depsAvoided - Dependencies avoided.
 * @property {number} costAvoided - Estimated dollar cost avoided.
 */

/**
 * On-disk ledger shape.
 * @typedef {object} Ledger
 * @property {number} version - Schema version; bump on shape changes.
 * @property {LedgerEntry[]} entries - Session entries, oldest first.
 */

/** Ledger schema version; bump when the on-disk shape changes. */
export const LEDGER_VERSION = 1;

/** Ledger filename inside the host config dir. */
const LEDGER_FILE = "ledger.json";

/** App folder used under the config root. */
const APP_DIR = "budzie";

/**
 * Resolve the host config directory for Budzie's lifetime ledger.
 *
 * Resolution order, first hit wins:
 *   1. `BUDZIE_DATA_DIR` (explicit opt-out of host defaults, used by tests).
 *   2. `$XDG_CONFIG_HOME/budzie`.
 *   3. `~/.config/budzie` via `os.homedir()` (platform equivalent).
 *
 * The ledger is machine-local config, never the user's working tree.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} Absolute path to the Budzie config dir.
 */
export function resolveConfigDir(env = process.env) {
  const explicit = env.BUDZIE_DATA_DIR;
  if (explicit && explicit.trim() !== "") return path.resolve(explicit);

  const xdg = env.XDG_CONFIG_HOME;
  if (xdg && xdg.trim() !== "") return path.join(xdg, APP_DIR);

  return path.join(homedir(), ".config", APP_DIR);
}

/**
 * Absolute path to the ledger file.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function ledgerPath(env = process.env) {
  return path.join(resolveConfigDir(env), LEDGER_FILE);
}

/**
 * Coerce an unknown value into a finite, non-negative number; else 0.
 * @param {unknown} value
 * @returns {number}
 */
function toCount(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Read the ledger, or an empty versioned ledger when missing or unreadable.
 * Never throws: a corrupt file degrades to an empty ledger so callers in hooks
 * and the statusline stay non-blocking.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Ledger}
 */
export function readLedger(env = process.env) {
  const file = ledgerPath(env);
  if (!existsSync(file)) return { version: LEDGER_VERSION, entries: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const rawEntries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    const entries = rawEntries.map((/** @type {any} */ e) => ({
      timestamp: typeof e?.timestamp === "string" ? e.timestamp : "",
      tokensSaved: toCount(e?.tokensSaved),
      linesAvoided: toCount(e?.linesAvoided),
      depsAvoided: toCount(e?.depsAvoided),
      costAvoided: toCount(e?.costAvoided),
    }));
    return { version: LEDGER_VERSION, entries };
  } catch {
    return { version: LEDGER_VERSION, entries: [] };
  }
}

/**
 * Append a session entry to the ledger, creating the file on first write.
 * @param {Partial<LedgerEntry>} entry - Counts for this session; omitted fields default to 0.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Ledger} The ledger after the append.
 */
export function appendEntry(entry, env = process.env) {
  const ledger = readLedger(env);
  /** @type {LedgerEntry} */
  const next = {
    timestamp: typeof entry.timestamp === "string" ? entry.timestamp : new Date().toISOString(),
    tokensSaved: toCount(entry.tokensSaved),
    linesAvoided: toCount(entry.linesAvoided),
    depsAvoided: toCount(entry.depsAvoided),
    costAvoided: toCount(entry.costAvoided),
  };
  ledger.entries.push(next);
  const file = ledgerPath(env);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(ledger, null, 2) + "\n");
  return ledger;
}

/**
 * Sum lifetime tokens saved across every session entry.
 * @param {Ledger} ledger
 * @returns {number}
 */
export function cumulativeTokens(ledger) {
  return ledger.entries.reduce((sum, e) => sum + toCount(e.tokensSaved), 0);
}

/**
 * Format a count with a human-readable k/M suffix: one decimal, trailing `.0`
 * trimmed. 12400 -> "12.4k", 2_300_000 -> "2.3M", 950 -> "950", 1000 -> "1k".
 * @param {number} n
 * @returns {string}
 */
export function formatCount(n) {
  const value = toCount(n);
  if (value >= 1_000_000) return trimDecimal(value / 1_000_000) + "M";
  if (value >= 1_000) return trimDecimal(value / 1_000) + "k";
  return String(Math.round(value));
}

/**
 * Round to one decimal place and drop a trailing `.0`.
 * @param {number} n
 * @returns {string}
 */
function trimDecimal(n) {
  const fixed = n.toFixed(1);
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}

/**
 * Render the statusline badge from the on-disk ledger, e.g. `[BUDZIE] 12.4k`.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function renderBadge(env = process.env) {
  const total = cumulativeTokens(readLedger(env));
  return `[BUDZIE] ${formatCount(total)}`;
}

/**
 * Parse `--flag N` / `--flag=N` numeric options from argv.
 * @param {string[]} argv
 * @param {string} flag - e.g. "--tokens".
 * @returns {number | undefined}
 */
function numericFlag(argv, flag) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === flag) {
      const raw = argv[i + 1];
      const value = raw === undefined ? NaN : Number(raw);
      return Number.isFinite(value) ? value : undefined;
    }
    if (arg.startsWith(flag + "=")) {
      const value = Number(arg.slice(flag.length + 1));
      return Number.isFinite(value) ? value : undefined;
    }
  }
  return undefined;
}

/**
 * CLI entry point.
 *
 *   ledger.mjs badge                              prints the statusline badge
 *   ledger.mjs append [--tokens N] [--lines N]    appends a session entry,
 *              [--deps N] [--cost N]              then prints the new badge
 *
 * @param {string[]} argv - Arguments after `node ledger.mjs`.
 * @returns {number} Process exit code.
 */
export function main(argv) {
  const [command = "badge"] = argv;

  if (command === "badge") {
    process.stdout.write(renderBadge() + "\n");
    return 0;
  }

  if (command === "append") {
    appendEntry({
      tokensSaved: numericFlag(argv, "--tokens"),
      linesAvoided: numericFlag(argv, "--lines"),
      depsAvoided: numericFlag(argv, "--deps"),
      costAvoided: numericFlag(argv, "--cost"),
    });
    process.stdout.write(renderBadge() + "\n");
    return 0;
  }

  process.stderr.write(
    "usage: ledger.mjs badge | append [--tokens N] [--lines N] [--deps N] [--cost N]\n"
  );
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
