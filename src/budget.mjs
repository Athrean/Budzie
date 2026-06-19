// @ts-check
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { writeFileAtomic } from "./lib/atomic-write.mjs";

import { readSession } from "./session.mjs";

/**
 * @typedef {"warn" | "stop"} Mode
 *
 * @typedef {object} BudgetConfig
 * @property {number} ceiling - Numeric budget ceiling.
 * @property {string} unit - Unit for ceiling and estimates.
 * @property {number} warnAt - Ratio of ceiling where warning starts.
 * @property {Mode} mode - Whether an over-budget check warns or stops.
 */

/** Local-only default config path, relative to the guarded project root. */
const DEFAULT_CONFIG = path.join(".budzie", "budget.json");

/**
 * Render the guard outcome as the documented terminal block.
 * @param {{ budget: string, estimated: string, status: "ok" | "warn" | "stop", reason: string }} result
 * @returns {string}
 */
export function renderResult(result) {
  return [
    `budget: ${result.budget}`,
    `estimated: ${result.estimated}`,
    `status: ${result.status}`,
    `reason: ${result.reason}`,
  ].join("\n");
}

/** Flags that take a string value (`--key value` or `--key=value`). */
const STRING_FLAGS = ["config", "ceiling", "unit", "warn-at", "mode", "estimate", "session"];

/**
 * Parse `--key value`, `--key=value`, and bare boolean flags into the
 * { flags, positionals } shape the rest of this CLI consumes. Thin adapter over
 * node:util parseArgs, so flag handling is stdlib rather than hand-rolled.
 * @param {string[]} argv
 * @returns {{ flags: Record<string, string | true>, positionals: string[] }}
 */
function parseFlags(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: Object.fromEntries(STRING_FLAGS.map((name) => [name, { type: "string" }])),
    strict: false,
    allowPositionals: true,
  });

  /** @type {Record<string, string | true>} */
  const flags = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === true) flags[key] = true;
    else if (typeof value === "string") flags[key] = value;
  }
  return { flags, positionals: [...positionals] };
}

/**
 * Return a string flag value, if present.
 * @param {Record<string, string | true>} flags
 * @param {string} key
 * @returns {string | undefined}
 */
