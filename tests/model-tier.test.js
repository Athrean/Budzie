// @ts-check
import assert from "node:assert/strict";
import test from "node:test";

import { classifyTier, tersenessFor } from "../src/model-tier.mjs";

test("classifyTier maps known model families to budget tiers", () => {
  assert.equal(classifyTier("claude-opus-4-8"), "top");
  assert.equal(classifyTier("opus"), "top");
  assert.equal(classifyTier("claude-fable-5"), "top");
  assert.equal(classifyTier("gpt-5.5"), "top");
  assert.equal(classifyTier("gpt5.5-preview"), "top");

  assert.equal(classifyTier("claude-sonnet-4-6"), "mid");
  assert.equal(classifyTier("gpt-5"), "mid");

  assert.equal(classifyTier("claude-haiku-4-5-20251001"), "low");
});

test("classifyTier returns unknown for synthetic, empty, or unrecognized ids", () => {
  assert.equal(classifyTier("<synthetic>"), "unknown");
  assert.equal(classifyTier(""), "unknown");
  assert.equal(classifyTier("   "), "unknown");
  assert.equal(classifyTier("some-other-model"), "unknown");
  assert.equal(classifyTier(undefined), "unknown");
  assert.equal(classifyTier(null), "unknown");
  assert.equal(classifyTier(42), "unknown");
});

test("gpt-5.5 is top tier, plain gpt-5 is mid (the .5 boundary holds)", () => {
  assert.equal(classifyTier("gpt-5.5"), "top");
  assert.equal(classifyTier("gpt-5"), "mid");
  assert.equal(classifyTier("gpt-5-turbo"), "mid");
});

test("tersenessFor scales by tier and always carries the safety clause", () => {
  const top = tersenessFor("top");
  const mid = tersenessFor("mid");
  assert.ok(top && top.length > 0, "top tier yields an instruction");
  assert.ok(mid && mid.length > 0, "mid tier yields an instruction");

  // The never-compress-correctness boundary must survive into the injected text.
  for (const instruction of [top, mid]) {
    assert.match(/** @type {string} */ (instruction), /security|destructive/i);
    assert.match(/** @type {string} */ (instruction), /full and clear/i);
  }

  // Top pulls harder than mid: strictly longer, more aggressive wording.
  assert.match(top ?? "", /maximize savings/i);
});

test("tersenessFor returns null for low and unknown tiers (no-op)", () => {
  assert.equal(tersenessFor("low"), null);
  assert.equal(tersenessFor("unknown"), null);
});
