// @ts-check
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { estimateTokens, CHARS_PER_TOKEN } from "./context-receipts.mjs";

/**
 * Origin of the token figure. `counted` means real token fields were summed
 * from the session log. `estimate` means no usage fields were present and the
 * figure was derived from message text via a char/token heuristic. `missing`
 * means no usage fields were present and no estimate was requested.
 * @typedef {"counted" | "estimate" | "missing"} TokensSource
 */

/**
 * Parsed, local-only session usage. Real counts are kept distinct from
 * estimates: `tokensSource` names where every token figure came from.
 *
 * @typedef {object} SessionUsage
 * @property {number} turns - Real count of assistant turns observed.
 * @property {number} entries - Real count of transcript entries scanned.
 * @property {number | null} inputTokens - Summed input tokens, or null when unknown.
 * @property {number | null} outputTokens - Summed output tokens, or null when unknown.
 * @property {number | null} totalTokens - Total tokens, or null when unknown.
 * @property {TokensSource} tokensSource - Origin of the token figures.
 */

/**
 * Token field aliases recognised on a usage object or an entry. Real counted
 * fields only — these are summed verbatim, never scaled.
 */
const INPUT_KEYS = ["input_tokens", "inputTokens", "prompt_tokens", "promptTokens"];
const OUTPUT_KEYS = ["output_tokens", "outputTokens", "completion_tokens", "completionTokens"];
const TOTAL_KEYS = ["total_tokens", "totalTokens", "tokens"];

/**
 * Read the first finite non-negative number found among `keys` on `obj`.
 * @param {Record<string, unknown>} obj
 * @param {string[]} keys
 * @returns {number | null}
 */
function readNumber(obj, keys) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return null;
}

/**
 * Locate the usage object on a transcript entry. Many agent logs nest token
 * fields under `usage`, `tokenUsage`, or `metadata.usage`; others put them
 * directly on the entry. Returns the entry itself as a fallback so top-level
 * token fields are still read.
 * @param {Record<string, unknown>} entry
 * @returns {Record<string, unknown>}
 */
function usageObject(entry) {
  for (const key of ["usage", "tokenUsage", "token_usage"]) {
    const value = entry[key];
    if (value && typeof value === "object") {
      return /** @type {Record<string, unknown>} */ (value);
    }
  }
  const meta = entry.metadata;
  if (meta && typeof meta === "object") {
    const inner = /** @type {Record<string, unknown>} */ (meta).usage;
    if (inner && typeof inner === "object") {
      return /** @type {Record<string, unknown>} */ (inner);
    }
  }
  return entry;
}

/**
 * True when an entry represents an assistant turn. Recognises the common
 * `role`/`type` shapes; unknown shapes are not counted as turns.
 * @param {Record<string, unknown>} entry
 * @returns {boolean}
 */
function isAssistantTurn(entry) {
  const role = entry.role ?? entry.type ?? entry.sender;
  return role === "assistant" || role === "ai" || role === "model";
}

/**
 * Extract plain text from an entry's content for the estimate fallback. Handles
 * string content and arrays of `{ text }` / `{ content }` parts. Non-text parts
 * contribute nothing.
 * @param {Record<string, unknown>} entry
 * @returns {string}
 */
function entryText(entry) {
  const content = entry.content ?? entry.text ?? entry.message;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const p = /** @type {Record<string, unknown>} */ (part);
          if (typeof p.text === "string") return p.text;
          if (typeof p.content === "string") return p.content;
        }
        return "";
      })
      .join(" ");
  }
  return "";
}

/**
 * Parse session log text into entries. Accepts JSONL (one JSON value per line)
 * and a single JSON document holding either an array of entries or an object
 * with an `entries`/`messages`/`transcript` array. Blank lines are skipped.
 *
 * budzie: supports JSON and JSONL transcript shapes only. Ceiling: no binary or
 * vendor-proprietary session formats. Upgrade trigger: add a dedicated parser
 * (new file + fixtures) once a concrete non-JSON local format is requested.
 *
 * @param {string} text - Raw session log contents.
 * @returns {Record<string, unknown>[]}
 */
export function parseSession(text) {
  const trimmed = text.trim();
  if (trimmed === "") return [];

  // Try a single JSON document first (array or wrapper object).
  if (trimmed[0] === "[" || trimmed[0] === "{") {
    try {
      const doc = JSON.parse(trimmed);
      if (Array.isArray(doc)) return normaliseEntries(doc);
      if (doc && typeof doc === "object") {
        const obj = /** @type {Record<string, unknown>} */ (doc);
        for (const key of ["entries", "messages", "transcript", "turns", "events"]) {
          if (Array.isArray(obj[key])) return normaliseEntries(obj[key]);
        }
        // A single-object summary: treat as one entry.
        return normaliseEntries([obj]);
      }
    } catch {
      // Fall through to line-by-line JSONL parsing.
    }
  }

  /** @type {Record<string, unknown>[]} */
  const entries = [];
  for (const line of trimmed.split("\n")) {
    const piece = line.trim();
    if (piece === "") continue;
    let value;
    try {
      value = JSON.parse(piece);
    } catch {
      continue; // skip a malformed line rather than fail the whole read
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      entries.push(/** @type {Record<string, unknown>} */ (value));
    }
  }
  return entries;
}

/**
 * Keep only object entries from a parsed array.
 * @param {unknown[]} arr
 * @returns {Record<string, unknown>[]}
 */
function normaliseEntries(arr) {
  /** @type {Record<string, unknown>[]} */
  const out = [];
  for (const item of arr) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      out.push(/** @type {Record<string, unknown>} */ (item));
    }
  }
  return out;
}

