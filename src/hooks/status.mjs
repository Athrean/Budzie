// @ts-check
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { readConfig } from "../budget.mjs";
import { renderBadge } from "../ledger.mjs";
import { readMode } from "./mode-tracker.mjs";

/**
 * Read the statusline stdin payload Claude Code provides, if any. Returns the
 * working directory the status should describe. Falls back to `cwd` on any
 * parse or read error — the statusline must never crash the host.
 * @param {string} fallback
 * @returns {string}
 */
function readCwdFromStdin(fallback) {
  try {
    const raw = readFileSync(0, "utf8");
    if (!raw.trim()) return fallback;
    const parsed = JSON.parse(raw);
    const cwd = parsed && typeof parsed === "object" ? parsed.cwd : undefined;
    return typeof cwd === "string" && cwd.trim() !== "" ? cwd : fallback;
  } catch {
    return fallback;
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
 * Build the single-line statusline string.
 * @param {string} root
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function renderStatus(root, env = process.env) {
  const mode = readMode(env);
  const modeSegment = mode.active ? "on" : "off";
  // Lifetime-savings badge leads the line; mode/budget follow.
  return `${renderBadge(env)} | Budzie: ${modeSegment} | ${budgetSegment(root, env)}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let line;
  try {
    const root = readCwdFromStdin(process.cwd());
    line = renderStatus(root);
  } catch {
    // Last-resort guard: a statusline error must never surface to the user.
    line = "[BUDZIE] 0 | Budzie: off | no budget";
  }
  process.stdout.write(line + "\n");
}