function stringFlag(flags, key) {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Parse a positive finite number.
 * @param {string} label
 * @param {string | undefined} raw
 * @returns {number}
 */
function parsePositiveNumber(label, raw) {
  if (raw === undefined || raw.trim() === "") {
    throw new Error(`${label} is required`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return value;
}

/**
 * Parse the warning threshold as a ratio.
 * @param {string | undefined} raw
 * @returns {number}
 */
function parseWarnAt(raw) {
  if (raw === undefined) return 0.8;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error("warn-at must be a number from 0 through 1");
  }
  return value;
}

/**
 * Parse guard mode.
 * @param {string | undefined} raw
 * @returns {Mode}
 */
function parseMode(raw) {
  if (raw === undefined) return "warn";
  if (raw === "warn" || raw === "stop") return raw;
  throw new Error("mode must be warn or stop");
}

/**
 * Resolve the local config path.
 * @param {string} root
 * @param {Record<string, string | true>} flags
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function configPath(root, flags = {}, env = process.env) {
  const explicit = stringFlag(flags, "config") ?? env.BUDZIE_BUDGET_CONFIG;
  return path.resolve(root, explicit ?? DEFAULT_CONFIG);
}

/**
 * Format a known budget or `unknown`.
 * @param {BudgetConfig | null} config
 * @returns {string}
 */
function formatBudget(config) {
  return config ? `${config.ceiling} ${config.unit}` : "unknown";
}

/**
 * Format a known estimate or `unknown`.
 * @param {number | null} estimate
 * @param {BudgetConfig | null} config
 * @returns {string}
 */
function formatEstimate(estimate, config) {
  if (estimate === null) return "unknown";
  return config ? `${estimate} ${config.unit}` : String(estimate);
}

/**
 * Evaluate a budget check.
 * @param {BudgetConfig | null} config
 * @param {number | null} estimate
 * @returns {{ budget: string, estimated: string, status: "ok" | "warn" | "stop", reason: string }}
 */
export function checkBudget(config, estimate) {
  if (!config) {
    return {
      budget: "unknown",
      estimated: formatEstimate(estimate, config),
      status: "ok",
      reason: "no budget ceiling configured",
    };
  }

  if (estimate === null) {
    return {
      budget: formatBudget(config),
      estimated: "unknown",
      status: "ok",
      reason: "estimate missing",
    };
  }

  if (estimate > config.ceiling) {
    return {
      budget: formatBudget(config),
      estimated: formatEstimate(estimate, config),
      status: config.mode === "stop" ? "stop" : "warn",
      reason: "estimate exceeds budget",
    };
  }

  if (estimate >= config.ceiling * config.warnAt) {
    return {
      budget: formatBudget(config),
      estimated: formatEstimate(estimate, config),
      status: "warn",
      reason: "estimate reached warning threshold",
    };
  }

  return {
    budget: formatBudget(config),
    estimated: formatEstimate(estimate, config),
    status: "ok",
    reason: "budget check passed",
  };
}

/**
 * Check whether an unknown JSON value is a valid budget config.
 * @param {unknown} value
 * @returns {value is BudgetConfig}
 */
function isBudgetConfig(value) {
  if (!value || typeof value !== "object") return false;
  const obj = /** @type {Record<string, unknown>} */ (value);
  return (
    typeof obj.ceiling === "number" &&
    Number.isFinite(obj.ceiling) &&
    obj.ceiling > 0 &&
    typeof obj.unit === "string" &&
    obj.unit.length > 0 &&
    typeof obj.warnAt === "number" &&
    Number.isFinite(obj.warnAt) &&
    obj.warnAt > 0 &&
    obj.warnAt <= 1 &&
    (obj.mode === "warn" || obj.mode === "stop")
  );
}

/**
 * Read the local budget config, if present.
 * @param {string} root
 * @param {Record<string, string | true>} flags
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {BudgetConfig | null}
 */
export function readConfig(root, flags = {}, env = process.env) {
  const file = configPath(root, flags, env);
  /** @type {BudgetConfig | null} */
  let config = null;

  if (!existsSync(file)) return applyEnvOverrides(null, env);

  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (!isBudgetConfig(parsed)) {
    throw new Error(`invalid budget config: ${file}`);
  }
  config = parsed;
  return applyEnvOverrides(config, env);
}

/**
 * Write the local budget config.
 * @param {string} root
 * @param {Record<string, string | true>} flags
 * @param {BudgetConfig} config
 * @param {NodeJS.ProcessEnv} [env]
 */
export function writeConfig(root, flags, config, env = process.env) {
  writeFileAtomic(configPath(root, flags, env), JSON.stringify(config, null, 2) + "\n");
}

/**
 * Apply environment budget settings over local config.
 * @param {BudgetConfig | null} config
 * @param {NodeJS.ProcessEnv} env
 * @returns {BudgetConfig | null}
 */
function applyEnvOverrides(config, env) {
  const hasCeiling = env.BUDZIE_BUDGET_CEILING !== undefined && env.BUDZIE_BUDGET_CEILING !== "";
  const hasUnit = env.BUDZIE_BUDGET_UNIT !== undefined && env.BUDZIE_BUDGET_UNIT !== "";
  const hasWarnAt = env.BUDZIE_BUDGET_WARN_AT !== undefined && env.BUDZIE_BUDGET_WARN_AT !== "";
  const hasMode = env.BUDZIE_BUDGET_MODE !== undefined && env.BUDZIE_BUDGET_MODE !== "";

  if (!config && !hasCeiling) return null;

  /** @type {BudgetConfig} */
  const next = config
    ? { ...config }
    : {
        ceiling: parsePositiveNumber("BUDZIE_BUDGET_CEILING", env.BUDZIE_BUDGET_CEILING),
        unit: hasUnit ? String(env.BUDZIE_BUDGET_UNIT) : "units",
        warnAt: 0.8,
        mode: "warn",
      };

  if (hasCeiling) {
    next.ceiling = parsePositiveNumber("BUDZIE_BUDGET_CEILING", env.BUDZIE_BUDGET_CEILING);
  }
  if (hasUnit) next.unit = String(env.BUDZIE_BUDGET_UNIT);
  if (hasWarnAt) next.warnAt = parseWarnAt(env.BUDZIE_BUDGET_WARN_AT);
  if (hasMode) next.mode = parseMode(env.BUDZIE_BUDGET_MODE);

  return next;
}

/**
 * Resolve the estimate fed into the budget check. An explicit `--estimate`
 * wins. Otherwise, when `--session <path>` is given, the local session log's
 * total token usage is read and used (counted tokens preferred; `--estimate`
 * here also lets the session reader fall back to a labelled char/token
 * estimate). Missing usage yields `null` so the check reports honestly rather
 * than inventing a number. Local file read only — no network.
 * @param {Record<string, string | true>} flags
 * @returns {number | null}
 */
function resolveEstimate(flags) {
  const estimateRaw = stringFlag(flags, "estimate");
  if (estimateRaw !== undefined) {
    return parsePositiveNumber("estimate", estimateRaw);
  }

  const session = stringFlag(flags, "session");
  if (session !== undefined) {
    const usage = readSession(session, { estimate: flags.estimate === true });
    return usage.totalTokens;
  }

  return null;
}

/**
 * CLI entry point.
 * @param {string[]} argv - Arguments after `node budget.mjs`.
 * @returns {Promise<number>} Process exit code.
 */
export async function main(argv) {
  const [command = "status", ...rest] = argv;
  const { flags } = parseFlags(rest);

  if (command === "status") {
    const config = readConfig(process.cwd(), flags, process.env);
    process.stdout.write(
      renderResult({
        budget: formatBudget(config),
        estimated: "unknown",
        status: "ok",
        reason: config ? "budget ceiling configured" : "no budget ceiling configured",
      }) + "\n"
    );
    return 0;
  }

  if (command === "set") {
    const unit = stringFlag(flags, "unit");
    if (!unit) throw new Error("unit is required");

    const config = {
      ceiling: parsePositiveNumber("ceiling", stringFlag(flags, "ceiling")),
      unit,
      warnAt: parseWarnAt(stringFlag(flags, "warn-at")),
      mode: parseMode(stringFlag(flags, "mode")),
    };
    writeConfig(process.cwd(), flags, config, process.env);
    process.stdout.write(
      renderResult({
        budget: formatBudget(config),
        estimated: "unknown",
        status: "ok",
        reason: "budget ceiling configured",
      }) + "\n"
    );
    return 0;
  }

  if (command === "check") {
    const config = readConfig(process.cwd(), flags, process.env);
    const estimate = resolveEstimate(flags);
    const result = checkBudget(config, estimate);
    process.stdout.write(renderResult(result) + "\n");
    return result.status === "stop" ? 2 : 0;
  }

  process.stderr.write(
    "usage: budget.mjs status | set --ceiling <n> --unit <unit> | " +
      "check [--estimate <n>] [--session <path>]\n"
  );
  return 1;
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
