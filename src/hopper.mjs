// @ts-check
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { dispatchAgent } from "./agents.mjs";
import { checkBudget, readConfig } from "./budget.mjs";

/**
 * @typedef {import("./budget.mjs").BudgetConfig} BudgetConfig
 * @typedef {import("./agents.mjs").AgentUsage} AgentUsage
 * @typedef {{ budget: string, estimated: string, status: "ok" | "warn" | "stop", reason: string }} BudgetCheck
 *
 * @typedef {object} CrewMember
 * @property {string} agent - Agent definition name under agents/.
 * @property {string} task - The scoped task handed to this member.
 * @property {number} [estimate] - Explicit token estimate for this member.
 * @property {string} [session] - Path to a session log to count this member's tokens from.
 * @property {string[]} [context] - Scoped context lines for this member (never session history).
 * @property {boolean} [readOnly] - Defaults to true.
 *
 * @typedef {object} MemberOutcome
 * @property {CrewMember} member
 * @property {string} agent - Resolved agent name.
 * @property {AgentUsage} usage
 * @property {string} scopedContext - The constructed handoff this member received.
 * @property {BudgetCheck} budget - This member's slice check.
 *
 * @typedef {object} CrewResult
 * @property {MemberOutcome[]} members - In dispatch (input) order.
 * @property {number | null} totalTokens - Sum of known member totals, or null when none are known.
 * @property {boolean} tokensComplete - False when any member's usage is unknown.
 * @property {string} tokenLabel - "counted" when every member was counted, else "estimate".
 * @property {BudgetCheck} budget - Aggregate vs the full ceiling.
 * @property {"ok" | "warn" | "stop"} status - Worst of the aggregate and any single member's slice.
 */

/**
 * Build the minimal scoped context handed to one crew member. It is constructed
 * only from the member's explicit task and context lines — never the caller's
 * session history. This is the token-lean handoff: a member sees what it needs,
 * not the whole transcript.
 * @param {CrewMember} member
 * @returns {string}
 */
export function scopeContext(member) {
  const lines = [`Task: ${member.task}`];
  if (member.context && member.context.length) {
    lines.push("", "Scoped context:");
    for (const line of member.context) lines.push(`- ${line}`);
  }
  return lines.join("\n");
}

/**
 * Split a budget ceiling evenly across `n` crew members. Each member's slice is
 * ceiling/n, so the slices sum to exactly the ceiling — the aggregate can never
 * exceed the allowance. Returns null when there is no configured ceiling.
 * @param {BudgetConfig | null} config
 * @param {number} n
 * @returns {{ perMember: BudgetConfig | null, slice: number | null }}
 */
export function splitBudget(config, n) {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error("crew size must be a positive integer");
  }
  if (!config) return { perMember: null, slice: null };
  const slice = config.ceiling / n;
  return { perMember: { ...config, ceiling: slice }, slice };
}

/** Severity rank so the worst status wins a merge. */
const RANK = /** @type {const} */ ({ ok: 0, warn: 1, stop: 2 });

/**
 * Deterministically merge member outcomes into a crew result. Same inputs in,
 * identical result out — no clock, no order dependence beyond the given input
 * order. Aggregate tokens are summed and checked against the full ceiling; the
 * crew status is the worst of the aggregate and any single member's slice, so a
 * per-member hard-stop is honoured even when the sum fits.
 * @param {MemberOutcome[]} outcomes
 * @param {BudgetConfig | null} config
 * @returns {CrewResult}
 */
export function mergeCrew(outcomes, config) {
  const totals = outcomes.map((o) => o.usage.totalTokens);
  const known = /** @type {number[]} */ (totals.filter((t) => t !== null));
  const tokensComplete = known.length === totals.length;
  const totalTokens = known.length ? known.reduce((a, b) => a + b, 0) : null;
  const allCounted =
    outcomes.length > 0 && outcomes.every((o) => o.usage.tokenLabel === "counted");

  const budget = checkBudget(config, totalTokens);
  /** @type {"ok" | "warn" | "stop"} */
  let status = budget.status;
  for (const o of outcomes) {
    if (RANK[o.budget.status] > RANK[status]) status = o.budget.status;
  }

  return {
    members: outcomes,
    totalTokens,
    tokensComplete,
    tokenLabel: allCounted ? "counted" : "estimate",
    budget,
    status,
  };
}

