// @ts-check
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TASKS, taskHash } from "./tasks.mjs";
import { RATES, costUsd } from "./rates.mjs";
import { codeLines } from "./lib/extract.mjs";
import { armPrompts, gradeReply } from "./run.mjs";

/**
 * Breadth sweep across free OpenRouter models. Unlike the paid `run.mjs` path,
 * this one is built for unreliable, rate-limited free tiers: calls run in a
 * bounded concurrency pool, every call retries on 429/transient errors honouring
 * `Retry-After`, and a permanently failing (model, task, arm, run) cell is
 * recorded as a miss and skipped — it never aborts the sweep. Free models cost
 * $0, so there is no spend cap here; the only guard is the per-call timeout and
 * retry ceiling.
 */

/** Schema version, kept in step with measure.mjs's reader. */
const SCHEMA_VERSION = 1;
/** Output ceiling per call. */
const MAX_TOKENS = 4096;
/** Per-call wall-clock ceiling. Healthy free models answer in <10s; 45s is
 * slack for the big ones without letting a dead provider stall the pool. */
const CALL_TIMEOUT_MS = 45_000;
/** Retries after the first attempt before a cell is declared a miss. Free
 * tiers either answer fast or 429-storm; one retry is enough to ride a blip. */
const MAX_RETRIES = 1;
/** Default concurrent in-flight calls. Modest, so providers throttle less. */
const DEFAULT_CONCURRENCY = 6;
/** Consecutive misses that trip a model's breaker, skipping its remaining jobs.
 * Stops a provider that dies mid-sweep from burning every retry budget. */
const TRIP_AFTER = 4;

const ARMS = /** @type {const} */ (["baseline", "terse", "budzie"]);

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * One model call with timeout + retry. Resolves to a metrics object on success
 * or `{ ok: false, error }` once retries are exhausted — never throws.
 *
 * @param {object} a
 * @param {string} a.model
 * @param {string | null} a.system
 * @param {string} a.prompt
 * @param {string} a.endpoint
 * @param {string} a.apiKey
 * @returns {Promise<{ ok: true, text: string, inputTokens: number, outputTokens: number, latencyMs: number } | { ok: false, error: string }>}
 */
async function resilientCall({ model, system, prompt, endpoint, apiKey }) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  const body = JSON.stringify({ model, messages, max_tokens: MAX_TOKENS });

  let lastErr = "unknown";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
    const start = Date.now();
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        signal: ctrl.signal,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body,
      });
      clearTimeout(timer);

      if (res.status === 429) {
        const ra = Number(res.headers.get("retry-after")) || 5;
        lastErr = "429 rate-limited";
        await sleep(Math.min(ra, 15) * 1000);
        continue;
      }
      if (!res.ok) {
        lastErr = `http ${res.status}`;
        await sleep(2000);
        continue;
      }
      const data = await res.json();
      if (data.error) {
        lastErr = String(data.error.message || JSON.stringify(data.error)).slice(0, 120);
        await sleep(2000);
        continue;
      }
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== "string") {
        lastErr = "no content in response";
        await sleep(1000);
        continue;
      }
      return {
        ok: true,
        text,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        latencyMs: Date.now() - start,
      };
    } catch (e) {
      clearTimeout(timer);
      lastErr = e instanceof Error && e.name === "AbortError" ? "timeout" : String(e).slice(0, 120);
      await sleep(1500);
    }
  }
  return { ok: false, error: lastErr };
}

/**
 * Run `worker` over `items` with at most `n` in flight. Order-preserving.
 * @template T, R
 * @param {readonly T[]} items
 * @param {number} n
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
async function pool(items, n, worker) {
  /** @type {R[]} */
  const out = new Array(items.length);
  let next = 0;
  async function runner() {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, runner));
  return out;
}

/**
 * Build the flat job list: one entry per (task, arm, model, run).
 * @param {readonly import("./tasks.mjs").Task[]} tasks
 * @param {readonly string[]} models
 * @param {number} runs
 * @returns {{ task: import("./tasks.mjs").Task, arm: typeof ARMS[number], model: string }[]}
 */
function buildJobs(tasks, models, runs) {
  const jobs = [];
  for (const task of tasks) {
    for (const arm of ARMS) {
      for (const model of models) {
        for (let i = 0; i < runs; i++) jobs.push({ task, arm, model });
      }
    }
  }
  return jobs;
}

/**
 * Read a `--name=value` flag.
 * @param {string[]} argv
 * @param {string} name
 * @returns {string | undefined}
 */
