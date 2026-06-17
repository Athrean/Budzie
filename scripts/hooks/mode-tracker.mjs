// @ts-check
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Local-only record of whether Budzie mode is active for this host.
 * @typedef {object} ModeState
 * @property {boolean} active - True when Budzie instructions were activated.
 * @property {string} updatedAt - ISO timestamp of the last activation change.
 */

/** Flag filename inside the host data dir. */
const FLAG_FILE = "mode.json";

/** App folder used under every host data root. */
const APP_DIR = "budzie";

/**
 * Resolve the host data directory for Budzie's local-only state.
 *
 * Resolution order, first hit wins:
 *   1. `BUDZIE_DATA_DIR` (explicit opt-out of host defaults, used by tests).
 *   2. Windows: `%LOCALAPPDATA%` or `%APPDATA%`, then `%USERPROFILE%`.
 *   3. POSIX: `$XDG_DATA_HOME`, else `$HOME/.local/share`.
 *   4. Fallback: the OS temp dir, so we never write into the user's repo.
 *
 * This is a host data dir, never the guarded project root: activation state is
 * machine-local and must not land in a user's working tree.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} Absolute path to the Budzie data dir.
 */
export function resolveDataDir(env = process.env) {
  const explicit = env.BUDZIE_DATA_DIR;
  if (explicit && explicit.trim() !== "") return path.resolve(explicit);

  if (process.platform === "win32") {
    const base = env.LOCALAPPDATA || env.APPDATA;
    if (base && base.trim() !== "") return path.join(base, APP_DIR);
    if (env.USERPROFILE && env.USERPROFILE.trim() !== "") {
      return path.join(env.USERPROFILE, "AppData", "Local", APP_DIR);
    }
  } else {
    const xdg = env.XDG_DATA_HOME;
    if (xdg && xdg.trim() !== "") return path.join(xdg, APP_DIR);
    if (env.HOME && env.HOME.trim() !== "") {
      return path.join(env.HOME, ".local", "share", APP_DIR);
    }
  }

  // budzie: last-resort temp fallback when no home/profile env is set; upgrade
  // when a host without a writable temp dir needs supporting.
  return path.join(process.env.TMPDIR || "/tmp", APP_DIR);
}

/**
 * Absolute path to the activation flag file.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function flagPath(env = process.env) {
  return path.join(resolveDataDir(env), FLAG_FILE);
}

/**
 * Read the current Budzie mode state. Missing or unreadable state reads as
 * inactive — this never throws, so callers in hooks stay non-blocking.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {ModeState}
 */
export function readMode(env = process.env) {
  const file = flagPath(env);
  if (!existsSync(file)) return { active: false, updatedAt: "" };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object" && typeof parsed.active === "boolean") {
      const updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : "";
      return { active: parsed.active, updatedAt };
    }
  } catch {
    // Corrupt flag file: treat as inactive rather than blocking the session.
  }
  return { active: false, updatedAt: "" };
}

/**
 * Record activation or deactivation locally and return the new state.
 * @param {boolean} active
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {ModeState}
 */
export function writeMode(active, env = process.env) {
  /** @type {ModeState} */
  const state = { active, updatedAt: new Date().toISOString() };
  const file = flagPath(env);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
  return state;
}
