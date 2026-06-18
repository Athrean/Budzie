// @ts-check
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { compressProse as compressAtLevel } from "./compress.mjs";
import { DEFAULT_LEVEL, LEVELS } from "./intensity.mjs";

/**
 * @typedef {import("./intensity.mjs").Level} Level
 */

/**
 * Options for the tool-catalog reducer. Off by default: with no `enabled` flag
 * and no `fields`, the catalog passes through untouched.
 * @typedef {object} ReducerConfig
 * @property {boolean} [enabled] - Master opt-in switch. Falsey => passthrough.
 * @property {string[]} [fields] - Top-level tool fields to compress (e.g.
 *   `["description"]`). Only string values at these keys are touched. An empty
 *   or missing list is also a passthrough.
 * @property {Level} [level] - Budzie compression intensity.
 */

/**
 * Result of a compression pass. `catalog` is a new object; the input is never
 * mutated. Byte counts cover only the configured prose fields, summed across
 * every tool, measured as UTF-8 bytes of the field's string value.
 * @typedef {object} CompressResult
 * @property {any} catalog - Catalog with configured prose fields compressed.
 * @property {number} bytesBefore - UTF-8 bytes of those fields before.
 * @property {number} bytesAfter - UTF-8 bytes of those fields after.
 */

/**
 * UTF-8 byte length of a value. Non-strings count as zero so callers can sum
 * over optional fields without guarding every access.
 * @param {unknown} value
 * @returns {number}
 */
export function byteLength(value) {
  if (typeof value !== "string") return 0;
  return Buffer.byteLength(value, "utf8");
}

/**
 * Compress one prose field with the shared Budzie intensity rules.
 * @param {string} text
 * @param {Level} [level]
 * @returns {string}
 */
export function compressProse(text, level = DEFAULT_LEVEL) {
  return compressAtLevel(text, level);
}

/**
 * Pure compressor: `(catalog, config) -> { catalog, bytesBefore, bytesAfter }`.
 * Off by default. Only string values at the configured top-level tool fields
 * are touched; everything else — tool names, schemas, enum values, nested
 * objects — is copied through structurally identical. The input is not mutated.
 * @param {any} catalog - A `tools/list`-style result (`{ tools: [...] }`).
 * @param {ReducerConfig} config
 * @returns {CompressResult}
 */
export function compressCatalog(catalog, config) {
  const fields = config && config.enabled ? config.fields ?? [] : [];
  const level = /** @type {readonly string[]} */ (LEVELS).includes(
    config?.level ?? ""
  )
    ? config.level
    : DEFAULT_LEVEL;
  const active = Array.isArray(fields) && fields.length > 0;

  // Passthrough: deep clone so callers can trust they own the result, but make
  // no edits. Byte counts collapse to equal because nothing was compressed.
  if (!active || !catalog || !Array.isArray(catalog.tools)) {
    const clone = structuredClone(catalog);
    return { catalog: clone, bytesBefore: 0, bytesAfter: 0 };
  }

  const next = structuredClone(catalog);
  let bytesBefore = 0;
  let bytesAfter = 0;

  for (let i = 0; i < next.tools.length; i++) {
    const tool = next.tools[i];
    if (!tool || typeof tool !== "object") continue;
    for (const field of fields) {
      const value = tool[field];
      if (typeof value !== "string") continue;
      bytesBefore += byteLength(value);
      const compressed = compressProse(value, level);
      // Never let compression grow a field; keep the smaller of the two.
      tool[field] = byteLength(compressed) <= byteLength(value) ? compressed : value;
      bytesAfter += byteLength(tool[field]);
    }
  }

  return { catalog: next, bytesBefore, bytesAfter };
}

/**
 * Transparent proxy seam. Requests and tool-call responses MUST pass through
 * untouched; only `tools/list`-style results carry a compressible catalog. This
 * helper is deliberately a no-op for everything that isn't a list result, so it
 * can wrap any MCP message safely.
 *
 * A message is treated as a list result only when its `result.tools` is an
 * array AND compression is active; otherwise it is returned by reference,
 * unchanged, guaranteeing deep-equality for requests and tool-call responses.
 * @param {any} message - Any MCP message (request or response).
 * @param {ReducerConfig} config
 * @returns {any}
 */
export function proxyResponse(message, config) {
  const active =
    config && config.enabled && Array.isArray(config.fields) && config.fields.length > 0;
  if (!active) return message;
  if (!message || typeof message !== "object") return message;
  const result = message.result;
  if (!result || !Array.isArray(result.tools)) return message;

  const { catalog } = compressCatalog(result, config);
  return { ...message, result: catalog };
}

/** Flags that never take a value, so a following positional is not consumed. */
const BOOLEAN_FLAGS = new Set(["json"]);

/**
 * Parse `--key value`, `--key=value`, and bare flags. Flags listed in
 * {@link BOOLEAN_FLAGS} never swallow the next token, so `--json catalog.json`
 * keeps `catalog.json` as a positional.
 * @param {string[]} argv
 * @returns {{ flags: Record<string, string | true>, positionals: string[] }}
 */
function parseArgs(argv) {
  /** @type {Record<string, string | true>} */
  const flags = {};
  /** @type {string[]} */
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!BOOLEAN_FLAGS.has(key) && next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return { flags, positionals };
}

/**
 * Render the human-readable savings card.
 * @param {CompressResult} result
 * @returns {string}
 */
export function renderCard(result) {
  const saved = result.bytesBefore - result.bytesAfter;
  const pct =
    result.bytesBefore === 0 ? 0 : Math.round((saved / result.bytesBefore) * 100);
  return [
    "Budzie tool reducer",
    `  bytes before  ${result.bytesBefore}`,
    `  bytes after   ${result.bytesAfter}`,
    `  bytes saved   ${saved} (${pct}%)`,
    "(prose fields only; identifiers, URLs, paths, code, schema preserved)",
  ].join("\n");
}

/**
 * CLI entry point. Reads a `tools/list`-style catalog JSON from a file argument
 * (or stdin), compresses the fields named by repeatable `--fields`, and prints
 * either a savings card (default) or the full `CompressResult` (`--json`).
 *
 * Opt-in: with no `--fields`, the catalog passes through unchanged and the card
 * reports zero savings.
 * @param {string[]} argv - Arguments after `node script.mjs`.
 * @returns {Promise<void>}
 */
export async function main(argv) {
  const { flags, positionals } = parseArgs(argv);

  /** @type {string[]} */
  const fields = [];
  const raw = flags.fields;
  if (typeof raw === "string") {
    for (const f of raw.split(",")) {
      const trimmed = f.trim();
      if (trimmed) fields.push(trimmed);
    }
  }

  const source = positionals[0];
  const text = source
    ? readFileSync(source, "utf8")
    : readFileSync(0, "utf8"); // fd 0 = stdin
  const catalog = JSON.parse(text);

  const config = { enabled: fields.length > 0, fields };
  const result = compressCatalog(catalog, config);

  if (flags.json) {
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  process.stdout.write(renderCard(result) + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(String(err?.stack ?? err) + "\n");
    process.exitCode = 1;
  });
}
