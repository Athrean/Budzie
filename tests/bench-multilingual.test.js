// @ts-check
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MULTILINGUAL_TASKS,
  runMultilingualBenchmark,
} from "../benchmarks/multilingual-compression.mjs";
import { TASKS } from "../benchmarks/tasks.mjs";

const CLI = fileURLToPath(
  new URL("../benchmarks/multilingual-compression.mjs", import.meta.url)
);

test("multilingual fixtures stay separate from coding benchmark tasks", () => {
  assert.deepEqual(
    MULTILINGUAL_TASKS.map((task) => task.language),
    ["es", "pt", "fr"]
  );
  const codingIds = new Set(TASKS.map((task) => task.id));
  for (const task of MULTILINGUAL_TASKS) {
    assert.equal(codingIds.has(task.id), false);
  }
});

test("the package ships the local multilingual benchmark surface", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));

  assert.ok(pkg.files.includes("benchmarks/multilingual-compression.mjs"));
  assert.ok(pkg.files.includes("benchmarks/fixtures/multilingual-compression.json"));
});

test("multilingual compression benchmark passes same-language fixtures locally", () => {
  const rows = runMultilingualBenchmark();

  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.output, row.expected, `${row.id}: deterministic output drift`);
    assert.equal(row.sameLanguage, true, `${row.id}: language markers changed`);
    assert.equal(row.preserved, true, `${row.id}: protected span changed`);
    assert.ok(row.bytesAfter < row.bytesBefore, `${row.id}: no compression`);
    assert.equal(row.passed, true, `${row.id}: benchmark failed`);
  }
});

test("multilingual benchmark CLI runs without network or paid benchmark imports", () => {
  const source = readFileSync(CLI, "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(|https?:|benchmarks\/run\.mjs/);

  /** @type {{ passed: boolean }[]} */
  const rows = JSON.parse(
    execFileSync("node", [CLI, "--json"], { encoding: "utf8" })
  );
  assert.equal(rows.length, 3);
  assert.equal(rows.every((row) => row.passed === true), true);
});