/**
 * Dispatch a crew of subagents concurrently (parallel fan-out), each metered
 * against its slice of the task ceiling and handed only its scoped context.
 * No network: host runners execute the returned per-member instructions. The
 * merge is deterministic and order-preserving.
 * @param {{
 *   root?: string,
 *   members: CrewMember[],
 *   env?: NodeJS.ProcessEnv,
 *   budgetFlags?: Record<string, string | true>,
 *   config?: BudgetConfig | null,
 * }} opts
 * @returns {Promise<CrewResult>}
 */
export async function dispatchCrew(opts) {
  const root = opts.root ?? process.cwd();
  if (!Array.isArray(opts.members) || opts.members.length === 0) {
    throw new Error("crew needs at least one member");
  }
  const env = opts.env ?? process.env;
  const flags = opts.budgetFlags ?? {};
  // An explicit `config` (e.g. a per-stage slice handed down by runPipeline)
  // overrides the read-from-disk config. `undefined` means "read it from the
  // project/env"; `null` means "no budget configured".
  const config = opts.config !== undefined ? opts.config : readConfig(root, flags, env);
  const { perMember } = splitBudget(config, opts.members.length);

  // Parallel fan-out: every member is dispatched concurrently. dispatchAgent
  // does a real (local) agent-file load + metering per member, and Promise.all
  // runs them at once. Promise.all preserves input order, so the merge is
  // stable regardless of which member resolves first.
  const outcomes = await Promise.all(
    opts.members.map(async (member) => {
      const scopedContext = scopeContext(member);
      const dispatch = await dispatchAgent({
        root,
        agentName: member.agent,
        task: scopedContext,
        session: member.session,
        estimate: member.estimate,
        readOnly: member.readOnly ?? true,
        env,
        budgetFlags: flags,
      });
      // Re-meter against this member's budget slice; dispatchAgent checked the
      // full ceiling, but the slice is what bounds an individual member.
      return {
        member,
        agent: dispatch.agent.name,
        usage: dispatch.usage,
        scopedContext,
        budget: checkBudget(perMember, dispatch.usage.totalTokens),
      };
    })
  );

  return mergeCrew(outcomes, config);
}

/**
 * Render a crew receipt: per-member lines (counted vs estimate labelled) plus
 * the aggregate budget verdict. Counted figures show first; estimates are
 * always labelled, never silently mixed.
 * @param {CrewResult} crew
 * @returns {string}
 */
export function renderCrewReceipt(crew) {
  const lines = ["Budzie crew receipt", `  members: ${crew.members.length}`];
  for (const o of crew.members) {
    const t =
      o.usage.totalTokens === null
        ? "unknown"
        : o.usage.tokenLabel === "counted"
          ? `${o.usage.totalTokens} counted`
          : `${o.usage.totalTokens} ${o.usage.tokenLabel}`;
    lines.push(`  - ${o.agent}: ${t}, slice ${o.budget.status} (${o.budget.budget})`);
  }
  const agg =
    crew.totalTokens === null
      ? "unknown"
      : `${crew.totalTokens} ${crew.tokenLabel}${crew.tokensComplete ? "" : " (partial)"}`;
  lines.push(
    `  aggregate tokens: ${agg}`,
    `  budget: ${crew.budget.budget}`,
    `  estimated: ${crew.budget.estimated}`,
    `  status: ${crew.status}`,
    `  reason: ${crew.budget.reason}`
  );
  return lines.join("\n");
}

/**
 * Validate a list of crew members. One shared validator so the crew spec and
 * every pipeline stage enforce the same shape (no duplicated business logic).
 * @param {unknown} members
 * @param {string} label - Context for the error message ("spec", a stage name).
 * @returns {CrewMember[]}
 */
function validateMembers(members, label) {
  if (!Array.isArray(members) || members.length === 0) {
    throw new Error(`${label} must be a non-empty array of members`);
  }
  for (const m of members) {
    if (!m || typeof m.agent !== "string" || typeof m.task !== "string") {
      throw new Error(`${label}: each member needs string \`agent\` and \`task\``);
    }
  }
  return /** @type {CrewMember[]} */ (members);
}

/**
 * Parse a crew spec: an array of members, or `{ members: [...] }`.
 * @param {string} text
 * @returns {CrewMember[]}
 */
export function parseSpec(text) {
  const data = JSON.parse(text);
  const members = Array.isArray(data) ? data : data?.members;
  return validateMembers(members, "spec");
}

/* -------------------------------------------------------------------------- */
/* Pipeline: ordered stages, each stage a parallel crew (Hopper's harness).    */
/* -------------------------------------------------------------------------- */

