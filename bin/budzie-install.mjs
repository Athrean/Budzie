#!/usr/bin/env node
// @ts-check
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Budzie's local installer.
 *
 * Copies Budzie's `commands/` and `skills/` into a host agent config
 * directory, idempotently. A manifest records exactly which paths Budzie
 * installed so `--uninstall` removes only Budzie-managed entries and leaves
 * user-authored files untouched. Node stdlib only — zero dependencies.
 */

/** Runtime directories Budzie ships into a host config dir. */
const MANAGED_DIRS = Object.freeze(["commands", "skills"]);

/** Filename of the manifest that tracks Budzie-managed installs. */
const MANIFEST_NAME = ".budzie-manifest.json";

/** Manifest schema version; bump when the on-disk shape changes. */
const MANIFEST_VERSION = 1;

/** Absolute path to the package root that owns the source files. */
const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/**
 * Parsed command-line options.
 * @typedef {object} Options
 * @property {boolean} dryRun - Print the plan, write nothing.
 * @property {string} configDir - Resolved host config directory.
 * @property {boolean} force - Overwrite existing managed files without asking.
 * @property {boolean} uninstall - Remove Budzie-managed entries instead of installing.
 * @property {boolean} help - Print usage and exit.
 */

/**
 * One planned filesystem change.
 * @typedef {object} Action
 * @property {"copy" | "skip" | "remove"} kind - What will happen to `target`.
 * @property {string} target - Config-dir-relative POSIX path the action affects.
 * @property {string} [reason] - Why a copy was skipped, when relevant.
 */

/**
 * The default host config directory.
 *
 * Honors `BUDZIE_CONFIG_DIR`, then `CLAUDE_CONFIG_DIR`, else `~/.claude`.
 * Documented so callers know exactly where a flagless install lands.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function defaultConfigDir(env = process.env) {
  // budzie: env-var override ceiling — single agent config root. Upgrade to a
  // per-tool resolver when Budzie supports more than one host runtime.
  const fromEnv = env.BUDZIE_CONFIG_DIR || env.CLAUDE_CONFIG_DIR;
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(homedir(), ".claude");
}

/**
 * Parse argv into resolved options. Unknown flags throw.
 * @param {string[]} argv - Arguments after `node script` (i.e. `process.argv.slice(2)`).
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Options}
 */
export function parseArgs(argv, env = process.env) {
  let dryRun = false;
  let force = false;
  let uninstall = false;
  let help = false;
  /** @type {string | undefined} */
  let configDir;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--dry-run":
        dryRun = true;
        break;
      case "--force":
        force = true;
        break;
      case "--uninstall":
        uninstall = true;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      case "--config-dir": {
        const value = argv[++i];
        if (value === undefined) {
          throw new Error("--config-dir requires a path argument");
        }
        configDir = value;
        break;
      }
      default: {
        if (arg.startsWith("--config-dir=")) {
          configDir = arg.slice("--config-dir=".length);
          break;
        }
        throw new Error(`Unknown argument: ${arg}`);
      }
    }
  }

  return {
    dryRun,
    force,
    uninstall,
    help,
    configDir: configDir ? path.resolve(configDir) : defaultConfigDir(env),
  };
}

/**
 * List every source file Budzie ships, as config-dir-relative POSIX paths.
 * @param {string} [packageRoot]
 * @returns {string[]}
 */
export function listManagedFiles(packageRoot = PACKAGE_ROOT) {
  /** @type {string[]} */
  const files = [];
  for (const dir of MANAGED_DIRS) {
    const abs = path.join(packageRoot, dir);
    if (!existsSync(abs)) continue;
    for (const rel of walkFiles(abs)) {
      files.push(`${dir}/${rel}`);
    }
  }
  return files.sort();
}

/**
 * Yield every file under `root` as a POSIX path relative to `root`.
 * @param {string} root
 * @returns {string[]}
 */