/**
 * Summarise parsed session entries into real usage counts. Token fields are
 * summed only when present; absent usage yields nulls (never a fabricated
 * number). When `estimate` is true and no token fields were found, a labelled
 * char/token estimate is derived from message text instead.
 * @param {Record<string, unknown>[]} entries
 * @param {{ estimate?: boolean }} [opts]
 * @returns {SessionUsage}
 */
export function summariseSession(entries, opts = {}) {
  let turns = 0;
  let input = 0;
  let output = 0;
  let totalExplicit = 0;
  let sawInput = false;
  let sawOutput = false;
  let sawTotal = false;
  let chars = 0;

  for (const entry of entries) {
    if (isAssistantTurn(entry)) turns++;
    chars += entryText(entry).length;

    const usage = usageObject(entry);
    const i = readNumber(usage, INPUT_KEYS);
    const o = readNumber(usage, OUTPUT_KEYS);
    const t = readNumber(usage, TOTAL_KEYS);
    if (i !== null) {
      input += i;
      sawInput = true;
    }
    if (o !== null) {
      output += o;
      sawOutput = true;
    }
    if (t !== null) {
      totalExplicit += t;
      sawTotal = true;
    }
  }

  const sawAny = sawInput || sawOutput || sawTotal;

  if (sawAny) {
    // Prefer summed input+output when those parts are present; otherwise fall
    // back to an explicit total. Real counted fields only — no scaling.
    const total =
      sawInput || sawOutput ? input + output : sawTotal ? totalExplicit : null;
    return {
      turns,
      entries: entries.length,
      inputTokens: sawInput ? input : null,
      outputTokens: sawOutput ? output : null,
      totalTokens: total,
      tokensSource: "counted",
    };
  }

  if (opts.estimate) {
    const est = estimateTokens(chars);
    return {
      turns,
      entries: entries.length,
      inputTokens: null,
      outputTokens: null,
      totalTokens: est,
      tokensSource: "estimate",
    };
  }

  return {
    turns,
    entries: entries.length,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    tokensSource: "missing",
  };
}

/**
 * Read and summarise a local session log. Local file read only — no network.
 * Throws a clear error when the file cannot be read.
 * @param {string} file - Absolute or cwd-relative path to a session log.
 * @param {{ estimate?: boolean }} [opts]
 * @returns {SessionUsage}
 */
export function readSession(file, opts = {}) {
  /** @type {string} */
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    const code = /** @type {{ code?: string }} */ (err)?.code;
    if (code === "ENOENT") {
      throw new Error(`session log not found: ${file}`);
    }
    throw new Error(`cannot read session log: ${file}`);
  }
  return summariseSession(parseSession(text), opts);
}

/**
 * The estimate label naming the source and the heuristic assumption.
 * @returns {string}
 */
function estimateLabel() {
  return `ESTIMATE (session log): tokens ~= ceil(chars / ${CHARS_PER_TOKEN})`;
}

/**
 * Render session usage as a terminal receipt. Real counted figures lead; an
 * estimated total is explicitly labelled with its source; missing usage is
 * stated plainly with no invented number.
 * @param {SessionUsage} usage
 * @returns {string}
 */
export function renderReceipt(usage) {
  const lines = ["Budzie session receipt", `  turns: ${usage.turns}`, `  entries: ${usage.entries}`];

  if (usage.tokensSource === "counted") {
    lines.push(
      `  input tokens: ${usage.inputTokens ?? "unknown"} (counted)`,
      `  output tokens: ${usage.outputTokens ?? "unknown"} (counted)`,
      `  total tokens: ${usage.totalTokens ?? "unknown"} (counted)`
    );
  } else if (usage.tokensSource === "estimate") {
    lines.push(
      "  input tokens: unknown",
      "  output tokens: unknown",
      `  total tokens: ${usage.totalTokens} ${estimateLabel()}`
    );
  } else {
    lines.push(
      "  input tokens: unknown",
      "  output tokens: unknown",
      "  total tokens: unknown",
      "  note: usage data missing in session log (no token fields found)"
    );
  }

  return lines.join("\n");
}

/**
 * Parse the subset of flags this CLI needs.
 * @param {string[]} argv
 * @returns {{ session: string | undefined, estimate: boolean, json: boolean }}
 */
function parseFlags(argv) {
  let session;
  let estimate = false;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--estimate") estimate = true;
    else if (arg === "--json") json = true;
    else if (arg === "--session") session = argv[++i];
    else if (arg.startsWith("--session=")) session = arg.slice("--session=".length);
  }
  return { session, estimate, json };
}

/**
 * CLI entry point. `report --session <path>` reads a local session log and
 * prints a usage receipt. `--json` emits the parsed summary; `--estimate` opts
 * into a labelled char/token estimate when no real usage fields are present.
 * @param {string[]} argv - Arguments after `node session.mjs`.
 * @returns {Promise<number>} Process exit code.
 */
export async function main(argv) {
  const [command = "report", ...rest] = argv;
  const { session, estimate, json } = parseFlags(rest);

  if (command !== "report") {
    process.stderr.write("usage: session.mjs report --session <path> [--estimate] [--json]\n");
    return 1;
  }
  if (!session) {
    process.stderr.write("session log path is required: --session <path>\n");
    return 1;
  }

  const usage = readSession(session, { estimate });
  if (json) {
    process.stdout.write(JSON.stringify(usage) + "\n");
  } else {
    process.stdout.write(renderReceipt(usage) + "\n");
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    }
  );
}
