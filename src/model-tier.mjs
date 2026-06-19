// @ts-check

/**
 * Map the active model to a budget tier, then to a scaled terseness
 * instruction. Expensive models earn the hardest prose compression; cheap
 * models are left alone because clawing back their tokens is not worth the
 * context bytes. Pure and zero-I/O — a string-only classifier.
 */

/**
 * Budget tier of the active model.
 * @typedef {"top" | "mid" | "low" | "unknown"} Tier
 */

/**
 * Tier rules, first match wins. budzie: a curated allowlist of the model
 * families Budzie scales for, not an exhaustive registry; add families as new
 * top/mid/low models ship.
 * @type {ReadonlyArray<{ tier: Tier, test: RegExp }>}
 */
const TIER_RULES = Object.freeze([
  { tier: "top", test: /opus|fable|gpt-?5\.5/i },
  { tier: "low", test: /haiku/i },
  { tier: "mid", test: /sonnet|gpt-?5(?!\.5)/i },
]);

/**
 * Classify a model id into a budget tier. Unknown or synthetic ids return
 * `"unknown"` so callers degrade to a safe no-op rather than guessing.
 * @param {unknown} modelId
 * @returns {Tier}
 */
export function classifyTier(modelId) {
  if (typeof modelId !== "string" || modelId.trim() === "" || modelId === "<synthetic>") {
    return "unknown";
  }
  for (const rule of TIER_RULES) {
    if (rule.test.test(modelId)) return rule.tier;
  }
  return "unknown";
}

/**
 * The boundary clause appended to every active terseness instruction: prose
 * compresses, correctness never does. Mirrors the auto-clarity guard and the
 * SKILL.md never-cut boundary.
 */
const SAFETY_CLAUSE =
  "Code, identifiers, exact errors, and security or destructive-action text stay full and clear.";

/**
 * Tier-scaled terseness instruction, or `null` when no instruction should be
 * injected. Top tier (expensive tokens) gets the strongest pull; mid gets a
 * moderate trim; low and unknown get nothing.
 * @param {Tier} tier
 * @returns {string | null}
 */
export function tersenessFor(tier) {
  if (tier === "top") {
    return (
      "Top-tier model active: output tokens are expensive. Maximize savings — " +
      "drop preamble, filler, and hedging; prefer fragments and the shortest " +
      `wording that stays exact. ${SAFETY_CLAUSE}`
    );
  }
  if (tier === "mid") {
    return `Mid-tier model active: trim preamble and filler; keep prose lean. ${SAFETY_CLAUSE}`;
  }
  return null;
}
