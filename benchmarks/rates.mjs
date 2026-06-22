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

/** Shared zero-cost rate for free OpenRouter model tiers. */
const FREE = Object.freeze({ inputPerMtok: 0, outputPerMtok: 0 });

/** @type {Readonly<Record<string, Rate>>} */
export const RATES = Object.freeze({
  "claude-haiku-4-5": Object.freeze({ inputPerMtok: 1.0, outputPerMtok: 5.0 }),
  "claude-sonnet-4-6": Object.freeze({ inputPerMtok: 3.0, outputPerMtok: 15.0 }),
  "claude-opus-4-8": Object.freeze({ inputPerMtok: 5.0, outputPerMtok: 25.0 }),
  // OpenRouter model slugs for low-cost live runs. Rates mirror published
  // OpenRouter pricing (USD/Mtok); verify against openrouter.ai/models before
  // citing the dollar figure, since gateway pricing can change.
  "openai/gpt-4o-mini": Object.freeze({ inputPerMtok: 0.15, outputPerMtok: 0.6 }),
  "anthropic/claude-haiku-4.5": Object.freeze({ inputPerMtok: 1.0, outputPerMtok: 5.0 }),
  // Free OpenRouter tiers: $0/Mtok both directions. Used by the breadth sweep
  // (benchmarks/free-sweep.mjs) to show the savings hold across many models at
  // zero marginal cost. Providers rate-limit these upstream, so coverage varies.
  "qwen/qwen3-coder:free": FREE,
  "qwen/qwen3-next-80b-a3b-instruct:free": FREE,
  "meta-llama/llama-3.3-70b-instruct:free": FREE,
  "nousresearch/hermes-3-llama-3.1-405b:free": FREE,
  "openai/gpt-oss-120b:free": FREE,
  "openai/gpt-oss-20b:free": FREE,
  "nvidia/nemotron-3-super-120b-a12b:free": FREE,
  "nvidia/nemotron-3-ultra-550b-a55b:free": FREE,
  "google/gemma-4-31b-it:free": FREE,
  "cohere/north-mini-code:free": FREE,
  "poolside/laguna-m.1:free": FREE,
});

/**
 * Default model list. Live runs override via CLI; the no-network path reads
 * whatever model ids the committed snapshot recorded.
 * @type {readonly string[]}
 */
export const DEFAULT_MODELS = Object.freeze([
  "claude-haiku-4-5",
  "claude-sonnet-4-6",
  "claude-opus-4-8",
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
