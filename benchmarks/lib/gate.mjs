// @ts-check
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Outcome of one correctness-gate run.
 * @typedef {object} GateResult
 * @property {boolean} pass - Code loaded and every assertion held.
 * @property {boolean} skipped - Runtime absent (e.g. python3); not counted.
 * @property {string} detail - Short reason on failure/skip, else "".
 */

/** Find python3 once. Null when absent — python gates then skip. */
let _python3 = /** @type {string | null | undefined} */ (undefined);

/**
 * Resolve a python3 binary, or null if none is on PATH.
 * @returns {string | null}
 */
export function python3Path() {
  if (_python3 !== undefined) return _python3;
  for (const bin of ["python3", "python"]) {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if (r.status === 0 && /Python 3/.test((r.stdout || "") + (r.stderr || ""))) {
      _python3 = bin;
      return _python3;
    }
  }
  _python3 = null;
  return _python3;
}

/**
 * Pull the function names a harness expects from its `const { a, b } = fns;`
 * destructure line. These are the identifiers the solution must provide; how it
 * exports them (ESM, CommonJS, or a bare declaration) is not what we measure.
 * @param {string} harness
 * @returns {string[]}
 */
export function expectedFnNames(harness) {
  const m = harness.match(/const\s*\{([^}]+)\}\s*=\s*fns/);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim().split(":")[0].trim())
    .filter(Boolean);
}

/**
 * Wrap a candidate solution so its functions are harvestable no matter which
 * module convention the model used. A CommonJS `module`/`exports` shim makes
 * `module.exports = fn` and `exports.x = fn` assign instead of crashing; native
 * `export` and bare top-level declarations still work as written. The harvest
 * IIFE then collects each expected name by identifier (direct `eval` sees the
 * module's lexical bindings), falling back to the shimmed `module.exports`.
 *
 * This is the heart of the fair gate: correctness is judged on behaviour, not
 * on whether the model picked ESM, CommonJS, or no export at all.
 *
 * @param {string} code - Raw model solution.
 * @param {string[]} names - Function identifiers the harness needs.
 * @returns {string}
 */
function buildSolutionModule(code, names) {
  return [
    "const module = { exports: {} };",
    "const exports = module.exports;",
    code,
    `const __names = ${JSON.stringify(names)};`,
    "export const __fns = (() => {",
    "  const f = {};",
    "  const me = module.exports;",
    "  if (me && typeof me === 'object') Object.assign(f, me);",
    "  if (typeof me === 'function' && __names.length === 1) f[__names[0]] = me;",
    "  for (const n of __names) { try { f[n] = eval(n); } catch {} }",
    "  return f;",
    "})();",
  ].join("\n");
}

/**
 * Run a JS correctness gate. `code` is the model's solution; `harness` is
 * deterministic check code that destructures the solution from `fns` and throws
 * on any mismatch. A clean exit means pass; a non-zero exit (syntax error,
 * thrown assertion, wrong output) means fail.
 *
 * The solution and harness run in a fresh child `node` process so broken or
 * non-compiling code cannot poison the benchmark runner. Export style (ESM,
 * CommonJS, or a bare declaration) does not affect the verdict — see
 * {@link buildSolutionModule}.
 *
 * @param {string} code - Model solution (raw JS source).
 * @param {string} harness - Assertion code that reads `fns`.
 * @returns {GateResult}
 */
export function runJsGate(code, harness) {
  const dir = mkdtempSync(path.join(tmpdir(), "budzie-bench-"));
  try {
    const solutionFile = path.join(dir, "solution.mjs");
    const harnessFile = path.join(dir, "harness.mjs");
    const runnerFile = path.join(dir, "runner.mjs");

    writeFileSync(solutionFile, buildSolutionModule(code, expectedFnNames(harness)));
    writeFileSync(harnessFile, harness);
    writeFileSync(
      runnerFile,
      [
        // Namespace covers native ESM exports; __fns covers CommonJS exports,
        // bare top-level declarations, and the harness's expected names.
        "import * as solution from './solution.mjs';",
        "import { check } from './harness.mjs';",
        "const fns = { ...solution, ...solution.__fns };",
        "delete fns.__fns;",
        "await check(fns);",
      ].join("\n")
    );

    const r = spawnSync(process.execPath, [runnerFile], {
      encoding: "utf8",
      timeout: 10_000,
    });
    if (r.status === 0) {
      return { pass: true, skipped: false, detail: "" };
    }
    // Node's ESM uncaught-error dump leads with the file path, not the message,
    // so pick the first line that actually names the failure.
    const lines = ((r.stderr || "") + "\n" + (r.stdout || ""))
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const detail = (
      lines.find((l) => /error|assert|mismatch|expected/i.test(l)) ||
      lines[0] ||
      `exit ${r.status}`
    ).slice(0, 200);
    return { pass: false, skipped: false, detail };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Run a Python correctness gate. Skips (not a fail) when python3 is absent so
 * CI on a python-less box still passes. `code` is the model solution written
 * to `solution.py`; `harness` is python that imports it and raises on mismatch.
 *
 * @param {string} code - Model solution (raw Python source).
 * @param {string} harness - Python assertion script importing `solution`.
 * @returns {GateResult}
 */
export function runPyGate(code, harness) {
  const py = python3Path();
  if (py === null) {
    return { pass: false, skipped: true, detail: "python3 not found" };
  }
  const dir = mkdtempSync(path.join(tmpdir(), "budzie-bench-py-"));
  try {
    writeFileSync(path.join(dir, "solution.py"), code);
    writeFileSync(path.join(dir, "harness.py"), harness);
    const r = spawnSync(py, ["harness.py"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 10_000,
    });
    if (r.status === 0) {
      return { pass: true, skipped: false, detail: "" };
    }
    const detail = ((r.stderr || "") + (r.stdout || "")).split("\n").pop()?.slice(0, 200) || "";
    return { pass: false, skipped: false, detail: detail || `exit ${r.status}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
