// @ts-check
import { walk, classifyMarker } from "./lib/scan.mjs";

/**
 * Real, local savings counts. No baseline, no estimate — measured lines only.
 * @typedef {object} Counts
 * @property {number} markers - Total `budzie:` marker lines found.
 * @property {number} noUpgradeTrigger - Markers that name no upgrade trigger.
 * @property {number} depsAvoided - Markers claiming a dependency was avoided.
 */

/**
 * Walk `root`, classify every line, and tally the three real counts.
 * @param {string} root - Directory to scan.
 * @returns {Promise<Counts>}
 */
export async function tally(root) {
  let markers = 0;
  let noUpgradeTrigger = 0;
  let depsAvoided = 0;

  for await (const row of walk(root)) {
    const m = classifyMarker(row.text);
    if (!m.isBudzie) continue;
    markers++;
    if (!m.hasUpgradeTrigger) noUpgradeTrigger++;
    if (m.depAvoided) depsAvoided++;
  }

  return { markers, noUpgradeTrigger, depsAvoided };
}
