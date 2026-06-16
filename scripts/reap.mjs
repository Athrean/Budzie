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

/**
 * Outcome of an apply/verify pass, ready to render as a receipt.
 * @typedef {object} Results
 * @property {Array<unknown>} kept - Cuts whose tests stayed green.
 * @property {Array<unknown>} discarded - Cuts whose tests went red.
 * @property {number} linesRemoved - Total source lines removed.
 * @property {number} depsRemoved - Total dependencies removed.
 */

/**
 * Render the one-line PR-body receipt for a results object.
 * @param {Results} results
 * @returns {string}
 */
export function formatReceipt(results) {
  const { kept, discarded, linesRemoved, depsRemoved } = results;
  return `-${linesRemoved} lines, -${depsRemoved} deps, ${kept.length} cuts kept, ${discarded.length} discarded`;
}

/**
 * Read all of stdin as a UTF-8 string.
 * @returns {Promise<string>}
 */
async function readStdin() {
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * CLI entry point.
 *
 *   reap.mjs plan [--aggressive]   prints a ranked cut plan as JSON
 *   reap.mjs receipt               reads a results JSON on stdin, prints receipt
 *
 * @param {string[]} argv - Arguments after `node reap.mjs`.
 * @returns {Promise<number>} Process exit code.
 */
export async function main(argv) {
  const [command, ...rest] = argv;

  if (command === "plan") {
    const aggressive = rest.includes("--aggressive");
    const results = await plan(process.cwd(), { aggressive });
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
    return 0;
  }

  if (command === "receipt") {
    const raw = await readStdin();
    /** @type {Results} */
    const results = JSON.parse(raw);
    process.stdout.write(formatReceipt(results) + "\n");
    return 0;
  }

  process.stderr.write("usage: reap.mjs plan [--aggressive] | reap.mjs receipt\n");
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    }
  );
}
