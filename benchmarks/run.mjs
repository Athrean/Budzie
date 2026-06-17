// @ts-check
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TASKS, gradeTask, taskHash } from "./tasks.mjs";
import { DEFAULT_MODELS, RATES, costUsd } from "./rates.mjs";
import { codeLines, primaryCodeBlock } from "./lib/extract.mjs";

/** Schema version of the snapshot format. Bump on any shape change. */
const SCHEMA_VERSION = 1;

/** Runs per (task x arm x model). Report the median. */
const RUNS_PER_CELL = 10;

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
 * Make one model call and return exact metrics. The Anthropic SDK is imported
 * lazily here — only the live path needs it, so the no-network path and tests
 * require zero dependencies.
 *
 * @param {object} args
 * @param {string} args.model
 * @param {string | null} args.system
 * @param {string} args.prompt
 * @returns {Promise<{text: string, inputTokens: number, outputTokens: number, latencyMs: number}>}
 */
async function callModel({ model, system, prompt }) {
  // @ts-ignore - optional live-only dependency, resolved lazily; not installed
  // for the no-network path or typecheck. Install @anthropic-ai/sdk to run live.
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const start = Date.now();
  /** @type {Record<string, unknown>} */
  const req = {
    model,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  };
  if (system) req.system = system;
  const resp = await client.messages.create(req);
  const latencyMs = Date.now() - start;
  let text = "";
  for (const block of resp.content) {
    if (block.type === "text") text += block.text;
  }
  return {
    text,
    inputTokens: resp.usage.input_tokens,
    outputTokens: resp.usage.output_tokens,
    latencyMs,
  };
}

/**
 * Run the full live benchmark and return a snapshot object.
 * @param {object} opts
 * @param {readonly string[]} opts.models
 * @param {number} opts.runs
 * @param {boolean} opts.liveOnly - Include live-only (e.g. python) tasks.
 * @returns {Promise<import("./measure.mjs").Snapshot>}
 */
export async function runLive({ models, runs, liveOnly }) {
  const prompts = armPrompts();
  /** @type {import("./measure.mjs").RunRow[]} */
  const rows = [];
  const tasks = TASKS.filter((t) => liveOnly || !t.liveOnly);

  for (const task of tasks) {
    for (const arm of /** @type {const} */ (["baseline", "terse", "budzie"])) {
      for (const model of models) {
        for (let i = 0; i < runs; i++) {
          const out = await callModel({
            model,
            system: prompts[arm],
            prompt: task.prompt,
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
      sdkVersion: await sdkVersion(),
      rates: RATES,
      tokenSource: "API usage field (exact)",
      costSource: "committed RATES table (model -> $/Mtok input+output)",
      tasks: tasks.map((t) => ({ id: t.id, hash: taskHash(t), language: t.language })),
    },
    runs: rows,
  };
}

/**
 * Read the installed Anthropic SDK version, lazily and best-effort.
 * @returns {Promise<string>}
 */
async function sdkVersion() {
  try {
    const url = new URL(
      "../node_modules/@anthropic-ai/sdk/package.json",
      import.meta.url
    );
    return JSON.parse(readFileSync(url, "utf8")).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * CLI entry. Opt-in live path: refuses to run without an API key, and never in
 * CI. Writes a fresh snapshot under benchmarks/snapshots/<date>.json.
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  if (process.env.CI) {
    process.stderr.write("Refusing to run the live benchmark in CI.\n");
    return 1;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write(
      "Live benchmark needs ANTHROPIC_API_KEY. This path is opt-in and makes " +
        "real API calls. Use `node benchmarks/measure.mjs` for the no-network path.\n"
    );
    return 1;
  }

  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const modelArg = argv.find((a) => a.startsWith("--models="));
  const models = modelArg
    ? modelArg.slice("--models=".length).split(",").filter(Boolean)
    : DEFAULT_MODELS;
  const runs = RUNS_PER_CELL;
  const liveOnly = flags.has("--include-python");

  for (const m of models) {
    if (!RATES[m]) {
      process.stderr.write(`No RATES entry for model ${m}; add one first.\n`);
      return 1;
    }
  }

  const snapshot = await runLive({ models, runs, liveOnly });
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
