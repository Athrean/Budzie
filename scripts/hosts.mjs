// @ts-check
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import path from "node:path";

/**
 * Budzie's host-detection matrix.
 *
 * A single data-driven table maps every supported agent host to: how to detect
 * it (a probe over an injected environment, never the real machine in tests),
 * where its config lives, and which shipped adapter format to install there.
 * One table, no per-host code paths — add a host by adding a row.
 *
 * Adapter formats reuse files Budzie already ships (runtime dirs + the
 * `.claude-plugin` / `.codex-plugin` / `.agents-plugin` manifests + the rules
 * file). No business logic is duplicated per host; a format is only a list of
 * source -> destination copy mappings.
 */

/** Runtime dirs shared by every full-plugin host. */
const RUNTIME_DIRS = Object.freeze([
  "agents",
  "commands",
  "skills",
  "hooks",
  "scripts/hooks",
  "rules",
]);

/**
 * One source -> destination copy mapping. Paths are POSIX, relative to the
 * package root (`from`) and to the host's install target dir (`to`).
 * @typedef {object} CopySpec
 * @property {string} from - Package-root-relative source dir or file.
 * @property {string} to - Target-relative destination dir or file.
 */

/**
 * A shipped adapter format: the ordered copy specs that install Budzie for one
 * class of host. Every `from` references an already-shipped path.
 * @typedef {object} Format
 * @property {string} id
 * @property {CopySpec[]} specs
 */

/** Copy specs for a full plugin host: all runtime dirs + one manifest file. */
function pluginSpecs(/** @type {string} */ manifestDir) {
  /** @type {CopySpec[]} */
  const specs = RUNTIME_DIRS.map((dir) => ({ from: dir, to: dir }));
  specs.push({
    from: `${manifestDir}/plugin.json`,
    to: `${manifestDir}/plugin.json`,
  });
  return specs;
}

/**
 * The shipped adapter formats. Each detected host points at one of these.
 * @type {Readonly<Record<string, Format>>}
 */
export const FORMATS = Object.freeze({
  // Claude-style plugin: full runtime + .claude-plugin/plugin.json hooks.
  "claude-plugin": Object.freeze({
    id: "claude-plugin",
    specs: pluginSpecs(".claude-plugin"),
  }),
  // Codex-style plugin: full runtime + .codex-plugin/plugin.json interface.
  "codex-plugin": Object.freeze({
    id: "codex-plugin",
    specs: pluginSpecs(".codex-plugin"),
  }),
  // Generic agents plugin: full runtime + .agents-plugin/plugin.json + rules.
  "agents-plugin": Object.freeze({
    id: "agents-plugin",
    specs: pluginSpecs(".agents-plugin"),
  }),
  // Skills-only host: drop the skills tree, nothing else.
  "skills-drop": Object.freeze({
    id: "skills-drop",
    specs: [{ from: "skills", to: "skills" }],
  }),
  // Rules-file host (Cursor-style): a single always-applied rules file.
  "rules-file": Object.freeze({
    id: "rules-file",
    specs: [{ from: "rules/budzie.mdc", to: "rules/budzie.mdc" }],
  }),
  // VS Code extension-style host: skills tree dropped under an extension dir.
  "extension-skills": Object.freeze({
    id: "extension-skills",
    specs: [{ from: "skills", to: "skills" }],
  }),
});

/**
 * The probe injected into detection. Tests pass a fake; production wires the
 * real environment. Detection NEVER reads process.env or the disk directly so
 * it stays hermetic and side-effect free.
 * @typedef {object} Probe
 * @property {NodeJS.ProcessEnv} env - Environment (fake HOME/config in tests).
 * @property {(name: string) => boolean} commandExists - `command -v` stand-in.
 * @property {(absPath: string) => boolean} pathExists - Filesystem probe.
 * @property {NodeJS.Platform} platform - `os.platform()` stand-in.
 * @property {string} home - Home directory (fake in tests).
 */

/**
 * One host the installer can detect and target.
 * @typedef {object} Host
 * @property {string} id - Stable host identifier (manifest key).
 * @property {string} label - Human-readable name for plan output.
 * @property {(probe: Probe) => boolean} detect - True when this host is present.
 * @property {(probe: Probe) => string} target - Absolute install dir for the host.
 * @property {string} format - Key into FORMATS.
 */

