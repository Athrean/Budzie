// @ts-check
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TASKS, gradeTask, taskHash } from "./tasks.mjs";
import { RATES, costUsd } from "./rates.mjs";
import { codeLines, primaryCodeBlock } from "./lib/extract.mjs";
import { readConfig, checkBudget } from "../src/budget.mjs";

/** Schema version of the snapshot format. Bump on any shape change. */
const SCHEMA_VERSION = 1;

/** Runs per (task x arm x model). Report the median. */
const RUNS_PER_CELL = 10;

/** Max output tokens requested per call; drives the cost projection ceiling. */
const MAX_TOKENS = 4096;

/**
 * Default ceiling on total paid calls one live run may make. A run projecting
 * more than this refuses unless `--max-calls` raises it. Stops a stray
 * `--runs=1000` from quietly draining a key. budzie: a fixed cap, not a rate
 * limiter; raise it explicitly when a larger sweep is actually intended.
 */
const DEFAULT_MAX_CALLS = 120;

/** The three arms run for every task. */
const ARMS = /** @type {const} */ (["baseline", "terse", "budzie"]);

/** The full SKILL.md body is the budzie system prompt. */
const SKILL_PATH = fileURLToPath(
  new URL("../skills/budzie/SKILL.md", import.meta.url)
);

/**
 * The three arm system prompts. `budzie` is the full SKILL body; `terse` is a
 * generic brevity instruction; `baseline` is no system prompt at all.
 * @returns {Record<"baseline" | "terse" | "budzie", string | null>}
 */
function armPrompts() {
  return {
    baseline: null,
    terse: "Be concise.",
    budzie: readFileSync(SKILL_PATH, "utf8"),
  };
}

/**
 * Make one model call against a generic chat-completions HTTP endpoint and
 * return exact metrics. The endpoint URL, key, and model id are all injected —
 * no vendor, gateway, or model brand is hardcoded here. Any endpoint speaking
 * the `{ choices, usage }` chat-completions shape works.
 *
 * @param {object} args
 * @param {string} args.model
 * @param {string | null} args.system
 * @param {string} args.prompt
 * @param {string} args.endpoint - Full chat-completions URL.
 * @param {string} args.apiKey - Bearer token; never logged.
 * @returns {Promise<{text: string, inputTokens: number, outputTokens: number, latencyMs: number}>}
 */
