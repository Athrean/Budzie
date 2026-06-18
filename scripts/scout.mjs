// @ts-check
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { isSensitivePath, scanContext } from "./context-receipts.mjs";
import { plan } from "./reap.mjs";

/** Default number of items kept in each `top` list — keeps output token-lean. */
const DEFAULT_TOP = 5;

/**
 * @typedef {object} ScoutContext
 * @property {number} count - Number of natural-language context files found.
 * @property {number} totalBytes - Real byte total across context files.
 * @property {number} estimatedTokens - ESTIMATE: summed per-file token estimate.
 * @property {number} refused - Count of sensitive paths refused (never read).
 * @property {Array<{ name: string, bytes: number }>} top - Largest files first.
 *
 * @typedef {object} ScoutBloat
 * @property {number} total - Total planned cuts in scope.
 * @property {Record<string, number>} byTier - Cut count per tier.
 * @property {Array<{ file: string, line: number, tag: string, tier: string }>} top - Highest-ranked cuts first.
 *
 * @typedef {object} ScoutAudit
 * @property {string} scope - The audited root, exactly as supplied.
 * @property {ScoutContext} context - Recurring-context findings (counted bytes).
 * @property {ScoutBloat} bloat - Bloat-marker findings from the cut plan.
 * @property {string[]} findings - Prioritised summary; counted figures first.
 * @property {string} tokenizerNote - ESTIMATE label + tokenizer assumption.
 */

/**
 * Build the prioritised findings list. Counted figures (cut counts, real bytes)
 * come first; token figures are always ESTIMATE and labelled as such.
 * @param {import("./context-receipts.mjs").ScanResult} ctx
 * @param {Record<string, number>} byTier
 * @returns {string[]}
 */
function buildFindings(ctx, byTier) {
  /** @type {string[]} */
  const out = [];
  /** @param {number} n */
  const plural = (n) => (n === 1 ? "" : "s");

  const auto = byTier.auto ?? 0;
  if (auto > 0) out.push(`${auto} auto-tier cut${plural(auto)} ready (delete/stdlib markers)`);

  const aggressive = byTier.aggressive ?? 0;
  if (aggressive > 0) {
    out.push(`${aggressive} aggressive-tier cut${plural(aggressive)} (native/yagni) — review before applying`);
  }

  const suggest = byTier.suggest ?? 0;
  if (suggest > 0) out.push(`${suggest} shrink suggestion${plural(suggest)} (never auto-applied)`);

  if (ctx.files.length > 0) {
    out.push(
      `${ctx.files.length} context file${plural(ctx.files.length)}, ` +
        `${ctx.totalBytes} bytes (~${ctx.totalEstimatedTokens} tokens ESTIMATE)`
    );
  }

  if (ctx.refused.length > 0) {
    out.push(`${ctx.refused.length} sensitive path${plural(ctx.refused.length)} refused (not read)`);
  }

  if (out.length === 0) out.push("no bloat markers or context files found");
  return out;
}

/**
 * Read-only budget audit of one scope.
 *
 * Pure with respect to shared state: it only reads `root` and returns a fresh
 * object, so many scopes can be audited in parallel with no cross-talk. Reuses
 * {@link scanContext} (#19) for recurring-context size + sensitive-path refusal
 * and {@link plan} (Reaper) for bloat markers — no duplicate scan logic here.
 *
 * @param {string} root - Directory to audit.
 * @param {{ top?: number, aggressive?: boolean }} [opts]
 * @returns {Promise<ScoutAudit>}
 */
export async function audit(root, opts = {}) {
  const top = opts.top ?? DEFAULT_TOP;
  const [ctx, cuts] = await Promise.all([
    scanContext(root),
    plan(root, {
      aggressive: opts.aggressive ?? false,
      exclude: (file) => isSensitivePath(path.relative(root, file)),
    }),
  ]);

  /** @type {Record<string, number>} */
  const byTier = {};
  for (const cut of cuts) byTier[cut.tier] = (byTier[cut.tier] ?? 0) + 1;

  const contextTop = [...ctx.files]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, top)
    .map((f) => ({ name: f.name, bytes: f.bytes }));

  // `plan` already ranks auto → aggressive → suggest, so the head is highest value.
  const bloatTop = cuts
    .slice(0, top)
    .map((c) => ({ file: c.file, line: c.line, tag: c.tag, tier: c.tier }));

  return {
    scope: root,
    context: {
      count: ctx.files.length,
      totalBytes: ctx.totalBytes,
      estimatedTokens: ctx.totalEstimatedTokens,
      refused: ctx.refused.length,
      top: contextTop,
    },
    bloat: { total: cuts.length, byTier, top: bloatTop },
    findings: buildFindings(ctx, byTier),
    tokenizerNote: ctx.tokenizerNote,
  };
}

/**
 * Render an audit as a compact terminal card. Counted figures first; token
 * figures are labelled ESTIMATE.
 * @param {ScoutAudit} a
 * @returns {string}
 */
export function renderAudit(a) {
  /** @type {string[]} */
  const lines = [
    "Budzie scout audit",
    "  scope               " + a.scope,
    "  bloat cuts          " + a.bloat.total + " (real local count)",
    "  context files       " + a.context.count,
    "  context bytes       " + a.context.totalBytes + " (real local count)",
    "  est. tokens         " + a.context.estimatedTokens + " (ESTIMATE)",
    "  refused (sensitive) " + a.context.refused,
  ];

  lines.push("");
  lines.push("  findings:");
  for (const f of a.findings) lines.push("    - " + f);

  if (a.bloat.top.length > 0) {
    lines.push("");
    lines.push("  top cuts:");
    for (const c of a.bloat.top) lines.push(`    ${c.tier}\t${c.tag}\t${c.file}:${c.line}`);
  }

  lines.push("");
  lines.push("  " + a.tokenizerNote);
  return lines.join("\n");
}

/**
 * Parse a positive integer flag value; throws on a non-positive or non-numeric.
 * @param {string} raw
 * @returns {number}
 */
function parseTop(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error("--top must be a positive integer");
  return n;
}

/**
 * CLI entry point.
 *
 *   scout.mjs [root] [--json] [--aggressive] [--top N]
 *
 * Default prints a human card; `--json` prints the structured audit (the shape
 * a fan-out dispatcher consumes). An optional positional sets the scan root.
 * @param {string[]} argv - Arguments after `node scout.mjs`.
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      aggressive: { type: "boolean", default: false },
      top: { type: "string" },
    },
  });
  const top = parsed.values.top ? parseTop(parsed.values.top) : undefined;
  const root = parsed.positionals[0] ?? process.cwd();
  const result = await audit(root, {
    top,
    aggressive: parsed.values.aggressive,
  });

  if (parsed.values.json) {
    process.stdout.write(JSON.stringify(result) + "\n");
  } else {
    process.stdout.write(renderAudit(result) + "\n");
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
