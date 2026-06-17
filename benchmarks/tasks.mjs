// @ts-check
import { createHash } from "node:crypto";

import { runJsGate, runPyGate } from "./lib/gate.mjs";

/**
 * One self-contained coding task with a deterministic correctness gate.
 * @typedef {object} Task
 * @property {string} id - Stable task id (used as a snapshot key).
 * @property {"js" | "python"} language - Runtime the gate needs.
 * @property {boolean} liveOnly - True for tasks not run inside `npm test`.
 * @property {string} prompt - The instruction sent to the model.
 * @property {string} harness - Gate code that asserts correctness.
 * @property {string} goodCode - A reference correct solution (gate passes).
 * @property {string} brokenCode - A short-but-wrong solution (gate fails).
 * @property {string} brokenSyntax - Non-compiling solution (gate fails).
 */

/**
 * Run a task's correctness gate over a candidate solution.
 * @param {Task} task
 * @param {string} code - Candidate solution source.
 * @returns {import("./lib/gate.mjs").GateResult}
 */
export function gradeTask(task, code) {
  return task.language === "python"
    ? runPyGate(code, task.harness)
    : runJsGate(code, task.harness);
}

/**
 * Stable content hash of a task's spec. Lets a snapshot prove the tasks it
 * measured match the tasks in this file — drift fails loudly.
 * @param {Task} task
 * @returns {string}
 */
export function taskHash(task) {
  const h = createHash("sha256");
  h.update(task.id);
  h.update("\0");
  h.update(task.language);
  h.update("\0");
  h.update(task.prompt);
  h.update("\0");
  h.update(task.harness);
  return h.digest("hex").slice(0, 16);
}

