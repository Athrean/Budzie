// @ts-check
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  scopeContext,
  splitBudget,
  mergeCrew,
  dispatchCrew,
  renderCrewReceipt,
  parseSpec,
} from "../scripts/crew.mjs";

/**
 * A minimal counted/estimate usage object for merge tests.
 * @param {number | null} total
 * @param {string} [label]
 * @returns {import("../scripts/agents.mjs").AgentUsage}
 */
function usage(total, label = "estimate") {
  return /** @type {import("../scripts/agents.mjs").AgentUsage} */ ({
    inputTokens: null,
    outputTokens: null,
    totalTokens: total,
    tokensSource: label === "counted" ? "counted" : total === null ? "missing" : "estimate",
    tokenLabel: total === null ? "missing" : label,
  });
}

/**
 * Build an outcome for mergeCrew tests.
 * @param {string} name
 * @param {number | null} total
 * @param {string} [label]
 * @param {import("../scripts/crew.mjs").BudgetCheck} [budget]
 * @returns {import("../scripts/crew.mjs").MemberOutcome}
 */
function outcome(name, total, label, budget) {
  return /** @type {import("../scripts/crew.mjs").MemberOutcome} */ ({
    member: { agent: name, task: "t" },
    agent: name,
    usage: usage(total, label),
    scopedContext: `Task: t`,
    budget: budget ?? { budget: "1000 tokens", estimated: `${total}`, status: "ok", reason: "ok" },
  });
}

/**
 * Build a budget config for tests.
 * @param {number} ceiling
 * @param {"warn" | "stop"} mode
 * @returns {import("../scripts/budget.mjs").BudgetConfig}
 */
function cfg(ceiling, mode) {
  return { ceiling, unit: "tokens", warnAt: 0.8, mode };
}

/**
 * Create a throwaway repo root holding fixture agent definitions.
 * @param {string[]} agents
 */
function makeRoot(agents) {
  const root = mkdtempSync(path.join(tmpdir(), "budzie-crew-"));
  mkdirSync(path.join(root, "agents"));
  for (const name of agents) {
    writeFileSync(
      path.join(root, "agents", `${name}.md`),
      `---\nname: ${name}\ndescription: fixture\n---\nBody for ${name}.`
    );
  }
  return root;
}

test("splitBudget divides the ceiling so slices sum to exactly the ceiling", () => {
  const config = cfg(900, "stop");
  const { perMember, slice } = splitBudget(config, 3);
  assert.equal(slice, 300);
  assert.equal(perMember?.ceiling, 300);
  // Aggregate guarantee: slices never sum past the allowance.
  assert.equal((slice ?? 0) * 3, config.ceiling);
});

test("splitBudget with n=1 keeps the full ceiling; null config stays null", () => {
  const config = cfg(500, "warn");
  assert.equal(splitBudget(config, 1).perMember?.ceiling, 500);
  assert.deepEqual(splitBudget(null, 4), { perMember: null, slice: null });
});

test("splitBudget rejects a non-positive or non-integer crew size", () => {
  const config = cfg(500, "warn");
  assert.throws(() => splitBudget(config, 0), /positive integer/);
  assert.throws(() => splitBudget(config, 1.5), /positive integer/);
});

test("scopeContext is built from task + context only, not session history", () => {
  const ctx = scopeContext({ agent: "a", task: "fix parser", context: ["file: parser.mjs", "fn: parse()"] });
  assert.match(ctx, /Task: fix parser/);
  assert.match(ctx, /- file: parser\.mjs/);
  assert.match(ctx, /- fn: parse\(\)/);
  // No session/transcript field is ever interpolated.
  assert.doesNotMatch(ctx, /session|transcript|history/i);
});

test("mergeCrew sums known tokens and flags partial when any are unknown", () => {
  const config = cfg(1000, "warn");
  const all = mergeCrew([outcome("a", 100), outcome("b", 200)], config);
  assert.equal(all.totalTokens, 300);
  assert.equal(all.tokensComplete, true);

  const partial = mergeCrew([outcome("a", 100), outcome("b", null)], config);
  assert.equal(partial.totalTokens, 100);
  assert.equal(partial.tokensComplete, false);
});

