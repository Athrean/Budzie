// @ts-check
import { walk, classifyMarker } from "./lib/scan.mjs";

/**
 * A single planned cut: one source line whose marker names a cut tag.
 * @typedef {object} Cut
 * @property {string} file - Path to the file the cut line lives in.
 * @property {number} line - 1-based line number of the cut.
 * @property {import("./lib/scan.mjs").CutTag} tag - The named cut tag.
 * @property {import("./lib/scan.mjs").Tier} tier - Tier implied by the tag.
 * @property {string} text - Raw line content.
 * @property {true} [suggestOnly] - Set when the cut is listed but never applied.
 */

/**
 * Options for {@link plan}.
 * @typedef {object} PlanOpts
 * @property {boolean} [aggressive] - Include `aggressive`-tier cuts too.
 */

/** Rank order used to sort cuts: auto first, then aggressive, then suggest. */
const TIER_RANK = /** @type {Record<import("./lib/scan.mjs").Tier, number>} */ ({
  auto: 0,
  aggressive: 1,
  suggest: 2,
});

/**
 * Build a ranked cut plan for `root`.
 *
 * Always includes `auto`-tier cuts (`delete`, `stdlib`) and `suggest`-tier
 * cuts (`shrink`, flagged {@link Cut.suggestOnly} so they are never applied).
 * Includes `aggressive`-tier cuts (`native`, `yagni`) only when
 * `opts.aggressive` is true. Results are ranked auto → aggressive → suggest.
 *
 * @param {string} root - Directory to scan.
 * @param {PlanOpts} [opts]
 * @returns {Promise<Cut[]>}
 */
export async function plan(root, opts = {}) {
  const aggressive = opts.aggressive ?? false;

  /** @type {Cut[]} */
  const cuts = [];
  for await (const row of walk(root)) {
    const marker = classifyMarker(row.text);
    if (!marker.cutTag || !marker.tier) continue;
    if (marker.tier === "aggressive" && !aggressive) continue;

    /** @type {Cut} */
    const cut = {
      file: row.file,
      line: row.line,
      tag: marker.cutTag,
      tier: marker.tier,
      text: row.text,
    };
    if (marker.tier === "suggest") cut.suggestOnly = true;
    cuts.push(cut);
  }

  cuts.sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier]);
  return cuts;
}
