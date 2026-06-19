// @ts-check
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { walk, classifyMarker } from "./lib/scan.mjs";
import { writeFileAtomic } from "./lib/atomic-write.mjs";

/**
 * A single planned cut: one source line whose marker names a cut tag.
 * @typedef {object} Cut
 * @property {string} file - Path to the file the cut line lives in.
 * @property {number} line - 1-based line number of the cut.
 * @property {import("./lib/scan.mjs").CutTag} tag - The named cut tag.
 * @property {import("./lib/scan.mjs").Tier} tier - Tier implied by the tag.
 * @property {string} text - Raw line content.
 * @property {number} [endLine] - Last line of the cut range (inclusive); defaults to {@link Cut.line}.
 * @property {true} [suggestOnly] - Set when the cut is listed but never applied.
 */

/**
 * Options for {@link plan}.
 * @typedef {object} PlanOpts
 * @property {boolean} [aggressive] - Include `aggressive`-tier cuts too.
 * @property {(file: string) => boolean} [exclude] - Skip matching paths before reading.
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
  for await (const row of walk(root, { exclude: opts.exclude })) {
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
 * @property {Cut[]} kept - Cuts whose tests stayed green.
 * @property {Cut[]} discarded - Cuts whose tests went red.
 * @property {number} linesRemoved - Total source lines removed.
 * @property {number} depsRemoved - Total dependencies removed.
 */

/**
 * Render the one-line PR-body receipt for a results object. Only the cut counts
 * and the two totals are used, so any results-shaped object is accepted.
 * @param {{ kept: ReadonlyArray<unknown>, discarded: ReadonlyArray<unknown>, linesRemoved: number, depsRemoved: number }} results
 * @returns {string}
 */
export function formatReceipt(results) {
  const { kept, discarded, linesRemoved, depsRemoved } = results;
  return `-${linesRemoved} lines, -${depsRemoved} deps, ${kept.length} cuts kept, ${discarded.length} discarded`;
}

/**
 * Options for {@link verify}.
 * @typedef {object} VerifyOpts
 * @property {string} [root] - Repo root (must be a git work tree). Defaults to cwd.
 * @property {string} test - Project test command, run in each isolated worktree.
 * @property {number} [timeoutMs] - Per-cut test timeout in ms. Default 120000.
 * @property {NodeJS.ProcessEnv} [env] - Environment for the test command.
 */

/**
 * Run a git command in `root`, returning trimmed stdout. Throws on failure.
 * @param {string} root
 * @param {string[]} args
 * @returns {string}
 */
function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/**
 * True when `root` is inside a git work tree that has at least one commit
 * (worktrees branch off `HEAD`, which must resolve).
 * @param {string} root
 * @returns {boolean}
 */
