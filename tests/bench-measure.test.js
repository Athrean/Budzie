// @ts-check
import assert from "node:assert/strict";
import test from "node:test";

import {
  measure,
  cell,
  renderResults,
  ARMS,
} from "../benchmarks/measure.mjs";
import { median, passRate } from "../benchmarks/lib/stats.mjs";

/** A small deterministic fixture snapshot. */
const FIXTURE = {
  meta: {
    schema_version: 1,
    date: "2026-01-01",
    synthetic: true,
    runsPerCell: 3,
    models: ["m1"],
    tokenSource: "API usage field (exact)",
    costSource: "committed RATES table",
    tasks: [{ id: "t1", hash: "abc", language: "js" }],
  },
  runs: [
    row("t1", "budzie", "m1", 5, 100, 0.001, 1000, true),
    row("t1", "budzie", "m1", 7, 120, 0.002, 1200, true),
    row("t1", "budzie", "m1", 9, 140, 0.003, 800, false),
    row("t1", "terse", "m1", 10, 200, 0.004, 1100, true),
    row("t1", "terse", "m1", 12, 220, 0.005, 1300, true),
    row("t1", "terse", "m1", 14, 240, 0.006, 900, true),
  ],
};

/**
 * @param {string} task
 * @param {string} arm
 * @param {string} model
 * @param {number} code_lines
 * @param {number} output_tokens
 * @param {number} cost_usd
 * @param {number} latency_ms
 * @param {boolean} correctness
 * @returns {import("../benchmarks/measure.mjs").RunRow}
 */
function row(task, arm, model, code_lines, output_tokens, cost_usd, latency_ms, correctness) {
  return {
    task, arm, model,
    code_lines,
    input_tokens: 50,
    output_tokens,
    cost_usd,
    latency_ms,
    correctness,
  };
}

test("measure() computes medians per (task, arm, model)", () => {
  const agg = measure(FIXTURE);
  const budzie = cell(agg, "t1", "budzie", "m1");
  assert.ok(budzie);
  assert.equal(budzie.codeLines, median([5, 7, 9])); // 7
  assert.equal(budzie.outputTokens, median([100, 120, 140])); // 120
  assert.equal(budzie.latencyMs, median([1000, 1200, 800])); // 1000
  assert.equal(budzie.passRate, passRate([true, true, false])); // 2/3
  assert.equal(budzie.n, 3);

  const terse = cell(agg, "t1", "terse", "m1");
  assert.ok(terse);
  assert.equal(terse.codeLines, 12);
  assert.equal(terse.passRate, 1);
});

test("measure() is deterministic: same fixture -> identical aggregate", () => {
  const a = measure(FIXTURE);
  const b = measure(FIXTURE);
  assert.deepEqual(a, b);
});

test("renderResults() is deterministic: same aggregate -> identical table", () => {
  const agg = measure(FIXTURE);
  const m1 = renderResults(agg, FIXTURE.meta);
  const m2 = renderResults(agg, FIXTURE.meta);
  assert.equal(m1, m2);
});

test("headline delta in the table is budzie minus terse (negative = saved)", () => {
  const agg = measure(FIXTURE);
  const md = renderResults(agg, FIXTURE.meta);
  // budzie code_lines median 7, terse 12 -> delta -5.0
  assert.match(md, /\| t1 \| m1 \| -5\.0 \|/);
  assert.match(md, /budzie - terse/);
});

test("renderResults discloses token and cost sources", () => {
  const agg = measure(FIXTURE);
  const md = renderResults(agg, FIXTURE.meta);
  assert.match(md, /Token source:/);
  assert.match(md, /Cost source:/);
});

test("renderResults flags synthetic seed data", () => {
  const agg = measure(FIXTURE);
  const md = renderResults(agg, { ...FIXTURE.meta, synthetic: true });
  assert.match(md, /SYNTHETIC SEED DATA/);
});

test("ARMS lists all three arms in order", () => {
  assert.deepEqual([...ARMS], ["baseline", "terse", "budzie"]);
});

test("empty groups produce a dash, not a crash", () => {
  const agg = measure({ meta: {}, runs: [] });
  assert.deepEqual(agg.tasks, []);
  const md = renderResults(agg, {});
  assert.match(md, /Budzie savings benchmark/);
});