/**
 * One ordered stage of a pipeline: a labelled parallel crew.
 * @typedef {object} PipelineStage
 * @property {string} name - Stage label (e.g. "audit", "reap", "review").
 * @property {CrewMember[]} members - Members dispatched in parallel for this stage.
 *
 * @typedef {object} StageOutcome
 * @property {string} name - The stage label.
 * @property {"ran" | "skipped"} state - "skipped" when an earlier stage hard-stopped the run.
 * @property {CrewResult | null} crew - The crew result, or null when skipped.
 *
 * @typedef {object} PipelineResult
 * @property {StageOutcome[]} stages - In input (run) order.
 * @property {number | null} totalTokens - Sum of known stage totals, or null when none are known.
 * @property {boolean} tokensComplete - False when any stage token figure is unknown or a stage was skipped.
 * @property {string} tokenLabel - "counted" only when every stage that ran was fully counted.
 * @property {BudgetCheck} budget - Aggregate vs the full ceiling.
 * @property {"ok" | "warn" | "stop"} status - Worst of the aggregate and any stage that ran.
 */

/**
 * Deterministically merge stage outcomes into a pipeline result. Aggregate
 * tokens are summed across stages that ran and checked against the full
 * ceiling; the pipeline status is the worst of that aggregate and any single
 * stage. Same inputs in, identical result out — no clock, no race.
 * @param {StageOutcome[]} outcomes
 * @param {BudgetConfig | null} config
 * @returns {PipelineResult}
 */
export function mergePipeline(outcomes, config) {
  const ran = outcomes.filter((o) => o.state === "ran" && o.crew);
  const totals = ran.map((o) => /** @type {CrewResult} */ (o.crew).totalTokens);
  const known = /** @type {number[]} */ (totals.filter((t) => t !== null));
  const totalTokens = known.length ? known.reduce((a, b) => a + b, 0) : null;
  const skipped = outcomes.some((o) => o.state === "skipped");
  const tokensComplete =
    !skipped &&
    known.length === totals.length &&
    ran.every((o) => /** @type {CrewResult} */ (o.crew).tokensComplete);
  const allCounted =
    ran.length > 0 &&
    ran.every((o) => /** @type {CrewResult} */ (o.crew).tokenLabel === "counted");

  const budget = checkBudget(config, totalTokens);
  /** @type {"ok" | "warn" | "stop"} */
  let status = budget.status;
  for (const o of ran) {
    const s = /** @type {CrewResult} */ (o.crew).status;
    if (RANK[s] > RANK[status]) status = s;
  }

  return {
    stages: outcomes,
    totalTokens,
    tokensComplete,
    tokenLabel: allCounted ? "counted" : "estimate",
    budget,
    status,
  };
}

/**
 * Run an ordered pipeline of stages. The ceiling is split across stages
 * (`ceiling / stages`), then each stage's crew splits its slice across its own
 * members — two-level budget slicing whose total never exceeds the allowance.
 * Stages run in order; in `stop` mode the first stage that hard-stops halts the
 * pipeline and the rest are marked skipped (never silently run). No network:
 * host runners execute the per-member instructions; this orchestrates + meters.
 * @param {{
 *   root?: string,
 *   stages: PipelineStage[],
 *   env?: NodeJS.ProcessEnv,
 *   budgetFlags?: Record<string, string | true>,
 * }} opts
 * @returns {Promise<PipelineResult>}
 */
export async function runPipeline(opts) {
  const root = opts.root ?? process.cwd();
  if (!Array.isArray(opts.stages) || opts.stages.length === 0) {
    throw new Error("pipeline needs at least one stage");
  }
  const env = opts.env ?? process.env;
  const flags = opts.budgetFlags ?? {};
  const config = readConfig(root, flags, env);
  const { perMember: perStage } = splitBudget(config, opts.stages.length);

  /** @type {StageOutcome[]} */
  const outcomes = [];
  let halted = false;
  for (const stage of opts.stages) {
    if (halted) {
      outcomes.push({ name: stage.name, state: "skipped", crew: null });
      continue;
    }
    const crew = await dispatchCrew({
      root,
      members: stage.members,
      env,
      budgetFlags: flags,
      config: perStage,
    });
    outcomes.push({ name: stage.name, state: "ran", crew });
    // A hard stop (only reachable in stop mode) halts the remaining stages.
    if (crew.status === "stop") halted = true;
  }

  return mergePipeline(outcomes, config);
}

