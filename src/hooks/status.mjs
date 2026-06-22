// @ts-check
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { readConfig } from "../budget.mjs";
import { renderBadge } from "../ledger.mjs";
import { meter, renderMeterBadge } from "../meter.mjs";
import { readMode } from "./mode-tracker.mjs";

/**
 * Read the statusline stdin payload Claude Code provides, if any. Returns the
 * working directory to describe and the live transcript path when present.
 * Falls back to `cwd` on any parse or read error — the statusline must never
 * crash the host.
 * @param {string} fallback
 * @returns {{ cwd: string, transcriptPath: string | undefined }}
 */
function readStatusStdin(fallback) {
  try {
    const raw = readFileSync(0, "utf8");
    if (!raw.trim()) return { cwd: fallback, transcriptPath: undefined };
    const parsed = JSON.parse(raw);
    const obj = parsed && typeof parsed === "object" ? parsed : {};
    const cwd = typeof obj.cwd === "string" && obj.cwd.trim() !== "" ? obj.cwd : fallback;
    const transcriptPath =
      typeof obj.transcript_path === "string" && obj.transcript_path.trim() !== ""
        ? obj.transcript_path
        : undefined;
    return { cwd, transcriptPath };
  } catch {
    return { cwd: fallback, transcriptPath: undefined };
  }
}

/**
 * Describe the local budget state for the statusline.
 * @param {string} root - Project root to read `.budzie/budget.json` from.
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
function budgetSegment(root, env) {
  try {
    const config = readConfig(root, {}, env);
    if (!config) return "no budget";
    return `budget ${config.ceiling} ${config.unit} (${config.mode})`;
  } catch {
    // Invalid/unreadable config: degrade to a neutral label, never throw.
    return "no budget";
  }
}

/**
 * Live session segment from the real-token meter, e.g. `session 3.2k out`.
 * Opt-in via `BUDZIE_STATUSLINE_SESSION` (off by default) so the per-render
 * transcript read never surprises a user on a large session. Returns "" when
 * disabled, when no transcript is given, or when usage is not counted.
 *
 * budzie: reads the whole transcript through the session parser on each render.
 * Upgrade trigger: bounded tail read once statusline latency on big transcripts
 * matters.
 * @param {string} root
 * @param {string | undefined} transcriptPath
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
function sessionSegment(root, transcriptPath, env) {
  const enabled = env.BUDZIE_STATUSLINE_SESSION;
  if (!enabled || enabled.trim() === "" || enabled === "0") return "";
  if (!transcriptPath) return "";
  try {
    return renderMeterBadge(meter({ transcriptPath, cwd: root, env }));
  } catch {
    return ""; // best-effort: a meter read must never break the statusline
  }
}

/**
 * Build the single-line statusline string.
 * @param {string} root
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [transcriptPath] - Live transcript for the optional session meter.
 * @returns {string}
 */
export function renderStatus(root, env = process.env, transcriptPath = undefined) {
  const mode = readMode(env);
  const modeSegment = mode.active ? "on" : "off";
  // Lifetime-savings badge leads the line; mode/budget follow.
  const base = `${renderBadge(env)} | Budzie: ${modeSegment} | ${budgetSegment(root, env)}`;
  const live = sessionSegment(root, transcriptPath, env);
  return live ? `${base} | ${live}` : base;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let line;
  try {
    const { cwd, transcriptPath } = readStatusStdin(process.cwd());
    line = renderStatus(cwd, process.env, transcriptPath);
  } catch {
    // Last-resort guard: a statusline error must never surface to the user.
    line = "[BUDZIE] 0 | Budzie: off | no budget";
  }
  process.stdout.write(line + "\n");
}