function flagValue(argv, name) {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

/**
 * CLI. Dry by default; `--confirm` makes the (free) calls.
 *
 *   node benchmarks/free-sweep.mjs --models=a:free,b:free [--runs=N]
 *                                  [--concurrency=N] [--confirm]
 *
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  if (process.env.CI) {
    process.stderr.write("Refusing to run the free sweep in CI.\n");
    return 1;
  }
  const modelArg = flagValue(argv, "models");
  const models = modelArg ? modelArg.split(",").filter(Boolean) : [];
  const runs = flagValue(argv, "runs") ? Number(flagValue(argv, "runs")) : 3;
  const concurrency = flagValue(argv, "concurrency")
    ? Number(flagValue(argv, "concurrency"))
    : DEFAULT_CONCURRENCY;
  const confirm = argv.includes("--confirm");

  if (!models.length) {
    process.stderr.write("Free sweep needs --models=<id:free,...>.\n");
    return 1;
  }
  for (const m of models) {
    if (!RATES[m]) {
      process.stderr.write(`No RATES entry for ${m}; add one (FREE) to benchmarks/rates.mjs.\n`);
      return 1;
    }
  }

  const tasks = TASKS.filter((t) => !t.liveOnly);
  const jobs = buildJobs(tasks, models, runs);
  process.stdout.write(
    `Free sweep: ${jobs.length} calls — ${models.length} model(s) x ${tasks.length} task(s) x ` +
      `${ARMS.length} arm(s) x ${runs} run(s), concurrency ${concurrency}. Cost: $0 (free tiers).\n`
  );
  if (!confirm) {
    process.stdout.write("Dry run: re-run with --confirm to make the free calls.\n");
    return 0;
  }

  const endpoint = process.env.BUDZIE_BENCH_ENDPOINT;
  const apiKey = process.env.BUDZIE_BENCH_API_KEY;
  if (!endpoint || !apiKey) {
    process.stderr.write("Live run needs BUDZIE_BENCH_ENDPOINT and BUDZIE_BENCH_API_KEY.\n");
    return 1;
  }

  const prompts = armPrompts();
  /** @type {import("./measure.mjs").RunRow[]} */
  const rows = [];
  /** @type {Record<string, { ok: number, miss: number, skipped: number }>} */
  const coverage = {};
  /** @type {Record<string, number>} */
  const consecMiss = {};
  /** @type {Set<string>} */
  const tripped = new Set();
  for (const m of models) {
    coverage[m] = { ok: 0, miss: 0, skipped: 0 };
    consecMiss[m] = 0;
  }

  await pool(jobs, concurrency, async (job) => {
    if (tripped.has(job.model)) {
      coverage[job.model].skipped++;
      return null;
    }
    const res = await resilientCall({
      model: job.model,
      system: prompts[job.arm],
      prompt: job.task.prompt,
      endpoint,
      apiKey,
    });
    if (!res.ok) {
      coverage[job.model].miss++;
      consecMiss[job.model]++;
      if (consecMiss[job.model] >= TRIP_AFTER && !tripped.has(job.model)) {
        tripped.add(job.model);
        process.stderr.write(`  breaker: ${job.model} tripped after ${TRIP_AFTER} consecutive misses; skipping rest\n`);
      }
      return null;
    }
    consecMiss[job.model] = 0;
    coverage[job.model].ok++;
    const gate = gradeReply(job.task, res.text);
    rows.push({
      task: job.task.id,
      arm: job.arm,
      model: job.model,
      code_lines: codeLines(res.text),
      input_tokens: res.inputTokens,
      output_tokens: res.outputTokens,
      cost_usd: costUsd(job.model, res.inputTokens, res.outputTokens),
      latency_ms: res.latencyMs,
      correctness: gate.skipped ? false : gate.pass,
    });
    return null;
  });

  const date = new Date().toISOString().slice(0, 10);
  /** @type {import("./measure.mjs").Snapshot} */
  const snapshot = {
    meta: {
      schema_version: SCHEMA_VERSION,
      date,
      synthetic: false,
      runsPerCell: runs,
      models: [...models],
      sdkVersion: "http-fetch (free sweep)",
      rates: RATES,
      tokenSource: "API usage field (exact)",
      costSource: "committed RATES table (free tiers = $0)",
      tasks: tasks.map((t) => ({ id: t.id, hash: taskHash(t), language: t.language })),
    },
    runs: rows,
  };

  const dir = fileURLToPath(new URL("./snapshots/", import.meta.url));
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `free-${date}.json`);
  writeFileSync(file, JSON.stringify(snapshot, null, 2) + "\n");

  process.stdout.write(`\nCoverage (ok/miss per model):\n`);
  for (const m of models) {
    const c = coverage[m];
    process.stdout.write(`  ${m}: ${c.ok} ok, ${c.miss} miss, ${c.skipped} skipped${tripped.has(m) ? " (breaker tripped)" : ""}\n`);
  }
  process.stdout.write(`Wrote ${path.relative(process.cwd(), file)} (${rows.length} usable rows)\n`);
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
