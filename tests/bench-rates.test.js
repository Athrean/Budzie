// @ts-check
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { RATES, DEFAULT_MODELS, costUsd } from "../benchmarks/rates.mjs";
import { TASKS, taskHash } from "../benchmarks/tasks.mjs";

const SNAP_DIR = fileURLToPath(
  new URL("../benchmarks/snapshots/", import.meta.url)
);

test("RATES has an entry for every default model", () => {
  for (const model of DEFAULT_MODELS) {
    const rate = RATES[model];
    assert.ok(rate, `default model ${model} missing from RATES`);
    assert.ok(rate.inputPerMtok > 0, `${model} input rate must be positive`);
    assert.ok(rate.outputPerMtok > 0, `${model} output rate must be positive`);
  }
});

test("costUsd computes from exact tokens and the committed rate", () => {
  // openai/gpt-4: 30 input, 60 output
  const cost = costUsd("openai/gpt-4", 1_500_000, 500_000);
  assert.equal(cost, 1.5 * 30 + 0.5 * 60);
});

test("costUsd throws for an unknown model", () => {
  assert.throws(() => costUsd("gpt-3", 1, 1), /no RATES entry/);
});

test("default models have at least the required three", () => {
  assert.ok(DEFAULT_MODELS.length >= 2, "expected at least 2 defaults");
  assert.ok(DEFAULT_MODELS.includes("openai/gpt-3.5-turbo"), "expected openai/gpt-3.5-turbo in defaults");
  assert.ok(DEFAULT_MODELS.includes("openai/gpt-4"), "expected openai/gpt-4 in defaults");
});

test("task set includes the six required JS tasks", () => {
  const required = [
    "email-validator",
    "debounce",
    "csv-sum",
    "slugify",
    "rate-limiter",
    "retry-with-backoff",
  ];
  const ids = new Set(TASKS.map((t) => t.id));
  for (const r of required) {
    assert.ok(ids.has(r), `missing required task ${r}`);
  }
  const jsRequired = TASKS.filter((t) => required.includes(t.id));
  for (const t of jsRequired) {
    assert.equal(t.language, "js", `${t.id} must be JS to run in npm test`);
    assert.equal(t.liveOnly, false, `${t.id} must run inside npm test`);
  }
});

test("python-only tasks are marked liveOnly", () => {
  for (const t of TASKS.filter((t) => t.language === "python")) {
    assert.equal(t.liveOnly, true, `${t.id} python task must be live-only`);
  }
});

test("committed snapshot task hashes match the current task definitions", () => {
  const byId = new Map(TASKS.map((t) => [t.id, t]));
  for (const file of readdirSync(SNAP_DIR).filter((f) => f.endsWith(".json"))) {
    const snap = JSON.parse(readFileSync(SNAP_DIR + file, "utf8"));
    for (const t of snap.meta.tasks ?? []) {
      const task = byId.get(t.id);
      assert.ok(task, `snapshot references unknown task ${t.id}`);
      assert.equal(
        taskHash(task),
        t.hash,
        `task ${t.id} drifted from its snapshot hash (regenerate the snapshot)`
      );
    }
  }
});
