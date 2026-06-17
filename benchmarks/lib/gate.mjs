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
 * Run a JS correctness gate. `code` is the model's solution; `harness` is
 * deterministic check code that imports the solution via the global
 * `__solution` and throws on any mismatch. A clean exit means pass; a
 * non-zero exit (syntax error, thrown assertion, wrong output) means fail.
 *
 * The solution and harness run in a fresh child `node` process so broken or
 * non-compiling code cannot poison the benchmark runner.
 *
 * @param {string} code - Model solution (raw JS source).
 * @param {string} harness - Assertion code; reads `globalThis.__exports`.
 * @returns {GateResult}
 */
export function runJsGate(code, harness) {
  const dir = mkdtempSync(path.join(tmpdir(), "budzie-bench-"));
  try {
    // The wrapper evaluates the model code in a module-like scope, collects any
    // declared/assigned top-level bindings, then runs the harness against them.
    // We use a function constructor over the raw source so a syntax error is a
    // clean non-zero exit rather than a module-load crash with no detail.
    const solutionFile = path.join(dir, "solution.mjs");
    const harnessFile = path.join(dir, "harness.mjs");
    const runnerFile = path.join(dir, "runner.mjs");

    writeFileSync(solutionFile, code);
    writeFileSync(harnessFile, harness);
    writeFileSync(
      runnerFile,
      [
        "import * as solution from './solution.mjs';",
        "import { check } from './harness.mjs';",
        "const fns = { ...solution };",
        "// Also expose default export members for solutions that `export default`.",
        "if (solution.default && typeof solution.default === 'object') {",
        "  Object.assign(fns, solution.default);",
        "}",
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
