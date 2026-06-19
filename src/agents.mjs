// @ts-check
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkBudget, readConfig } from "./budget.mjs";
import { readSession } from "./session.mjs";

/**
 * @typedef {"counted" | "estimate" | "missing"} AgentTokenSource
 *
 * @typedef {object} AgentDefinition
 * @property {string} name
 * @property {string} description
 * @property {string} instructions
 * @property {string} file
 *
 * @typedef {object} AgentUsage
 * @property {number | null} inputTokens
 * @property {number | null} outputTokens
 * @property {number | null} totalTokens
 * @property {AgentTokenSource} tokensSource
 * @property {string} tokenLabel
 *
 * @typedef {object} SubagentReceipt
 * @property {"subagent_run"} kind
 * @property {string} agent
 * @property {string} task
 * @property {string} tokenLabel
 * @property {number | null} totalTokens
 * @property {string} budgetStatus
 * @property {boolean} readOnly
 *
 * @typedef {object} DispatchResult
 * @property {AgentDefinition} agent
 * @property {string} task
 * @property {boolean} readOnly
 * @property {AgentUsage} usage
 * @property {{ budget: string, estimated: string, status: "ok" | "warn" | "stop", reason: string }} budget
 * @property {SubagentReceipt} receipt
 */

/**
 * Parse `--key value`, `--key=value`, and boolean flags.
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
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }

  return { flags, positionals };
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
 * Parse a non-negative finite number.
 * @param {string} label
 * @param {string | undefined} raw
 * @returns {number}
 */
function parseNonNegativeNumber(label, raw) {
  if (raw === undefined || raw.trim() === "") throw new Error(`${label} is required`);
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
  return value;
}

/**
 * Parse simple front matter (`key: value`) from an agent definition.
 * @param {string} text
 * @returns {{ meta: Record<string, string>, body: string }}
 */
function parseFrontMatter(text) {
  if (!text.startsWith("---\n")) return { meta: {}, body: text };
  const end = text.indexOf("\n---", 4);
  if (end === -1) return { meta: {}, body: text };

  /** @type {Record<string, string>} */
  const meta = {};
  for (const line of text.slice(4, end).split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) meta[key] = value;
  }

  return { meta, body: text.slice(end + "\n---".length).trimStart() };
}

/**
 * Load a host-agnostic Budzie agent definition from `agents/`.
 * @param {string} root
 * @param {string} agentName
 * @returns {Promise<AgentDefinition>}
 */
export async function loadAgent(root, agentName) {
  if (!/^[a-z0-9-]+$/i.test(agentName)) {
    throw new Error("agent name must contain only letters, numbers, and hyphens");
  }

  const file = path.join(root, "agents", `${agentName}.md`);
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    const code = /** @type {{ code?: string }} */ (err)?.code;
    if (code === "ENOENT") throw new Error(`agent not found: ${agentName}`);
    throw err;
  }

  const { meta, body } = parseFrontMatter(text);
  return {
    name: meta.name ?? agentName,
    description: meta.description ?? "",
    instructions: body.trim(),
    file,
  };
}

/**
 * Resolve the token usage for a subagent dispatch. Counted session tokens win;
 * explicit estimates are labelled; missing usage remains unknown.
 * @param {{ session?: string, estimate?: number }} opts
 * @returns {AgentUsage}
 */
function resolveUsage(opts) {
  if (opts.session) {
    const usage = readSession(opts.session);
    const label = usage.tokensSource === "counted" ? "counted" : usage.tokensSource;
    return {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      tokensSource: usage.tokensSource === "estimate" ? "estimate" : usage.tokensSource,
      tokenLabel: label,
    };
  }

  if (opts.estimate !== undefined) {
    return {
      inputTokens: null,
      outputTokens: null,
      totalTokens: opts.estimate,
      tokensSource: "estimate",
      tokenLabel: "ESTIMATE (explicit)",
    };
  }

  return {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    tokensSource: "missing",
    tokenLabel: "missing",
  };
}

/**
 * Meter a Budzie subagent dispatch and return the scoped dispatch packet.
 * No network calls are made; host runners execute the returned instructions.
 * @param {{
 *   root?: string,
 *   agentName: string,
 *   task: string,
 *   session?: string,
 *   estimate?: number,
 *   readOnly?: boolean,
 *   env?: NodeJS.ProcessEnv,
 *   budgetFlags?: Record<string, string | true>,
 * }} opts
 * @returns {Promise<DispatchResult>}
 */
export async function dispatchAgent(opts) {
  const root = opts.root ?? process.cwd();
  const agent = await loadAgent(root, opts.agentName);
  const usage = resolveUsage({ session: opts.session, estimate: opts.estimate });
  const config = readConfig(root, opts.budgetFlags ?? {}, opts.env ?? process.env);
  const budget = checkBudget(config, usage.totalTokens);
  const readOnly = opts.readOnly ?? true;

  return {
    agent,
    task: opts.task,
    readOnly,
    usage,
    budget,
    receipt: {
      kind: "subagent_run",
      agent: agent.name,
      task: opts.task,
      tokenLabel: usage.tokenLabel,
      totalTokens: usage.totalTokens,
      budgetStatus: budget.status,
      readOnly,
    },
  };
}

/**
 * Render a subagent run receipt with counted figures first and estimates
 * explicitly labelled.
 * @param {DispatchResult} result
 * @returns {string}
 */
export function renderSubagentReceipt(result) {
  const total =
    result.usage.totalTokens === null
      ? "unknown"
      : result.usage.tokenLabel === "counted"
        ? `${result.usage.totalTokens} counted`
        : `${result.usage.totalTokens} ${result.usage.tokenLabel}`;

  return [
    "Budzie subagent receipt",
    `  agent: ${result.agent.name}`,
    `  task: ${result.task}`,
    `  read-only: ${result.readOnly ? "yes" : "no"}`,
    `  total tokens: ${total}`,
    `  budget: ${result.budget.budget}`,
    `  estimated: ${result.budget.estimated}`,
    `  status: ${result.budget.status}`,
    `  reason: ${result.budget.reason}`,
  ].join("\n");
}

/**
 * CLI entry point.
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const [command = "dispatch", ...rest] = argv;
  if (command !== "dispatch") {
    process.stderr.write(
      "usage: agents.mjs dispatch --agent <name> --task <text> " +
        "[--session <path> | --estimate <n>] [--write] [--json]\n"
    );
    return 1;
  }

  const { flags } = parseArgs(rest);
  const agentName = stringFlag(flags, "agent");
  const task = stringFlag(flags, "task");
  if (!agentName) throw new Error("agent is required");
  if (!task) throw new Error("task is required");
  const estimateRaw = stringFlag(flags, "estimate");
  const session = stringFlag(flags, "session");
  if (estimateRaw !== undefined && session !== undefined) {
    throw new Error("use either --session or --estimate, not both");
  }

  const result = await dispatchAgent({
    root: process.cwd(),
    agentName,
    task,
    session,
    estimate: estimateRaw === undefined ? undefined : parseNonNegativeNumber("estimate", estimateRaw),
    readOnly: flags.write !== true,
    env: process.env,
    budgetFlags: flags,
  });

  if (flags.json === true) {
    process.stdout.write(JSON.stringify(result) + "\n");
  } else {
    process.stdout.write(renderSubagentReceipt(result) + "\n");
  }
  return result.budget.status === "stop" ? 2 : 0;
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