/** Join under the probe's home dir. */
function inHome(/** @type {Probe} */ probe, /** @type {string[]} */ ...parts) {
  return path.join(probe.home, ...parts);
}

/** Resolve $XDG_CONFIG_HOME or ~/.config under the probe. */
function xdgConfig(/** @type {Probe} */ probe, /** @type {string[]} */ ...parts) {
  const base =
    probe.env.XDG_CONFIG_HOME && probe.env.XDG_CONFIG_HOME.trim() !== ""
      ? probe.env.XDG_CONFIG_HOME
      : inHome(probe, ".config");
  return path.join(base, ...parts);
}

/**
 * macOS Application Support dir under the probe's home.
 * @param {Probe} probe
 * @param {string[]} parts
 * @returns {string}
 */
function appSupport(probe, ...parts) {
  return inHome(probe, "Library", "Application Support", ...parts);
}

/** True when a config dir or any env override for it is present. */
function dirPresent(/** @type {Probe} */ probe, /** @type {string} */ dir) {
  return probe.pathExists(dir);
}

/**
 * The host-detection matrix. Order is install order; ids are manifest keys.
 *
 * Detection methods are intentionally varied to cover the issue's matrix:
 *   - `command -v` CLI probes (Claude Code, Codex, Gemini, Aider, Cody, Copilot).
 *   - config-directory probes (Cursor, Windsurf, Continue, Cline, Zed, OpenCode).
 *   - macOS app bundles (Claude Desktop, ChatGPT Desktop).
 *
 * Every row reuses a shipped FORMATS entry; no per-host install logic exists.
 * @type {ReadonlyArray<Host>}
 */
