import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/** Absolute path to the session CLI under test. */
const SESSION_CLI = fileURLToPath(new URL("../scripts/session.mjs", import.meta.url));
/** Absolute path to the budget CLI under test. */
const BUDGET_CLI = fileURLToPath(new URL("../scripts/budget.mjs", import.meta.url));

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
  const root = mkdtempSync(path.join(tmpdir(), "budzie-session-"));
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
 * Write a JSONL session transcript and return its absolute path.
 * @param {string} root
 * @param {string} name
 * @param {object[]} entries
 * @returns {string}
 */
function writeJsonl(root, name, entries) {
  const file = path.join(root, name);
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return file;
}

/**
 * Run the session CLI in `root`.
 * @param {string} root
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 * @returns {string}
 */
function runSession(root, args, env) {
  return execFileSync("node", [SESSION_CLI, ...args], {
    cwd: root,
    encoding: "utf8",
    env: testEnv(env),
  });
}

/**
 * Run a CLI expecting a non-zero exit.
 * @param {string} cli
 * @param {string} root
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runFailure(cli, root, args, env) {
  try {
    execFileSync("node", [cli, ...args], { cwd: root, encoding: "utf8", env: testEnv(env) });
  } catch (err) {
    assert.ok(err && typeof err === "object");
    return {
      status: /** @type {{ status?: number }} */ (err).status ?? null,
      stdout: String(/** @type {{ stdout?: unknown }} */ (err).stdout ?? ""),
      stderr: String(/** @type {{ stderr?: unknown }} */ (err).stderr ?? ""),
    };
  }
  assert.fail("expected command to fail");
}

/** A synthetic transcript with two assistant turns carrying real usage fields. */
function sampleTranscript() {
  return [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello", usage: { input_tokens: 100, output_tokens: 40 } },
    { role: "user", content: "more" },
    { role: "assistant", content: "ok", usage: { input_tokens: 200, output_tokens: 60 } },
  ];
}

test("parses turns and token fields from a synthetic session log", async () => {
  await withTree((root) => {
    const file = writeJsonl(root, "session.jsonl", sampleTranscript());
    const out = runSession(root, ["report", "--session", file]);

    // Real counted turns: two assistant turns.
    assert.match(out, /turns: 2/);
    // Real counted tokens: 100+200 input, 40+60 output, 400 total.
    assert.match(out, /input tokens: 300/);
    assert.match(out, /output tokens: 100/);
    assert.match(out, /total tokens: 400/);
    // Real counts are not labelled as estimates.
    assert.doesNotMatch(out, /total tokens: 400 .*ESTIMATE/);
  });
});

test("json output exposes the parsed real counts", async () => {
  await withTree((root) => {
    const file = writeJsonl(root, "session.jsonl", sampleTranscript());
    const out = runSession(root, ["report", "--session", file, "--json"]);
    const parsed = JSON.parse(out);

    assert.equal(parsed.turns, 2);
    assert.equal(parsed.inputTokens, 300);
    assert.equal(parsed.outputTokens, 100);
    assert.equal(parsed.totalTokens, 400);
    assert.equal(parsed.tokensSource, "counted");
  });
});

