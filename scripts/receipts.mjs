// @ts-check
import { fileURLToPath } from "node:url";
import path from "node:path";

import { walk, classifyMarker } from "./lib/scan.mjs";

/**
 * Real, local savings counts. No baseline, no estimate — measured lines only.
 * @typedef {object} Counts
 * @property {number} markers - Total `budzie:` marker lines found.
 * @property {number} noUpgradeTrigger - Markers that name no upgrade trigger.
 * @property {number} depsAvoided - Markers claiming a dependency was avoided.
 */

/**
 * One detailed Budzie marker row.
 * @typedef {object} LedgerRow
 * @property {string} file - Path to the marker file, relative to the scan root.
 * @property {number} line - 1-based line number within the file.
 * @property {string} marker - Marker line text.
 * @property {import("./lib/scan.mjs").CutTag | null} cutTag - First named cut tag, else null.
 * @property {import("./lib/scan.mjs").Tier | null} tier - Tier implied by the cut tag, else null.
 * @property {boolean} depAvoided - Marker claims a dependency was avoided.
 * @property {boolean} hasUpgradeTrigger - Marker names an upgrade trigger.
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
 * Walk `root`, classify every line, and return one row per Budzie marker.
 * @param {string} root - Directory to scan.
 * @returns {Promise<LedgerRow[]>}
 */
export async function ledger(root) {
  /** @type {LedgerRow[]} */
  const rows = [];

  for await (const row of walk(root)) {
    const m = classifyMarker(row.text);
    if (!m.isBudzie) continue;
    rows.push({
      file: path.relative(root, row.file) || path.basename(row.file),
      line: row.line,
      marker: row.text.trim(),
      cutTag: m.cutTag,
      tier: m.tier,
      depAvoided: m.depAvoided,
      hasUpgradeTrigger: m.hasUpgradeTrigger,
    });
  }

  return rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
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
 * Render a tabular marker ledger. Missing upgrade triggers are explicit.
 * @param {LedgerRow[]} rows
 * @returns {string}
 */
export function renderLedger(rows) {
  const lines = [
    "Budzie marker ledger",
    "file\tline\tmarker\tcut tag\ttier\tdep avoided\tupgrade trigger",
  ];

  for (const row of rows) {
    lines.push(
      [
        row.file,
        row.line,
        row.marker,
        row.cutTag ?? "-",
        row.tier ?? "-",
        row.depAvoided ? "yes" : "no",
        row.hasUpgradeTrigger ? "yes" : "MISSING",
      ]
        .map((cell) => String(cell).replaceAll("\t", " "))
        .join("\t")
    );
  }

  lines.push("(real local marker ledger; MISSING means no upgrade trigger)");
  return lines.join("\n");
}

/**
 * CLI entry point. Default prints the card; `--badge` the badge; `--json` the
 * raw counts; `--ledger` the marker ledger. An optional positional arg sets
 * the scan root (default cwd).
 * @param {string[]} argv - Arguments after `node script.mjs`.
 * @returns {Promise<void>}
 */
export async function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const root = argv.find((a) => !a.startsWith("--")) ?? process.cwd();

  if (flags.has("--json")) {
    const counts = await tally(root);
    process.stdout.write(JSON.stringify(counts) + "\n");
    return;
  }
  if (flags.has("--badge")) {
    const counts = await tally(root);
    process.stdout.write(renderBadge(counts) + "\n");
    return;
  }
  if (flags.has("--ledger")) {
    process.stdout.write(renderLedger(await ledger(root)) + "\n");
    return;
  }
  const counts = await tally(root);
  process.stdout.write(renderCard(counts) + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(String(err?.stack ?? err) + "\n");
    process.exitCode = 1;
  });
}