export const HOST_MATRIX = Object.freeze([
  // ---- CLI tools detected via `command -v` ----
  {
    id: "claude-code",
    label: "Claude Code (CLI)",
    detect: (p) => p.commandExists("claude"),
    target: (p) =>
      p.env.CLAUDE_CONFIG_DIR && p.env.CLAUDE_CONFIG_DIR.trim() !== ""
        ? path.resolve(p.env.CLAUDE_CONFIG_DIR)
        : inHome(p, ".claude"),
    format: "claude-plugin",
  },
  {
    id: "codex-cli",
    label: "Codex (CLI)",
    detect: (p) => p.commandExists("codex"),
    target: (p) =>
      p.env.CODEX_HOME && p.env.CODEX_HOME.trim() !== ""
        ? path.resolve(p.env.CODEX_HOME)
        : inHome(p, ".codex"),
    format: "codex-plugin",
  },
  {
    id: "gemini-cli",
    label: "Gemini (CLI)",
    detect: (p) => p.commandExists("gemini"),
    target: (p) => inHome(p, ".gemini"),
    format: "agents-plugin",
  },
  {
    id: "aider",
    label: "Aider (CLI)",
    detect: (p) => p.commandExists("aider"),
    target: (p) => inHome(p, ".aider"),
    format: "rules-file",
  },
  {
    id: "qwen-code",
    label: "Qwen Code (CLI)",
    detect: (p) => p.commandExists("qwen"),
    target: (p) => inHome(p, ".qwen"),
    format: "agents-plugin",
  },
  {
    id: "opencode",
    label: "OpenCode (CLI)",
    detect: (p) =>
      p.commandExists("opencode") || dirPresent(p, xdgConfig(p, "opencode")),
    target: (p) => xdgConfig(p, "opencode"),
    format: "agents-plugin",
  },
  {
    id: "crush",
    label: "Crush (CLI)",
    detect: (p) =>
      p.commandExists("crush") || dirPresent(p, xdgConfig(p, "crush")),
    target: (p) => xdgConfig(p, "crush"),
    format: "agents-plugin",
  },

  // ---- Editors / IDE config-directory probes ----
  {
    id: "cursor",
    label: "Cursor",
    detect: (p) => dirPresent(p, inHome(p, ".cursor")),
    target: (p) => inHome(p, ".cursor"),
    format: "rules-file",
  },
  {
    id: "windsurf",
    label: "Windsurf",
    detect: (p) => dirPresent(p, inHome(p, ".codeium", "windsurf")),
    target: (p) => inHome(p, ".codeium", "windsurf"),
    format: "rules-file",
  },
  {
    id: "continue",
    label: "Continue",
    detect: (p) => dirPresent(p, inHome(p, ".continue")),
    target: (p) => inHome(p, ".continue"),
    format: "agents-plugin",
  },
  {
    id: "cline",
    label: "Cline",
    detect: (p) => dirPresent(p, inHome(p, ".cline")),
    target: (p) => inHome(p, ".cline"),
    format: "rules-file",
  },
  {
    id: "zed",
    label: "Zed",
    detect: (p) =>
      dirPresent(p, xdgConfig(p, "zed")) ||
      (p.platform === "darwin" && dirPresent(p, appSupport(p, "Zed"))),
    target: (p) =>
      p.platform === "darwin"
        ? appSupport(p, "Zed")
        : xdgConfig(p, "zed"),
    format: "skills-drop",
  },

  // ---- VS Code extension dirs (skills drop under the extensions root) ----
  {
    id: "vscode",
    label: "VS Code",
    detect: (p) => dirPresent(p, inHome(p, ".vscode", "extensions")),
    target: (p) => inHome(p, ".vscode", "extensions", "budzie"),
    format: "extension-skills",
  },
  {
    id: "vscode-insiders",
    label: "VS Code Insiders",
    detect: (p) => dirPresent(p, inHome(p, ".vscode-insiders", "extensions")),
    target: (p) => inHome(p, ".vscode-insiders", "extensions", "budzie"),
    format: "extension-skills",
  },
  {
    id: "cursor-extensions",
    label: "Cursor (extensions)",
    detect: (p) => dirPresent(p, inHome(p, ".cursor", "extensions")),
    target: (p) => inHome(p, ".cursor", "extensions", "budzie"),
    format: "extension-skills",
  },

  // ---- macOS app bundles ----
  {
    id: "claude-desktop",
    label: "Claude Desktop (macOS)",
    detect: (p) =>
      p.platform === "darwin" &&
      p.pathExists("/Applications/Claude.app"),
    target: (p) => appSupport(p, "Claude", "budzie"),
    format: "skills-drop",
  },
  {
    id: "chatgpt-desktop",
    label: "ChatGPT Desktop (macOS)",
    detect: (p) =>
      p.platform === "darwin" &&
      p.pathExists("/Applications/ChatGPT.app"),
    target: (p) => appSupport(p, "com.openai.chat", "budzie"),
    format: "skills-drop",
  },
]);

/**
 * Build a real-machine probe. Production callers pass nothing; the probe reads
 * the live environment, runs `command -v` via shell-free PATH scanning, and
 * stats real paths. Tests pass an explicit probe instead and never reach here.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Probe}
 */
export function realProbe(env = process.env) {
  const home = homedir();
  return {
    env,
    home,
    platform: platform(),
    pathExists: (absPath) => existsSync(absPath),
    commandExists: (name) => commandOnPath(name, env),
  };
}

/**
 * Resolve a command on PATH without spawning a shell (hermetic, zero-network).
 * @param {string} name
 * @param {NodeJS.ProcessEnv} env
 * @returns {boolean}
 */
export function commandOnPath(name, env) {
  const rawPath = env.PATH || "";
  if (rawPath === "") return false;
  const dirs = rawPath.split(path.delimiter).filter(Boolean);
  const exts =
    platform() === "win32"
      ? (env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      if (existsSync(path.join(dir, name + ext))) return true;
    }
  }
  return false;
}

/**
 * Detect every host present in the probed environment.
 * @param {Probe} probe
 * @returns {Host[]} Detected hosts, in matrix order.
 */
export function detectHosts(probe) {
  return HOST_MATRIX.filter((host) => {
    try {
      return host.detect(probe);
    } catch {
      // A misbehaving probe for one host must never abort detection of others.
      return false;
    }
  });
}

/**
 * Look up a host row by id.
 * @param {string} id
 * @returns {Host | undefined}
 */
export function hostById(id) {
  return HOST_MATRIX.find((host) => host.id === id);
}