test("missing usage data is reported honestly without invented numbers", async () => {
  await withTree((root) => {
    // Turns present, but no usage fields anywhere.
    const file = writeJsonl(root, "session.jsonl", [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
    const out = runSession(root, ["report", "--session", file]);

    assert.match(out, /turns: 1/);
    assert.match(out, /total tokens: unknown/);
    assert.match(out, /usage data missing/);
    // Never fabricate a token number when usage is absent.
    assert.doesNotMatch(out, /total tokens: \d/);
  });
});

test("a missing session file fails honestly", async () => {
  await withTree((root) => {
    const res = runFailure(SESSION_CLI, root, [
      "report",
      "--session",
      path.join(root, "nope.jsonl"),
    ]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /not found|no such|cannot read/i);
  });
});

test("estimated total carries an estimate label naming its source", async () => {
  await withTree((root) => {
    // No usage fields; ask for a char-based estimate fallback.
    const file = writeJsonl(root, "session.jsonl", [
      { role: "user", content: "a budget question that has some length" },
      { role: "assistant", content: "a reasonably long answer with content" },
    ]);
    const out = runSession(root, ["report", "--session", file, "--estimate"]);

    // The estimated figure must be labelled with its source.
    assert.match(out, /ESTIMATE \(session log\)/);
    // And the json source field reflects the estimate.
    const json = runSession(root, ["report", "--session", file, "--estimate", "--json"]);
    assert.equal(JSON.parse(json).tokensSource, "estimate");
  });
});

test("budget check consumes session usage and warns at the ceiling", async () => {
  await withTree((root) => {
    const file = writeJsonl(root, "session.jsonl", sampleTranscript()); // 400 total tokens
    execFileSync(
      "node",
      [BUDGET_CLI, "set", "--ceiling", "500", "--unit", "tokens", "--warn-at", "0.75", "--mode", "warn"],
      { cwd: root, encoding: "utf8", env: testEnv() }
    );

    const out = execFileSync("node", [BUDGET_CLI, "check", "--session", file], {
      cwd: root,
      encoding: "utf8",
      env: testEnv(),
    });

    assert.match(out, /budget: 500 tokens/);
    assert.match(out, /estimated: 400 tokens/);
    // 400 >= 0.75 * 500 (375) -> warn.
    assert.match(out, /status: warn/);
  });
});

test("budget check hard-stops on session usage over the ceiling in stop mode", async () => {
  await withTree((root) => {
    const file = writeJsonl(root, "session.jsonl", sampleTranscript()); // 400 total tokens
    execFileSync(
      "node",
      [BUDGET_CLI, "set", "--ceiling", "100", "--unit", "tokens", "--mode", "stop"],
      { cwd: root, encoding: "utf8", env: testEnv() }
    );

    const res = runFailure(BUDGET_CLI, root, ["check", "--session", file]);
    assert.equal(res.status, 2);
    assert.match(res.stdout, /estimated: 400 tokens/);
    assert.match(res.stdout, /status: stop/);
    assert.match(res.stdout, /reason: estimate exceeds budget/);
  });
});

test("budget check warns instead of stopping when over ceiling in warn mode", async () => {
  await withTree((root) => {
    const file = writeJsonl(root, "session.jsonl", sampleTranscript()); // 400 total tokens
    execFileSync(
      "node",
      [BUDGET_CLI, "set", "--ceiling", "100", "--unit", "tokens", "--mode", "warn"],
      { cwd: root, encoding: "utf8", env: testEnv() }
    );

    const out = execFileSync("node", [BUDGET_CLI, "check", "--session", file], {
      cwd: root,
      encoding: "utf8",
      env: testEnv(),
    });
    assert.match(out, /status: warn/);
    assert.match(out, /reason: estimate exceeds budget/);
  });
});

test("budget check with a usageless session reports unknown, never invents a stop", async () => {
  await withTree((root) => {
    const file = writeJsonl(root, "session.jsonl", [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
    execFileSync(
      "node",
      [BUDGET_CLI, "set", "--ceiling", "100", "--unit", "tokens", "--mode", "stop"],
      { cwd: root, encoding: "utf8", env: testEnv() }
    );

    const out = execFileSync("node", [BUDGET_CLI, "check", "--session", file], {
      cwd: root,
      encoding: "utf8",
      env: testEnv(),
    });
    assert.match(out, /estimated: unknown/);
    assert.match(out, /status: ok/);
    assert.match(out, /reason: estimate missing/);
  });
});

test("session surface is wired into the skill and command", () => {
  const skill = fileURLToPath(new URL("../skills/budzie-budget/SKILL.md", import.meta.url));
  const command = fileURLToPath(new URL("../commands/budzie-budget.toml", import.meta.url));
  for (const file of [skill, command]) {
    const text = readFileSync(file, "utf8");
    assert.match(text, /scripts\/session\.mjs/);
    assert.match(text, /--session/);
  }
});