test("mergeCrew labels aggregate counted only when every member is counted", () => {
  const config = cfg(1000, "warn");
  assert.equal(mergeCrew([outcome("a", 100, "counted"), outcome("b", 200, "counted")], config).tokenLabel, "counted");
  assert.equal(mergeCrew([outcome("a", 100, "counted"), outcome("b", 200, "estimate")], config).tokenLabel, "estimate");
});

test("mergeCrew honours a per-member hard-stop even when the aggregate fits", () => {
  const config = cfg(1000, "stop");
  // Aggregate 150 < 1000 (ok), but member b blew its slice with mode=stop.
  const stopped = /** @type {import("../scripts/crew.mjs").BudgetCheck} */ ({ budget: "333 tokens", estimated: "120", status: "stop", reason: "estimate exceeds budget" });
  const crew = mergeCrew([outcome("a", 30), outcome("b", 120, "estimate", stopped)], config);
  assert.equal(crew.budget.status, "ok");
  assert.equal(crew.status, "stop");
});

test("dispatchCrew runs members concurrently and preserves input order", async () => {
  const root = makeRoot(["alpha", "beta", "gamma"]);
  const crew = await dispatchCrew({
    root,
    members: [
      { agent: "gamma", task: "g" },
      { agent: "alpha", task: "a" },
      { agent: "beta", task: "b" },
    ],
    env: {},
  });
  assert.deepEqual(crew.members.map((m) => m.agent), ["gamma", "alpha", "beta"]);
  // Each member received its own constructed scoped context.
  assert.equal(crew.members[0].scopedContext, scopeContext({ agent: "gamma", task: "g" }));
});

test("dispatchCrew splits the ceiling and stops when aggregate exceeds it", async () => {
  const root = makeRoot(["alpha", "beta", "gamma"]);
  const crew = await dispatchCrew({
    root,
    members: [
      { agent: "alpha", task: "a", estimate: 500 },
      { agent: "beta", task: "b", estimate: 500 },
      { agent: "gamma", task: "c", estimate: 500 },
    ],
    env: { BUDZIE_BUDGET_CEILING: "1000", BUDZIE_BUDGET_UNIT: "tokens", BUDZIE_BUDGET_MODE: "stop" },
  });
  // Slice is 1000/3 ≈ 333; each 500-token member blows its slice, and the
  // 1500 aggregate blows the full ceiling — hard stop.
  assert.equal(crew.totalTokens, 1500);
  assert.equal(crew.status, "stop");
  for (const m of crew.members) assert.equal(m.budget.status, "stop");
});

test("dispatchCrew stays ok under the ceiling with the slice honoured", async () => {
  const root = makeRoot(["alpha", "beta"]);
  const crew = await dispatchCrew({
    root,
    members: [
      { agent: "alpha", task: "a", estimate: 100 },
      { agent: "beta", task: "b", estimate: 100 },
    ],
    env: { BUDZIE_BUDGET_CEILING: "1000", BUDZIE_BUDGET_UNIT: "tokens", BUDZIE_BUDGET_MODE: "stop" },
  });
  assert.equal(crew.totalTokens, 200);
  assert.equal(crew.status, "ok");
});

test("renderCrewReceipt labels estimates and shows the aggregate verdict", () => {
  const config = cfg(1000, "warn");
  const crew = mergeCrew([outcome("a", 100, "estimate"), outcome("b", 200, "counted")], config);
  const text = renderCrewReceipt(crew);
  assert.match(text, /members: 2/);
  assert.match(text, /100 estimate/);
  assert.match(text, /200 counted/);
  assert.match(text, /aggregate tokens: 300 estimate/);
  assert.match(text, /status: ok/);
});

test("parseSpec accepts an array or { members } and rejects malformed members", () => {
  assert.equal(parseSpec('[{"agent":"a","task":"t"}]').length, 1);
  assert.equal(parseSpec('{"members":[{"agent":"a","task":"t"}]}').length, 1);
  assert.throws(() => parseSpec("[]"), /non-empty/);
  assert.throws(() => parseSpec('[{"agent":"a"}]'), /agent.*task/);
});