function walkFiles(root) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  const recurse = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        recurse(abs);
      } else if (entry.isFile()) {
        out.push(toPosix(path.relative(root, abs)));
      }
    }
  };
  recurse(root);
  return out;
}

/**
 * @param {string} p
 * @returns {string}
 */
function toPosix(p) {
  return p.split(path.sep).join("/");
}

/**
 * Read the install manifest, or return an empty one when absent/invalid.
 * @param {string} configDir
 * @returns {{ version: number, files: string[] }}
 */
function readManifest(configDir) {
  const manifestPath = path.join(configDir, MANIFEST_NAME);
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
    const files = Array.isArray(parsed?.files)
      ? parsed.files.filter((/** @type {unknown} */ f) => typeof f === "string")
      : [];
    return { version: MANIFEST_VERSION, files };
  } catch {
    return { version: MANIFEST_VERSION, files: [] };
  }
}

/**
 * Compare a source file to its installed copy, byte for byte.
 * @param {string} src - Absolute source path.
 * @param {string} dest - Absolute destination path.
 * @returns {boolean}
 */
function sameBytes(src, dest) {
  if (!existsSync(dest)) return false;
  try {
    return readFileSync(src).equals(readFileSync(dest));
  } catch {
    return false;
  }
}

/**
 * Build the ordered list of actions an install would perform.
 *
 * Pure: reads source and destination but writes nothing.
 * @param {Options} options
 * @param {string} [packageRoot]
 * @returns {Action[]}
 */
export function planInstall(options, packageRoot = PACKAGE_ROOT) {
  /** @type {Action[]} */
  const actions = [];
  for (const rel of listManagedFiles(packageRoot)) {
    const src = path.join(packageRoot, rel);
    const dest = path.join(options.configDir, rel);
    if (sameBytes(src, dest)) {
      actions.push({ kind: "skip", target: rel, reason: "unchanged" });
    } else if (existsSync(dest) && !options.force) {
      // budzie: conservative-by-default ceiling — never clobber an existing,
      // differing file unless --force. Upgrade trigger: a real merge strategy
      // if users start hand-editing installed Budzie files.
      actions.push({ kind: "skip", target: rel, reason: "exists; use --force" });
    } else {
      actions.push({ kind: "copy", target: rel });
    }
  }
  return actions;
}

/**
 * Build the ordered list of actions an uninstall would perform.
 *
 * Only paths recorded in the manifest are considered, so user-authored files
 * are never touched. Pure: writes nothing.
 * @param {Options} options
 * @returns {Action[]}
 */
export function planUninstall(options) {
  const manifest = readManifest(options.configDir);
  /** @type {Action[]} */
  const actions = [];
  for (const rel of [...manifest.files].sort()) {
    const dest = path.join(options.configDir, rel);
    if (existsSync(dest)) {
      actions.push({ kind: "remove", target: rel });
    } else {
      actions.push({ kind: "skip", target: rel, reason: "already absent" });
    }
  }
  return actions;
}

/**
 * Remove now-empty directories that Budzie created, walking upward, but never
 * past the config dir itself.
 * @param {string} configDir
 * @param {string[]} relFiles - Config-dir-relative POSIX file paths.
 */
function pruneEmptyDirs(configDir, relFiles) {
  /** @type {Set<string>} */
  const dirs = new Set();
  for (const rel of relFiles) {
    let dir = path.dirname(rel);
    while (dir && dir !== "." && dir !== "/") {
      dirs.add(dir);
      dir = path.dirname(dir);
    }
  }
  // Deepest paths first so children are removed before parents.
  for (const rel of [...dirs].sort((a, b) => b.length - a.length)) {
    const abs = path.join(configDir, rel);
    try {
      if (statSync(abs).isDirectory() && readdirSync(abs).length === 0) {
        rmdirSync(abs);
      }
    } catch {
      // Missing or non-empty: leave it alone.
    }
  }
}

/**
 * Apply an install. Copies managed files and writes the manifest.
 * @param {Options} options
 * @param {string} [packageRoot]
 * @returns {Action[]} The actions performed.
 */
