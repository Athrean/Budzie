// @ts-check

/**
 * Committed cost rates: model id -> USD per million tokens, input and output.
 *
 * Source of truth for the `cost_usd` metric. Costs are computed locally from
 * exact API token counts times these rates — never estimated by a model.
 * Update this table when published model pricing changes; bump SCHEMA_VERSION
 * in the snapshot meta if the shape changes.
 *
 * @typedef {object} Rate
 * @property {number} inputPerMtok - USD per 1,000,000 input tokens.
 * @property {number} outputPerMtok - USD per 1,000,000 output tokens.
 */

/** @type {Readonly<Record<string, Rate>>} */
export const RATES = Object.freeze({
  "openai/gpt-3.5-turbo": Object.freeze({ inputPerMtok: 0.5, outputPerMtok: 1.5 }),
  "openai/gpt-4": Object.freeze({ inputPerMtok: 30.0, outputPerMtok: 60.0 }),
  "claude-haiku-4-5": Object.freeze({ inputPerMtok: 1.0, outputPerMtok: 5.0 }),
  "claude-sonnet-4-6": Object.freeze({ inputPerMtok: 3.0, outputPerMtok: 15.0 }),
  "claude-opus-4-8": Object.freeze({ inputPerMtok: 5.0, outputPerMtok: 25.0 }),
});

/**
 * Default model list. Live runs override via CLI; the no-network path reads
 * whatever model ids the committed snapshot recorded.
 * @type {readonly string[]}
 */
export const DEFAULT_MODELS = Object.freeze([
  "openai/gpt-3.5-turbo",
  "openai/gpt-4",
]);

/**
 * Compute USD cost from exact token counts and the committed RATES table.
 * @param {string} model - Model id; must have a RATES entry.
 * @param {number} inputTokens - Exact input tokens from the API usage field.
 * @param {number} outputTokens - Exact output tokens from the API usage field.
 * @returns {number} Cost in USD. Throws if the model has no rate entry.
 */
export function costUsd(model, inputTokens, outputTokens) {
  const rate = RATES[model];
  if (!rate) {
    throw new Error(`no RATES entry for model: ${model}`);
  }
  return (
    (inputTokens * rate.inputPerMtok) / 1_000_000 +
    (outputTokens * rate.outputPerMtok) / 1_000_000
  );
}