/**
 * Render a pipeline receipt: one block per stage (members labelled counted vs
 * estimate; skipped stages stated plainly) plus the aggregate verdict.
 * @param {PipelineResult} pipeline
 * @returns {string}
 */
export function renderPipelineReceipt(pipeline) {
  const lines = ["Budzie pipeline receipt", `  stages: ${pipeline.stages.length}`];
  for (const stage of pipeline.stages) {
    if (stage.state === "skipped" || !stage.crew) {
      lines.push(`  [${stage.name}] skipped — earlier stage hit a budget stop`);
      continue;
    }
    lines.push(`  [${stage.name}] ${stage.crew.status} (members: ${stage.crew.members.length})`);
    for (const o of stage.crew.members) {
      const t =
        o.usage.totalTokens === null
          ? "unknown"
          : o.usage.tokenLabel === "counted"
            ? `${o.usage.totalTokens} counted`
            : `${o.usage.totalTokens} ${o.usage.tokenLabel}`;
      lines.push(`    - ${o.agent}: ${t}, slice ${o.budget.status}`);
    }
  }
  const agg =
    pipeline.totalTokens === null
      ? "unknown"
      : `${pipeline.totalTokens} ${pipeline.tokenLabel}${pipeline.tokensComplete ? "" : " (partial)"}`;
  lines.push(
    `  aggregate tokens: ${agg}`,
    `  budget: ${pipeline.budget.budget}`,
    `  estimated: ${pipeline.budget.estimated}`,
    `  status: ${pipeline.status}`,
    `  reason: ${pipeline.budget.reason}`
  );
  return lines.join("\n");
}

/**
 * Parse a pipeline spec: `{ stages: [{ name, members: [...] }, ...] }`. Each
 * stage's members go through the shared crew-member validator.
 * @param {string} text
 * @returns {PipelineStage[]}
 */
export function parsePipelineSpec(text) {
  const data = JSON.parse(text);
  const stages = data?.stages;
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new Error("pipeline spec must be { stages: [ { name, members: [...] }, ... ] }");
  }
  return stages.map((stage, i) => {
    if (!stage || typeof stage.name !== "string" || stage.name.trim() === "") {
      throw new Error(`stage ${i} needs a non-empty string \`name\``);
    }
    return { name: stage.name, members: validateMembers(stage.members, `stage "${stage.name}"`) };
  });
}

/**
 * Parse `--key value`, `--key=value`, and boolean flags, ignoring positionals.
 * @param {string[]} argv
 * @returns {Record<string, string | true>}
 */
function parseFlags(argv) {
  /** @type {Record<string, string | true>} */
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq !== -1) {
      flags[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

/**
 * Read a spec from `--spec <file>`, else from stdin.
 * @param {Record<string, string | true>} flags
 * @returns {string}
 */
function readSpec(flags) {
  const specPath = typeof flags.spec === "string" ? flags.spec : undefined;
  return specPath ? readFileSync(specPath, "utf8") : readFileSync(0, "utf8");
}

/**
 * CLI entry point. `pipeline` runs ordered stages; `crew` (the default) runs a
 * single parallel fan-out. Both read a spec from `--spec <file>` or stdin and
 * print a receipt (`--json` for the raw object). Exits 2 on an aggregate stop.
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  let command = "crew";
  let rest = argv;
  if (argv[0] && !argv[0].startsWith("--")) {
    command = argv[0];
    rest = argv.slice(1);
  }
  const flags = parseFlags(rest);

  /** @type {Record<string, string | true>} */
  const budgetFlags = {};
  if (typeof flags.config === "string") budgetFlags.config = flags.config;

  if (command === "pipeline") {
    const stages = parsePipelineSpec(readSpec(flags));
    const pipeline = await runPipeline({
      root: process.cwd(),
      stages,
      env: process.env,
      budgetFlags,
    });
    process.stdout.write(
      (flags.json === true ? JSON.stringify(pipeline) : renderPipelineReceipt(pipeline)) + "\n"
    );
    return pipeline.status === "stop" ? 2 : 0;
  }

  if (command === "crew") {
    const members = parseSpec(readSpec(flags));
    const crew = await dispatchCrew({
      root: process.cwd(),
      members,
      env: process.env,
      budgetFlags,
    });
    process.stdout.write(
      (flags.json === true ? JSON.stringify(crew) : renderCrewReceipt(crew)) + "\n"
    );
    return crew.status === "stop" ? 2 : 0;
  }

  process.stderr.write(
    "usage: hopper.mjs pipeline|crew --spec <file> [--json] [--config <path>]\n"
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
