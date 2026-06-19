// @ts-check
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { tally } from "./receipts.mjs";
import { checkBudget, readConfig } from "./budget.mjs";

/**
 * @typedef {object} BuildReceipt
 * @property {"build_run"} kind
 * @property {number} linesWritten - Real local count of lines the build added.
 * @property {number} shortcutMarkers - `budzie:` markers left (documented avoidances).
 * @property {number} markersMissingUpgradeTrigger - Markers naming no upgrade trigger.
 * @property {number} depsAvoided - Markers claiming a dependency was avoided.
 * @property {"ok" | "warn" | "stop"} budgetStatus - Convenience copy of budget.status.
 * @property {{ budget: string, estimated: string, status: "ok" | "warn" | "stop", reason: string }} budget
 */

/**
 * Build a YAGNI build receipt for a finished build.
 *
 * Reuses `receipts.tally` (real shortcut-marker + deps-avoided counts) and the
 * budget plumbing (`readConfig` + `checkBudget`) — no duplicate scan or budget
 * logic. `linesWritten` is a real local count supplied by the caller (the diff
 * size); avoided work is represented by the `budzie:` markers actually left in
 * the tree, never an invented "lines avoided" number.
 *
 * @param {string} root - Build root to scan for markers + budget config.
 * @param {{
 *   written?: number,
 *   estimate?: number | null,
 *   budgetFlags?: Record<string, string | true>,
 *   env?: NodeJS.ProcessEnv,
 * }} [opts]
 * @returns {Promise<BuildReceipt>}
 */
export async function buildReceipt(root, opts = {}) {
  const counts = await tally(root);
  const config = readConfig(root, opts.budgetFlags ?? {}, opts.env ?? process.env);
  const budget = checkBudget(config, opts.estimate ?? null);

  return {
    kind: "build_run",
    linesWritten: opts.written ?? 0,
    shortcutMarkers: counts.markers,
    markersMissingUpgradeTrigger: counts.noUpgradeTrigger,
    depsAvoided: counts.depsAvoided,
    budgetStatus: budget.status,
    budget,
  };
}

/**
 * Render a build receipt as a terminal card. Counted figures first; the budget
 * line states the configured ceiling, the estimate, and the guard verdict.
 * @param {BuildReceipt} r
 * @returns {string}
 */
export function renderReceipt(r) {
  return [
    "Budzie build receipt",
    "  lines written        " + r.linesWritten + " (real local count)",
    "  shortcut markers     " + r.shortcutMarkers + " (work avoided, documented)",
    "  missing upgrade note " + r.markersMissingUpgradeTrigger,
    "  deps avoided         " + r.depsAvoided,
    "  budget               " + r.budget.budget,
    "  estimated            " + r.budget.estimated,
    "  status               " + r.budget.status + " — " + r.budget.reason,
  ].join("\n");
}

/**
 * Parse a non-negative integer flag value.
 * @param {string} label
 * @param {string} raw
 * @returns {number}
 */
function parseNonNegativeInt(label, raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${label} must be a non-negative integer`);
  return n;
}

/**
 * CLI entry point.
 *
 *   builder.mjs [root] --written N [--estimate N] [--config <path>] [--json]
 *
 * Prints the build receipt; exits 2 when the budget guard says `stop` so a
 * host runner can halt the build. An optional positional sets the build root.
 * @param {string[]} argv - Arguments after `node builder.mjs`.
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      written: { type: "string" },
      estimate: { type: "string" },
      config: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const root = positionals[0] ?? process.cwd();
  const written = values.written === undefined ? 0 : parseNonNegativeInt("written", values.written);
  const estimate =
    values.estimate === undefined ? null : parseNonNegativeInt("estimate", values.estimate);

  const receipt = await buildReceipt(root, {
    written,
    estimate,
    budgetFlags: values.config === undefined ? {} : { config: values.config },
    env: process.env,
  });

  if (values.json) {
    process.stdout.write(JSON.stringify(receipt) + "\n");
  } else {
    process.stdout.write(renderReceipt(receipt) + "\n");
  }
  return receipt.budgetStatus === "stop" ? 2 : 0;
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