export function runInstall(options, packageRoot = PACKAGE_ROOT) {
  const actions = planInstall(options, packageRoot);
  mkdirSync(options.configDir, { recursive: true });
  for (const action of actions) {
    if (action.kind !== "copy") continue;
    const src = path.join(packageRoot, action.target);
    const dest = path.join(options.configDir, action.target);
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(src, dest);
  }

  // Manifest tracks every file Budzie owns now, including ones that already
  // matched, so a later uninstall removes the full set.
  const managed = listManagedFiles(packageRoot);
  const manifest = { version: MANIFEST_VERSION, files: managed };
  writeFileSync(
    path.join(options.configDir, MANIFEST_NAME),
    JSON.stringify(manifest, null, 2) + "\n"
  );
  return actions;
}

/**
 * Apply an uninstall. Removes only manifest-recorded files, prunes empty
 * Budzie directories, and deletes the manifest.
 * @param {Options} options
 * @returns {Action[]} The actions performed.
 */
export function runUninstall(options) {
  const manifest = readManifest(options.configDir);
  const actions = planUninstall(options);
  for (const action of actions) {
    if (action.kind !== "remove") continue;
    rmSync(path.join(options.configDir, action.target), { force: true });
  }
  pruneEmptyDirs(options.configDir, manifest.files);
  const manifestPath = path.join(options.configDir, MANIFEST_NAME);
  rmSync(manifestPath, { force: true });
  return actions;
}

/**
 * Render a plan as human-readable lines.
 * @param {Options} options
 * @param {Action[]} actions
 * @returns {string}
 */
export function formatPlan(options, actions) {
  const verb = options.uninstall ? "Uninstall" : "Install";
  const head = `${verb} plan for ${options.configDir}`;
  if (actions.length === 0) {
    return `${head}\n  (nothing to do)\n`;
  }
  const lines = actions.map((a) => {
    const note = a.reason ? ` (${a.reason})` : "";
    return `  ${a.kind.padEnd(6)} ${a.target}${note}`;
  });
  return `${head}\n${lines.join("\n")}\n`;
}

/** Usage text printed by `--help`. */
export const HELP_TEXT = `Budzie installer — copy Budzie commands and skills into a host agent config dir.

Usage:
  budzie-install [options]

Options:
  --config-dir <path>   Target config directory (default: $BUDZIE_CONFIG_DIR,
                        then $CLAUDE_CONFIG_DIR, else ~/.claude)
  --dry-run             Print the planned changes and write nothing
  --force               Overwrite existing differing files
  --uninstall           Remove only Budzie-managed entries
  -h, --help            Show this help

Install records a manifest (${MANIFEST_NAME}) in the config dir so uninstall
removes only Budzie-managed files and preserves everything you authored.
`;

/**
 * CLI entry point.
 * @param {string[]} argv - `process.argv.slice(2)`.
 * @param {{ stdout?: (s: string) => void, stderr?: (s: string) => void, env?: NodeJS.ProcessEnv }} [io]
 * @returns {number} Process exit code.
 */
export function main(argv, io = {}) {
  const out = io.stdout ?? ((s) => process.stdout.write(s));
  const err = io.stderr ?? ((s) => process.stderr.write(s));

  /** @type {Options} */
  let options;
  try {
    options = parseArgs(argv, io.env);
  } catch (e) {
    err(`${e instanceof Error ? e.message : String(e)}\n\n`);
    err(HELP_TEXT);
    return 2;
  }

  if (options.help) {
    out(HELP_TEXT);
    return 0;
  }

  const actions = options.uninstall
    ? planUninstall(options)
    : planInstall(options);

  if (options.dryRun) {
    out(formatPlan(options, actions));
    out("Dry run: no changes written.\n");
    return 0;
  }

  if (options.uninstall) {
    runUninstall(options);
  } else {
    runInstall(options);
  }
  out(formatPlan(options, actions));
  out(`${options.uninstall ? "Uninstall" : "Install"} complete.\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