async function callModel({ model, system, prompt, endpoint, apiKey }) {
  const start = Date.now();
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, max_tokens: MAX_TOKENS }),
  });

  if (!res.ok) {
    // Body may echo the request; never include the key (it is header-only).
    throw new Error(`endpoint error: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const latencyMs = Date.now() - start;

  return {
    text: data.choices[0].message.content,
    inputTokens: data.usage.prompt_tokens,
    outputTokens: data.usage.completion_tokens,
    latencyMs,
  };
}

/**
 * Project the call count and a conservative upper-bound USD cost for a run,
 * before any paid call is made. Input tokens are estimated from prompt+system
 * length (~4 chars/token); output is assumed to hit {@link MAX_TOKENS}.
 *
 * @param {readonly import("./tasks.mjs").Task[]} tasks
 * @param {readonly string[]} models
 * @param {number} runs
 * @returns {{ calls: number, usd: number }}
 */
export function projectCost(tasks, models, runs) {
  const prompts = armPrompts();
  let calls = 0;
  let usd = 0;
  for (const task of tasks) {
    for (const arm of ARMS) {
      for (const model of models) {
        const system = prompts[arm] ?? "";
        const inputTokens = Math.ceil((system.length + task.prompt.length) / 4);
        for (let i = 0; i < runs; i++) {
          calls++;
          usd += costUsd(model, inputTokens, MAX_TOKENS);
        }
      }
    }
  }
  return { calls, usd };
}

/**
 * Run the full live benchmark and return a snapshot object.
 * @param {object} opts
 * @param {readonly string[]} opts.models
 * @param {number} opts.runs
 * @param {boolean} opts.liveOnly - Include live-only (e.g. python) tasks.
 * @param {string} opts.endpoint
 * @param {string} opts.apiKey
 * @returns {Promise<import("./measure.mjs").Snapshot>}
 */
export async function runLive({ models, runs, liveOnly, endpoint, apiKey }) {
  const prompts = armPrompts();
  /** @type {import("./measure.mjs").RunRow[]} */
  const rows = [];
  const tasks = TASKS.filter((t) => liveOnly || !t.liveOnly);

  for (const task of tasks) {
    for (const arm of ARMS) {
      for (const model of models) {
        for (let i = 0; i < runs; i++) {
          const out = await callModel({
            model,
            system: prompts[arm],
            prompt: task.prompt,
            endpoint,
            apiKey,
          });
          const code = primaryCodeBlock(out.text);
          const gate = gradeTask(task, code);
          rows.push({
            task: task.id,
            arm,
            model,
            code_lines: codeLines(out.text),
            input_tokens: out.inputTokens,
            output_tokens: out.outputTokens,
            cost_usd: costUsd(model, out.inputTokens, out.outputTokens),
            latency_ms: out.latencyMs,
            correctness: gate.skipped ? false : gate.pass,
          });
        }
      }
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  return {
    meta: {
      schema_version: SCHEMA_VERSION,
      date,
      synthetic: false,
      runsPerCell: runs,
      models: [...models],
      sdkVersion: "http-fetch",
      rates: RATES,
      tokenSource: "API usage field (exact)",
      costSource: "committed RATES table (model -> $/Mtok input+output)",
      tasks: tasks.map((t) => ({ id: t.id, hash: taskHash(t), language: t.language })),
    },
    runs: rows,
  };
}

/**
 * Read a `--name=value` flag from argv.
 * @param {string[]} argv
 * @param {string} name
 * @returns {string | undefined}
 */
function flagValue(argv, name) {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

/**
 * CLI entry. Safe by default: prints a cost projection and makes NO paid call
 * unless `--confirm` is passed. Refuses in CI, refuses a run projecting past
 * the call cap or a USD budget ceiling, and requires endpoint+key only at the
 * moment real calls fire. The no-network path is `node benchmarks/measure.mjs`.
 *
 *   node benchmarks/run.mjs --models=<id,id> [--runs=N] [--max-calls=N]
 *                           [--include-python] [--confirm]
 *
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  if (process.env.CI) {
    process.stderr.write("Refusing to run the live benchmark in CI.\n");
    return 1;
  }

  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const modelArg = flagValue(argv, "models");
  const models = modelArg ? modelArg.split(",").filter(Boolean) : [];
  const runs = flagValue(argv, "runs") ? Number(flagValue(argv, "runs")) : RUNS_PER_CELL;
  const maxCalls = flagValue(argv, "max-calls")
    ? Number(flagValue(argv, "max-calls"))
    : DEFAULT_MAX_CALLS;
  const liveOnly = flags.has("--include-python");
  const confirm = flags.has("--confirm");

  if (!models.length) {
    process.stderr.write(
      "Live benchmark needs --models=<id,id>. This path is opt-in and makes " +
        "real, paid API calls. Use `node benchmarks/measure.mjs` for the no-network path.\n"
    );
    return 1;
  }
  if (!Number.isInteger(runs) || runs < 1) {
    process.stderr.write("--runs must be a positive integer.\n");
    return 1;
  }
  for (const m of models) {
    if (!RATES[m]) {
      process.stderr.write(`No RATES entry for model ${m}; add one to benchmarks/rates.mjs first.\n`);
      return 1;
    }
  }

  const tasks = TASKS.filter((t) => liveOnly || !t.liveOnly);
  const { calls, usd } = projectCost(tasks, models, runs);

  process.stdout.write(
    `Projection: ${calls} paid calls across ${models.length} model(s) x ` +
      `${tasks.length} task(s) x ${ARMS.length} arm(s) x ${runs} run(s).\n` +
      `Estimated upper-bound cost: $${usd.toFixed(4)} ` +
      `(assumes ${MAX_TOKENS} output tokens/call).\n`
  );

  if (calls > maxCalls) {
    process.stderr.write(
      `Refusing: ${calls} projected calls exceeds --max-calls=${maxCalls}. ` +
        "Lower --runs/--models or raise --max-calls explicitly.\n"
    );
    return 1;
  }

  // Budget guard: enforce a stop only against a USD ceiling (the projection's
  // unit). A token/other-unit ceiling can't be compared to a dollar estimate.
  const config = readConfig(process.cwd());
  const usdConfig = config && config.unit === "usd" ? config : null;
  const check = checkBudget(usdConfig, usd);
  if (check.status === "stop") {
    process.stderr.write(
      `Budget guard: ${check.reason} (ceiling ${check.budget}, projected $${usd.toFixed(4)}).\n`
    );
    return 1;
  }
  if (check.status === "warn") {
    process.stderr.write(`Budget guard warning: ${check.reason} (ceiling ${check.budget}).\n`);
  }

  if (!confirm) {
    process.stdout.write(
      "Dry run: no paid calls made. Re-run with --confirm to execute the projected calls.\n"
    );
    return 0;
  }

  const endpoint = process.env.BUDZIE_BENCH_ENDPOINT;
  const apiKey = process.env.BUDZIE_BENCH_API_KEY;
  if (!endpoint || !apiKey) {
    process.stderr.write(
      "Live run needs BUDZIE_BENCH_ENDPOINT (chat-completions URL) and " +
        "BUDZIE_BENCH_API_KEY. Neither is logged or committed.\n"
    );
    return 1;
  }

  const snapshot = await runLive({ models, runs, liveOnly, endpoint, apiKey });
  const dir = fileURLToPath(new URL("./snapshots/", import.meta.url));
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${snapshot.meta.date}.json`);
  writeFileSync(file, JSON.stringify(snapshot, null, 2) + "\n");
  process.stdout.write(`Wrote ${path.relative(process.cwd(), file)}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
      process.exitCode = 1;
    }
  );
}
