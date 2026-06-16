import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/** Absolute path to the CLI under test. */
const CLI = fileURLToPath(new URL("../scripts/budget.mjs", import.meta.url));
const BUDGET_ENV_KEYS = [
  "BUDZIE_BUDGET_CEILING",
  "BUDZIE_BUDGET_UNIT",
  "BUDZIE_BUDGET_WARN_AT",
  "BUDZIE_BUDGET_MODE",
  "BUDZIE_BUDGET_CONFIG",
];

/**
 * Create a throwaway directory tree and clean it up after `fn` runs.
 * @param {(root: string) => Promise<void> | void} fn
 */
async function withTree(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "budzie-budget-"));
  try {
    await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Build an environment with budget overrides cleared unless supplied.
 * @param {Record<string, string>} [extra]
 * @returns {NodeJS.ProcessEnv}
 */
function testEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of BUDGET_ENV_KEYS) delete env[key];
  return { ...env, ...extra };
}

/**
 * Run the budget CLI in `root`.
 * @param {string} root
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 * @returns {string}
 */
function runBudget(root, args, env) {
  return execFileSync("node", [CLI, ...args], {
    cwd: root,
    encoding: "utf8",
    env: testEnv(env),
  });
}

/**
 * Run the budget CLI expecting a non-zero exit.
 * @param {string} root
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runBudgetFailure(root, args, env) {
  try {
    runBudget(root, args, env);
  } catch (err) {
    assert.ok(err && typeof err === "object");
    return {
      status: /** @type {{ status?: number }} */ (err).status ?? null,
      stdout: String(/** @type {{ stdout?: unknown }} */ (err).stdout ?? ""),
      stderr: String(/** @type {{ stderr?: unknown }} */ (err).stderr ?? ""),
    };
  }
  assert.fail("expected budget command to fail");
}

test("status is read-only and reports unknown values without config", async () => {
  await withTree((root) => {
    const out = runBudget(root, ["status"]);

    assert.match(out, /budget: unknown/);
    assert.match(out, /estimated: unknown/);
    assert.match(out, /status: ok/);
    assert.match(out, /reason: no budget ceiling configured/);
    assert.equal(existsSync(path.join(root, ".budzie")), false);
  });
});

test("set writes local config and status reads it", async () => {
  await withTree((root) => {
    const setOut = runBudget(root, [
      "set",
      "--ceiling",
      "1000",
      "--unit",
      "tokens",
      "--warn-at",
      "0.75",
      "--mode",
      "warn",
    ]);
    assert.match(setOut, /budget: 1000 tokens/);
    assert.match(setOut, /status: ok/);

    const saved = JSON.parse(readFileSync(path.join(root, ".budzie", "budget.json"), "utf8"));
    assert.deepEqual(saved, {
      ceiling: 1000,
      unit: "tokens",
      warnAt: 0.75,
      mode: "warn",
    });

    const statusOut = runBudget(root, ["status"]);
    assert.match(statusOut, /budget: 1000 tokens/);
    assert.match(statusOut, /estimated: unknown/);
    assert.match(statusOut, /status: ok/);
    assert.match(statusOut, /reason: budget ceiling configured/);
  });
});

test("environment values override local config", async () => {
  await withTree((root) => {
    runBudget(root, ["set", "--ceiling", "1000", "--unit", "tokens"]);

    const statusOut = runBudget(root, ["status"], {
      BUDZIE_BUDGET_CEILING: "25",
      BUDZIE_BUDGET_UNIT: "usd",
      BUDZIE_BUDGET_WARN_AT: "0.5",
      BUDZIE_BUDGET_MODE: "stop",
    });

    assert.match(statusOut, /budget: 25 usd/);
    assert.match(statusOut, /status: ok/);
  });
});

test("check without an estimate does not invent precision", async () => {
  await withTree((root) => {
    runBudget(root, ["set", "--ceiling", "1000", "--unit", "tokens"]);
    const before = readFileSync(path.join(root, ".budzie", "budget.json"), "utf8");

    const out = runBudget(root, ["check"]);

    assert.match(out, /budget: 1000 tokens/);
    assert.match(out, /estimated: unknown/);
    assert.match(out, /status: ok/);
    assert.match(out, /reason: estimate missing/);
    assert.equal(readFileSync(path.join(root, ".budzie", "budget.json"), "utf8"), before);
  });
});

test("check supports ok, warn, and stop outcomes", async () => {
  await withTree((root) => {
    runBudget(root, [
      "set",
      "--ceiling",
      "100",
      "--unit",
      "tokens",
      "--warn-at",
      "0.75",
      "--mode",
      "warn",
    ]);

    const ok = runBudget(root, ["check", "--estimate", "50"]);
    assert.match(ok, /estimated: 50 tokens/);
    assert.match(ok, /status: ok/);
    assert.match(ok, /reason: budget check passed/);

    const warn = runBudget(root, ["check", "--estimate", "80"]);
    assert.match(warn, /estimated: 80 tokens/);
    assert.match(warn, /status: warn/);
    assert.match(warn, /reason: estimate reached warning threshold/);

    const overWarn = runBudget(root, ["check", "--estimate", "101"]);
    assert.match(overWarn, /status: warn/);
    assert.match(overWarn, /reason: estimate exceeds budget/);

    const stopped = runBudgetFailure(root, ["check", "--estimate", "101"], {
      BUDZIE_BUDGET_MODE: "stop",
    });
    assert.equal(stopped.status, 2);
    assert.match(stopped.stdout, /status: stop/);
    assert.match(stopped.stdout, /reason: estimate exceeds budget/);
    assert.equal(stopped.stderr, "");
  });
});

test("budget skill and command drive the guard CLI", () => {
  const skill = readFileSync("skills/budzie-budget/SKILL.md", "utf8");
  const command = readFileSync("commands/budzie-budget.toml", "utf8");

  for (const text of [skill, command]) {
    assert.match(text, /node scripts\/budget\.mjs status/);
    assert.match(text, /node scripts\/budget\.mjs set/);
    assert.match(text, /node scripts\/budget\.mjs check/);
    assert.match(text, /\.budzie\/budget\.json/);
    assert.match(text, /BUDZIE_BUDGET_CEILING/);
  }
});