/** @type {readonly Task[]} */
export const TASKS = Object.freeze([
  {
    id: "email-validator",
    language: "js",
    liveOnly: false,
    prompt:
      "Write and export a JavaScript function `isEmail(s)` that returns true " +
      "only for a basic valid email: non-empty local part, a single '@', a " +
      "domain with at least one dot, and no spaces. Return false otherwise.",
    harness: [
      "export async function check(fns) {",
      "  const { isEmail } = fns;",
      "  if (typeof isEmail !== 'function') throw new Error('isEmail not exported');",
      "  const ok = ['a@b.co', 'jane.doe@example.com', 'x+y@sub.domain.org'];",
      "  const bad = ['', 'a@b', 'a b@c.co', 'a@@b.co', 'no-at.com', '@b.co', 'a@b.', 'a@.co'];",
      "  for (const e of ok) if (isEmail(e) !== true) throw new Error('want true: ' + e);",
      "  for (const e of bad) if (isEmail(e) !== false) throw new Error('want false: ' + e);",
      "}",
    ].join("\n"),
    goodCode: [
      "export function isEmail(s) {",
      "  if (typeof s !== 'string' || /\\s/.test(s)) return false;",
      "  const parts = s.split('@');",
      "  if (parts.length !== 2) return false;",
      "  const [local, domain] = parts;",
      "  if (!local) return false;",
      "  if (!domain.includes('.')) return false;",
      "  if (domain.startsWith('.') || domain.endsWith('.')) return false;",
      "  return true;",
      "}",
    ].join("\n"),
    brokenCode: [
      "export function isEmail(s) {",
      "  return s.includes('@');",
      "}",
    ].join("\n"),
    brokenSyntax: "export function isEmail(s) { return s.includes('@'",
  },
  {
    id: "debounce",
    language: "js",
    liveOnly: false,
    prompt:
      "Write and export a JavaScript function `debounce(fn, wait)` that returns " +
      "a debounced wrapper: the wrapped function only invokes `fn` once `wait` " +
      "ms have elapsed since the last call, with the most recent arguments.",
    harness: [
      "export async function check(fns) {",
      "  const { debounce } = fns;",
      "  if (typeof debounce !== 'function') throw new Error('debounce not exported');",
      "  let calls = [];",
      "  const d = debounce((x) => calls.push(x), 20);",
      "  d(1); d(2); d(3);",
      "  await new Promise((r) => setTimeout(r, 50));",
      "  if (calls.length !== 1) throw new Error('expected 1 call, got ' + calls.length);",
      "  if (calls[0] !== 3) throw new Error('expected last args, got ' + calls[0]);",
      "  d(4);",
      "  await new Promise((r) => setTimeout(r, 50));",
      "  if (calls.length !== 2 || calls[1] !== 4) throw new Error('second window failed');",
      "}",
    ].join("\n"),
    goodCode: [
      "export function debounce(fn, wait) {",
      "  let t;",
      "  return function (...args) {",
      "    clearTimeout(t);",
      "    t = setTimeout(() => fn.apply(this, args), wait);",
      "  };",
      "}",
    ].join("\n"),
    brokenCode: [
      "export function debounce(fn, wait) {",
      "  return (...args) => fn(...args);",
      "}",
    ].join("\n"),
    brokenSyntax: "export function debounce(fn, wait) { return (...args) => fn(...args",
  },
  {
    id: "csv-sum",
    language: "js",
    liveOnly: false,
    prompt:
      "Write and export a JavaScript function `csvSum(csv, column)` that parses " +
      "a CSV string with a header row and returns the numeric sum of the named " +
      "column. Non-numeric or empty cells count as 0.",
    harness: [
      "export async function check(fns) {",
      "  const { csvSum } = fns;",
      "  if (typeof csvSum !== 'function') throw new Error('csvSum not exported');",
      "  const csv = 'name,amount\\nA,10\\nB,5\\nC,\\nD,x\\nE,2.5';",
      "  const got = csvSum(csv, 'amount');",
      "  if (Math.abs(got - 17.5) > 1e-9) throw new Error('expected 17.5, got ' + got);",
      "  const csv2 = 'a,b,c\\n1,2,3\\n4,5,6';",
      "  if (csvSum(csv2, 'b') !== 7) throw new Error('expected 7, got ' + csvSum(csv2, 'b'));",
      "}",
    ].join("\n"),
    goodCode: [
      "export function csvSum(csv, column) {",
      "  const rows = csv.trim().split('\\n');",
      "  const header = rows[0].split(',');",
      "  const idx = header.indexOf(column);",
      "  if (idx === -1) return 0;",
      "  let total = 0;",
      "  for (let i = 1; i < rows.length; i++) {",
      "    const cell = rows[i].split(',')[idx];",
      "    const n = Number(cell);",
      "    if (cell !== '' && cell !== undefined && !Number.isNaN(n)) total += n;",
      "  }",
      "  return total;",
      "}",
    ].join("\n"),
    brokenCode: [
      "export function csvSum(csv, column) {",
      "  return csv.split('\\n').length;",
      "}",
    ].join("\n"),
    brokenSyntax: "export function csvSum(csv, column) { return csv.split('\\n'.length; }",
  },
  {
    id: "slugify",
    language: "js",
    liveOnly: false,
    prompt:
      "Write and export a JavaScript function `slugify(s)` that lowercases the " +
      "input, trims it, replaces runs of non-alphanumeric characters with a " +
      "single hyphen, and strips leading/trailing hyphens.",
    harness: [
      "export async function check(fns) {",
      "  const { slugify } = fns;",
      "  if (typeof slugify !== 'function') throw new Error('slugify not exported');",
      "  const cases = [",
      "    ['Hello, World!', 'hello-world'],",
      "    ['  Spaced  Out  ', 'spaced-out'],",
      "    ['Already-slug', 'already-slug'],",
      "    ['Foo___Bar', 'foo-bar'],",
      "    ['--edge--', 'edge'],",
      "  ];",
      "  for (const [input, want] of cases) {",
      "    const got = slugify(input);",
      "    if (got !== want) throw new Error(JSON.stringify(input) + ' -> ' + JSON.stringify(got));",
      "  }",
      "}",
    ].join("\n"),
    goodCode: [
      "export function slugify(s) {",
      "  return s",
      "    .toLowerCase()",
      "    .trim()",
      "    .replace(/[^a-z0-9]+/g, '-')",
      "    .replace(/^-+|-+$/g, '');",
      "}",
    ].join("\n"),
    brokenCode: [
      "export function slugify(s) {",
      "  return s.toLowerCase().replace(/ /g, '-');",
      "}",
    ].join("\n"),
    brokenSyntax: "export function slugify(s) { return s.toLowerCase(.replace(/ /g,'-'); }",
  },
  {
    id: "rate-limiter",
    language: "js",
    liveOnly: false,
    prompt:
      "Write and export a JavaScript factory `rateLimiter(max, windowMs)` that " +
      "returns a function `allow()`. `allow()` returns true if fewer than `max` " +
      "calls have happened in the trailing `windowMs`, otherwise false. Use the " +
      "passed clock function `now` if provided, defaulting to Date.now.",
    harness: [
      "export async function check(fns) {",
      "  const { rateLimiter } = fns;",
      "  if (typeof rateLimiter !== 'function') throw new Error('rateLimiter not exported');",
      "  let t = 1000;",
      "  const now = () => t;",
      "  const allow = rateLimiter(2, 100, now);",
      "  if (allow() !== true) throw new Error('1st should pass');",
      "  if (allow() !== true) throw new Error('2nd should pass');",
      "  if (allow() !== false) throw new Error('3rd should be blocked');",
      "  t = 1101;",
      "  if (allow() !== true) throw new Error('after window should pass');",
      "}",
    ].join("\n"),
    goodCode: [
      "export function rateLimiter(max, windowMs, now = Date.now) {",
      "  const hits = [];",
      "  return function allow() {",
      "    const t = now();",
      "    while (hits.length && hits[0] <= t - windowMs) hits.shift();",
      "    if (hits.length < max) {",
      "      hits.push(t);",
      "      return true;",
      "    }",
      "    return false;",
      "  };",
      "}",
    ].join("\n"),
    brokenCode: [
      "export function rateLimiter(max, windowMs, now = Date.now) {",
      "  let n = 0;",
      "  return () => ++n <= max;",
      "}",
    ].join("\n"),
    brokenSyntax: "export function rateLimiter(max, windowMs) { return () => { ; }",
  },
  {
    id: "retry-with-backoff",
    language: "js",
    liveOnly: false,
    prompt:
      "Write and export an async JavaScript function " +
      "`retry(fn, { retries, delay, sleep })` that calls `fn`, and on a thrown " +
      "error retries up to `retries` times, awaiting `sleep(delay * 2 ** attempt)` " +
      "between attempts (exponential backoff). Returns fn's resolved value, or " +
      "rethrows the final error after exhausting retries.",
    harness: [
      "export async function check(fns) {",
      "  const { retry } = fns;",
      "  if (typeof retry !== 'function') throw new Error('retry not exported');",
      "  const sleeps = [];",
      "  const sleep = (ms) => { sleeps.push(ms); return Promise.resolve(); };",
      "  let n = 0;",
      "  const flaky = async () => { n++; if (n < 3) throw new Error('boom'); return 'ok'; };",
      "  const out = await retry(flaky, { retries: 5, delay: 10, sleep });",
      "  if (out !== 'ok') throw new Error('expected ok, got ' + out);",
      "  if (n !== 3) throw new Error('expected 3 attempts, got ' + n);",
      "  if (sleeps.length !== 2 || sleeps[0] !== 10 || sleeps[1] !== 20) {",
      "    throw new Error('backoff schedule wrong: ' + JSON.stringify(sleeps));",
      "  }",
      "  let always = async () => { throw new Error('nope'); };",
      "  let threw = false;",
      "  try { await retry(always, { retries: 2, delay: 1, sleep }); } catch { threw = true; }",
      "  if (!threw) throw new Error('should rethrow after exhausting retries');",
      "}",
    ].join("\n"),
    goodCode: [
      "export async function retry(fn, { retries, delay, sleep }) {",
      "  let attempt = 0;",
      "  for (;;) {",
      "    try {",
      "      return await fn();",
      "    } catch (err) {",
      "      if (attempt >= retries) throw err;",
      "      await sleep(delay * 2 ** attempt);",
      "      attempt++;",
      "    }",
      "  }",
      "}",
    ].join("\n"),
    brokenCode: [
      "export async function retry(fn) {",
      "  return await fn();",
      "}",
    ].join("\n"),
    brokenSyntax: "export async function retry(fn, opts) { return await fn(; }",
  },
  {
    // Python-only task: live-only, and its gate skips when python3 is absent.
    // budzie: one python task is enough to exercise the skip path; upgrade to a
    // full python task set only if python coverage becomes a headline metric.
    id: "py-titlecase",
    language: "python",
    liveOnly: true,
    prompt:
      "Write a Python function `titlecase(s)` in solution.py that returns the " +
      "string with each word capitalized and the rest lowercased, splitting on " +
      "single spaces and joining with single spaces.",
    harness: [
      "from solution import titlecase",
      "assert titlecase('hello world') == 'Hello World'",
      "assert titlecase('ALL CAPS here') == 'All Caps Here'",
      "assert titlecase('') == ''",
      "print('ok')",
    ].join("\n"),
    goodCode: [
      "def titlecase(s):",
      "    return ' '.join(w[:1].upper() + w[1:].lower() for w in s.split(' ')) if s else ''",
    ].join("\n"),
    brokenCode: ["def titlecase(s):", "    return s"].join("\n"),
    brokenSyntax: "def titlecase(s)\n    return s",
  },
]);
