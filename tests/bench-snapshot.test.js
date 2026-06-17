// @ts-check
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { RATES, DEFAULT_MODELS } from "../benchmarks/rates.mjs";

/** Snapshots directory. */
const SNAP_DIR = fileURLToPath(
  new URL("../benchmarks/snapshots/", import.meta.url)
);

/** Required keys on every run row, with their JS typeof. */
const RUN_FIELD_TYPES = {
  task: "string",
  arm: "string",
  model: "string",
  code_lines: "number",
  input_tokens: "number",
  output_tokens: "number",
  cost_usd: "number",
  latency_ms: "number",
  correctness: "boolean",
};

/** Load every committed snapshot file. */
function loadSnapshots() {
  return readdirSync(SNAP_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(SNAP_DIR + f, "utf8")));
}

test("at least one committed snapshot exists", () => {
  assert.ok(loadSnapshots().length >= 1, "expected a committed seed snapshot");
});

test("snapshot meta has required fields with correct types", () => {
  for (const snap of loadSnapshots()) {
    const m = snap.meta;
    assert.equal(typeof m.schema_version, "number", "schema_version");
    assert.equal(typeof m.date, "string", "date");
    assert.equal(typeof m.synthetic, "boolean", "synthetic flag");
    assert.ok(Array.isArray(m.models), "models array");
    assert.ok(m.tokenSource && typeof m.tokenSource === "string", "tokenSource disclosure");
    assert.ok(m.costSource && typeof m.costSource === "string", "costSource disclosure");
    assert.ok(m.rates && typeof m.rates === "object", "RATES table embedded");
    assert.ok(Array.isArray(m.tasks), "task id/hash list");
    for (const t of m.tasks) {
      assert.equal(typeof t.id, "string");
      assert.equal(typeof t.hash, "string");
    }
  }
});

test("every run row has all required fields and types", () => {
  for (const snap of loadSnapshots()) {
    assert.ok(Array.isArray(snap.runs) && snap.runs.length > 0, "runs present");
    for (const run of snap.runs) {
      for (const [field, type] of Object.entries(RUN_FIELD_TYPES)) {
        assert.equal(
          typeof run[field],
          type,
          `run.${field} should be ${type}, got ${typeof run[field]}`
        );
      }
    }
  }
});

test("schema drift: a row missing a field fails the check", () => {
  // This guards the guard: prove the field check actually rejects bad rows.
  const goodRow = {
    task: "x", arm: "budzie", model: "m",
    code_lines: 1, input_tokens: 1, output_tokens: 1,
    cost_usd: 0, latency_ms: 1, correctness: true,
  };
  const { output_tokens: _omit, ...badRow } = goodRow;

  /** @param {Record<string, unknown>} row */
  const validate = (row) =>
    Object.entries(RUN_FIELD_TYPES).every(
      ([f, t]) => typeof row[f] === t
    );

  assert.equal(validate(goodRow), true);
  assert.equal(validate(badRow), false);
});

test("synthetic seed data is clearly labelled in meta", () => {
  // The seed must announce itself; real snapshots set synthetic: false.
  const seed = loadSnapshots().find((s) => s.meta.synthetic === true);
  if (seed) {
    assert.match(
      JSON.stringify(seed.meta).toLowerCase(),
      /synthetic/,
      "synthetic seed meta must say so"
    );
  }
});

test("every model in the snapshot has a committed RATES entry", () => {
  for (const snap of loadSnapshots()) {
    for (const model of snap.meta.models) {
      assert.ok(RATES[model], `missing RATES entry for ${model}`);
    }
  }
});

test("RATES covers every model in the default list", () => {
  for (const model of DEFAULT_MODELS) {
    assert.ok(RATES[model], `default model ${model} has no RATES entry`);
    assert.equal(typeof RATES[model].inputPerMtok, "number");
    assert.equal(typeof RATES[model].outputPerMtok, "number");
  }
});
