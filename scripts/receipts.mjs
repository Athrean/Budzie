// @ts-check
import { fileURLToPath } from "node:url";

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

/**
 * Render the counts as a multi-line terminal card. Honest, local counts only.
 * @param {Counts} counts
 * @returns {string}
 */
export function renderCard(counts) {
  return [
    "Budzie receipts",
    "  shortcut markers   " + counts.markers,
    "  no upgrade trigger " + counts.noUpgradeTrigger,
    "  deps avoided       " + counts.depsAvoided,
    "(real local counts; no baseline, no estimate)",
  ].join("\n");
}

/**
 * Render a shields.io badge URL embedding the marker count.
 * @param {Counts} counts
 * @returns {string}
 */
export function renderBadge(counts) {
  const message = encodeURIComponent(
    `${counts.markers} markers | ${counts.noUpgradeTrigger} no upgrade | ${counts.depsAvoided} deps`
  );
  return `https://img.shields.io/badge/budzie-${message}-111111`;
}

/**
 * CLI entry point. Default prints the card; `--badge` the badge; `--json` the
 * raw counts. An optional positional arg sets the scan root (default cwd).
 * @param {string[]} argv - Arguments after `node script.mjs`.
 * @returns {Promise<void>}
 */
export async function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const root = argv.find((a) => !a.startsWith("--")) ?? process.cwd();
  const counts = await tally(root);

  if (flags.has("--json")) {
    process.stdout.write(JSON.stringify(counts) + "\n");
    return;
  }
  if (flags.has("--badge")) {
    process.stdout.write(renderBadge(counts) + "\n");
    return;
  }
  process.stdout.write(renderCard(counts) + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(String(err?.stack ?? err) + "\n");
    process.exitCode = 1;
  });
}
