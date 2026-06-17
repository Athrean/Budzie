// @ts-check
import assert from "node:assert/strict";
import test from "node:test";

import { runJsGate, runPyGate, python3Path } from "../benchmarks/lib/gate.mjs";
import { TASKS, gradeTask } from "../benchmarks/tasks.mjs";
import { codeLines, primaryCodeBlock, codeBlocks } from "../benchmarks/lib/extract.mjs";

const JS_TASKS = TASKS.filter((t) => t.language === "js");
const PY_TASKS = TASKS.filter((t) => t.language === "python");

test("every JS task: good code passes the gate", () => {
  for (const task of JS_TASKS) {
    const r = gradeTask(task, task.goodCode);
    assert.equal(r.pass, true, `${task.id} good code should pass: ${r.detail}`);
    assert.equal(r.skipped, false);
  }
});

test("every JS task: short-but-broken code FAILS the gate", () => {
  for (const task of JS_TASKS) {
    const r = gradeTask(task, task.brokenCode);
    assert.equal(r.pass, false, `${task.id} broken code must fail (broken-but-short)`);
    assert.equal(r.skipped, false);
  }
});

test("every JS task: non-compiling code FAILS the gate", () => {
  for (const task of JS_TASKS) {
    const r = gradeTask(task, task.brokenSyntax);
    assert.equal(r.pass, false, `${task.id} non-compiling code must fail`);
    assert.equal(r.skipped, false);
  }
});

test("runJsGate: a trivially correct harness passes", () => {
  const code = "export const x = 2;";
  const harness = "export async function check(f) { if (f.x !== 2) throw new Error('no'); }";
  assert.equal(runJsGate(code, harness).pass, true);
});

test("runJsGate: a thrown assertion is a clean fail", () => {
  const code = "export const x = 1;";
  const harness = "export async function check(f) { if (f.x !== 2) throw new Error('mismatch'); }";
  const r = runJsGate(code, harness);
  assert.equal(r.pass, false);
  assert.match(r.detail, /mismatch|Error/);
});

test("python gate: skips when python3 is absent, otherwise runs", () => {
  for (const task of PY_TASKS) {
    const good = gradeTask(task, task.goodCode);
    if (python3Path() === null) {
      assert.equal(good.skipped, true, "python gate must skip when python3 missing");
      continue;
    }
    assert.equal(good.pass, true, `${task.id} good python should pass: ${good.detail}`);
    const broken = gradeTask(task, task.brokenCode);
    assert.equal(broken.pass, false, `${task.id} broken python should fail`);
    assert.equal(broken.skipped, false);
    const bad = gradeTask(task, task.brokenSyntax);
    assert.equal(bad.pass, false, `${task.id} non-compiling python should fail`);
  }
});

test("runPyGate returns skipped (not a hard error) for python tasks under no-python", () => {
  if (python3Path() !== null) return; // only meaningful when python3 is absent
  const r = runPyGate("def f():\n    pass", "from solution import f");
  assert.equal(r.skipped, true);
  assert.equal(r.pass, false);
});

test("codeLines counts only non-blank lines inside fences", () => {
  const reply = [
    "Here you go:",
    "```js",
    "const a = 1;",
    "",
    "const b = 2;",
    "```",
    "Done.",
  ].join("\n");
  assert.equal(codeLines(reply), 2);
});

test("primaryCodeBlock picks the longest fenced block", () => {
  const reply = [
    "```js",
    "x();",
    "```",
    "```js",
    "function big() {",
    "  return 42;",
    "}",
    "```",
  ].join("\n");
  assert.equal(codeBlocks(reply).length, 2);
  assert.match(primaryCodeBlock(reply), /function big/);
});

test("codeLines is zero when there is no fenced block", () => {
  assert.equal(codeLines("just prose, no code"), 0);
  assert.equal(primaryCodeBlock("just prose"), "");
});
