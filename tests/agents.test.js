import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  dispatchAgent,
  loadAgent,
  renderSubagentReceipt,
} from "../scripts/agents.mjs";

/** Absolute path to the subagent CLI under test. */
const AGENTS_CLI = fileURLToPath(new URL("../scripts/agents.mjs", import.meta.url));
/** Repo root containing the shipped `agents/` surface. */
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const BUDGET_ENV_KEYS = [
  "BUDZIE_BUDGET_CEILING",
  "BUDZIE_BUDGET_UNIT",
  "BUDZIE_BUDGET_WARN_AT",
  "BUDZIE_BUDGET_MODE",
  "BUDZIE_BUDGET_CONFIG",
];

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
 * Create a throwaway directory tree and clean it up after `fn` runs.
 * @param {(root: string) => Promise<void> | void} fn
 */
async function withTree(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "budzie-agents-"));
  try {
    await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Write a JSONL session transcript and return its absolute path.
 * @param {string} root
 * @param {object[]} entries
 * @returns {string}
 */
function writeSession(root, entries) {
  const file = path.join(root, "session.jsonl");
  writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  return file;
}

/**
 * Run the agents CLI.
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 * @returns {string}
 */
function runAgents(args, env) {
  return execFileSync("node", [AGENTS_CLI, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: testEnv(env),
  });
}

/**
 * Run the agents CLI expecting a non-zero exit.
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runAgentsFailure(args, env) {
  try {
    runAgents(args, env);
  } catch (err) {
    assert.ok(err && typeof err === "object");
    return {
      status: /** @type {{ status?: number }} */ (err).status ?? null,
      stdout: String(/** @type {{ stdout?: unknown }} */ (err).stdout ?? ""),
      stderr: String(/** @type {{ stderr?: unknown }} */ (err).stderr ?? ""),
    };
  }
  assert.fail("expected agents command to fail");
}

test("budzie-reviewer loads from the host-agnostic agents surface", async () => {
  const agent = await loadAgent(REPO_ROOT, "budzie-reviewer");

  assert.equal(agent.name, "budzie-reviewer");
  assert.match(agent.description, /budget-aware/i);
  assert.match(agent.instructions, /receipt/i);
  assert.match(agent.instructions, /read-only/i);
});

test("budzie-reaper loads from the host-agnostic agents surface", async () => {
  const agent = await loadAgent(REPO_ROOT, "budzie-reaper");

  assert.equal(agent.name, "budzie-reaper");
  assert.match(agent.description, /deletion/i);
  assert.match(agent.instructions, /reap.mjs/i);
  assert.match(agent.instructions, /worktree/i);
});

test("dispatch meters counted session tokens and stays read-only by default", async () => {
  await withTree(async (root) => {
    const session = writeSession(root, [
      { role: "user", content: "review this" },
      {
        role: "assistant",
        content: "findings",
        usage: { input_tokens: 80, output_tokens: 20 },
      },
    ]);

    const result = await dispatchAgent({
      root: REPO_ROOT,
      agentName: "budzie-reviewer",
      task: "Review the current branch for budget regressions.",
      session,
      env: testEnv({
        BUDZIE_BUDGET_CEILING: "150",
        BUDZIE_BUDGET_UNIT: "tokens",
        BUDZIE_BUDGET_WARN_AT: "0.8",
      }),
    });

    assert.equal(result.readOnly, true);
    assert.equal(result.usage.tokensSource, "counted");
    assert.equal(result.usage.totalTokens, 100);
    assert.equal(result.budget.status, "ok");
    assert.equal(result.receipt.tokenLabel, "counted");
  });
});

test("dispatch receipt labels explicit token estimates with their source", async () => {
  const result = await dispatchAgent({
    root: REPO_ROOT,
    agentName: "budzie-reviewer",
    task: "Review one small file.",
    estimate: 42,
    env: testEnv({
      BUDZIE_BUDGET_CEILING: "100",
      BUDZIE_BUDGET_UNIT: "tokens",
    }),
  });

  assert.equal(result.usage.tokensSource, "estimate");
  assert.equal(result.receipt.tokenLabel, "ESTIMATE (explicit)");
  assert.match(renderSubagentReceipt(result), /total tokens: 42 ESTIMATE \(explicit\)/);
  assert.match(renderSubagentReceipt(result), /read-only: yes/);
});

test("dispatch exits 2 when the subagent run exceeds a stop-mode ceiling", () => {
  const res = runAgentsFailure(
    [
      "dispatch",
      "--agent",
      "budzie-reviewer",
      "--task",
      "Review a large branch.",
      "--estimate",
      "101",
    ],
    {
      BUDZIE_BUDGET_CEILING: "100",
      BUDZIE_BUDGET_UNIT: "tokens",
      BUDZIE_BUDGET_MODE: "stop",
    }
  );

  assert.equal(res.status, 2);
  assert.match(res.stdout, /status: stop/);
  assert.match(res.stdout, /reason: estimate exceeds budget/);
  assert.equal(res.stderr, "");
});

test("dispatch --json emits the subagent receipt shape", () => {
  const out = runAgents(
    [
      "dispatch",
      "--agent",
      "budzie-reviewer",
      "--task",
      "Review a small branch.",
      "--estimate",
      "20",
      "--json",
    ],
    {
      BUDZIE_BUDGET_CEILING: "100",
      BUDZIE_BUDGET_UNIT: "tokens",
    }
  );
  const parsed = JSON.parse(out);

  assert.equal(parsed.agent.name, "budzie-reviewer");
  assert.equal(parsed.receipt.kind, "subagent_run");
  assert.equal(parsed.receipt.tokenLabel, "ESTIMATE (explicit)");
  assert.equal(parsed.readOnly, true);
  assert.equal(parsed.budget.status, "ok");
});

test("agents surface is shipped and wired through package metadata", () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));

  assert.ok(pkg.files.includes("agents/"));
});