function gitReady(root) {
  try {
    git(root, ["rev-parse", "--is-inside-work-tree"]);
    git(root, ["rev-parse", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove lines `[from, to]` (1-based, inclusive) from a file inside a worktree,
 * preserving the original trailing-newline shape. Returns the count removed.
 * @param {string} worktree
 * @param {string} relFile
 * @param {number} from
 * @param {number} to
 * @returns {number}
 */
function removeLines(worktree, relFile, from, to) {
  const abs = path.join(worktree, relFile);
  const text = readFileSync(abs, "utf8");
  const hadTrailingNewline = text.endsWith("\n");
  const lines = text.split("\n");
  if (hadTrailingNewline) lines.pop(); // drop the empty element after the final \n
  const start = Math.max(1, from);
  const end = Math.min(lines.length, to);
  if (start > lines.length || end < start) return 0;
  const removed = lines.splice(start - 1, end - start + 1).length;
  writeFileAtomic(abs, lines.join("\n") + (hadTrailingNewline ? "\n" : ""));
  return removed;
}

/**
 * Apply each non-suggest cut in its own isolated git worktree, run the project
 * test command there, and keep only the cuts whose tests stay green. The user's
 * working tree is never touched: every edit happens in a throwaway worktree that
 * is always removed. Suggest-only cuts (e.g. `shrink`) are never applied.
 *
 * The test command is operator-supplied and run via the shell inside the
 * worktree — that is the contract (it is the project's own test command). The
 * worktree isolates its filesystem effects from the user's repo, and a green
 * test gate is necessary but never sufficient: the operator still excludes any
 * cut that removes a trust boundary, data-loss guard, or accessibility basic.
 *
 * budzie: cuts are verified sequentially — the ceiling is one test run per cut.
 * Upgrade trigger: parallelise across worktrees once serial test runs dominate.
 *
 * @param {Cut[]} cuts
 * @param {VerifyOpts} opts
 * @returns {Results}
 */
export function verify(cuts, opts) {
  const root = opts.root ?? process.cwd();
  if (!opts.test || opts.test.trim() === "") {
    throw new Error("a project test command is required to verify cuts");
  }
  if (!gitReady(root)) {
    throw new Error("verify needs a git work tree with at least one commit");
  }
  const timeout = opts.timeoutMs ?? 120000;
  const env = opts.env ?? process.env;

  /** @type {Cut[]} */
  const kept = [];
  /** @type {Cut[]} */
  const discarded = [];
  let linesRemoved = 0;

  for (const cut of cuts) {
    if (cut.suggestOnly) continue; // never auto-apply suggest-only cuts
    const rel = path.isAbsolute(cut.file) ? path.relative(root, cut.file) : cut.file;
    const from = cut.line;
    const to = cut.endLine ?? cut.line;

    // mkdtemp creates the parent; git worktree add needs a path that does NOT
    // yet exist, so the checkout goes in a fresh child of the temp parent.
    const parent = mkdtempSync(path.join(tmpdir(), "budzie-reap-"));
    const worktree = path.join(parent, "wt");
    try {
      git(root, ["worktree", "add", "--detach", "--quiet", worktree, "HEAD"]);
      const removed = removeLines(worktree, rel, from, to);
      const run = spawnSync(opts.test, [], {
        cwd: worktree,
        shell: true,
        timeout,
        env,
        encoding: "utf8",
      });
      if (run.status === 0) {
        kept.push(cut);
        linesRemoved += removed;
      } else {
        discarded.push(cut);
      }
    } catch {
      // A worktree/apply error is a red cut, never a kept one.
      discarded.push(cut);
    } finally {
      try {
        git(root, ["worktree", "remove", "--force", worktree]);
      } catch {
        // Worktree absent or never created; the rm below still cleans up.
      }
      rmSync(parent, { recursive: true, force: true });
    }
  }

  return { kept, discarded, linesRemoved, depsRemoved: 0 };
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

  if (command === "verify") {
    const flags = parseFlags(rest);
    const test = typeof flags.test === "string" ? flags.test : undefined;
    if (!test) {
      process.stderr.write('verify requires --test "<command>"\n');
      return 1;
    }
    const planText =
      typeof flags.plan === "string" ? readFileSync(flags.plan, "utf8") : await readStdin();
    /** @type {unknown} */
    const cuts = JSON.parse(planText);
    if (!Array.isArray(cuts)) {
      process.stderr.write("plan must be a JSON array of cuts (pipe `reap.mjs plan`)\n");
      return 1;
    }
    const timeoutMs = typeof flags.timeout === "string" ? Number(flags.timeout) : undefined;
    const results = verify(/** @type {Cut[]} */ (cuts), {
      root: process.cwd(),
      test,
      timeoutMs,
    });
    process.stdout.write(JSON.stringify(results) + "\n");
    return 0;
  }

  process.stderr.write(
    'usage: reap.mjs plan [--aggressive] | reap.mjs verify --test "<cmd>" [--plan <file>] | reap.mjs receipt\n'
  );
  return 1;
}

/**
 * Parse `--key value`, `--key=value`, and boolean flags, ignoring positionals.
 * @param {string[]} argv
 * @returns {Record<string, string | true>}
 */
function parseFlags(argv) {
  /** @type {Record<string, string | true>} */
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq !== -1) {
      flags[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return flags;
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
