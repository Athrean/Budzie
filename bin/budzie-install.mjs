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
import path from "node:path";
import { fileURLToPath } from "node:url";

import { removeMode } from "../scripts/hooks/mode-tracker.mjs";
import { ledgerPath } from "../scripts/ledger.mjs";
import {
  FORMATS,
  detectHosts,
  hostById,
  realProbe,
} from "../scripts/hosts.mjs";

/**
 * Budzie's multi-host installer.
 *
 * Detects every supported agent host via a data-driven matrix (see
 * `scripts/hosts.mjs`) and installs the correct shipped adapter format into
 * each host's config dir, idempotently. A versioned manifest records, per host,
 * exactly which paths Budzie installed so `--uninstall` removes only
 * Budzie-managed entries and leaves user-authored files untouched. Node stdlib
 * only — zero dependencies.
 */

/** Filename of the manifest that tracks Budzie-managed installs. */
const MANIFEST_NAME = ".budzie-manifest.json";

/**
 * Manifest schema version. Bump when the on-disk shape changes.
 *   v1: flat `{ version, files: string[] }` for a single config dir.
 *   v2: per-host `{ version, hosts: { [id]: { target, format, files } } }`.
 * Read-back stays compatible: a v1 manifest is upgraded in memory on read.
 */
export const MANIFEST_VERSION = 2;

/** Absolute path to the package root that owns the source files. */
const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/**
 * A concrete install/uninstall target resolved from a host (or an explicit
 * --config-dir). Detection is already done; this is the unit plans run over.
 * @typedef {object} Target
 * @property {string} id - Host id (or "config-dir" for explicit targets).
 * @property {string} label - Human-readable host name.
 * @property {string} dir - Absolute install dir.
 * @property {string} format - Key into FORMATS.
 */

/**
 * Parsed command-line options.
 * @typedef {object} Options
 * @property {boolean} dryRun - Print the plan, write nothing.
 * @property {string | undefined} configDir - Explicit single-target override.
 * @property {string[]} hostIds - Explicit host ids to target (via --host).
 * @property {boolean} all - Install for every detected host.
 * @property {boolean} force - Overwrite existing managed files without asking.
 * @property {boolean} uninstall - Remove Budzie-managed entries instead of installing.
 * @property {boolean} deleteLedger - Also delete the lifetime savings ledger on uninstall.
 * @property {boolean} help - Print usage and exit.
 */

/**
 * One planned filesystem change for one target.
 * @typedef {object} Action
 * @property {"copy" | "skip" | "remove"} kind - What will happen to `target`.
 * @property {string} target - Install-dir-relative POSIX path the action affects.
 * @property {string} [reason] - Why a copy was skipped, when relevant.
 */

/**
 * A plan for one resolved target plus its actions.
 * @typedef {object} TargetPlan
 * @property {Target} target
 * @property {Action[]} actions
 */

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
  let deleteLedger = false;
  let help = false;
  let all = false;
  /** @type {string | undefined} */
  let configDir;
  /** @type {string[]} */
  const hostIds = [];

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
      case "--delete-ledger":
        deleteLedger = true;
        break;
      case "--all":
        all = true;
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
      case "--host": {
        const value = argv[++i];
        if (value === undefined) {
          throw new Error("--host requires a host id argument");
        }
        hostIds.push(value);
        break;
      }
      default: {
        if (arg.startsWith("--config-dir=")) {
          configDir = arg.slice("--config-dir=".length);
          break;
        }
        if (arg.startsWith("--host=")) {
          hostIds.push(arg.slice("--host=".length));
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
    deleteLedger,
    help,
    all,
    hostIds,
    configDir: configDir ? path.resolve(configDir) : undefined,
  };
}

/**
 * Resolve the concrete install/uninstall targets for a run.
 *
 * Precedence:
 *   1. `--config-dir` → one explicit target using the claude-plugin format
 *      (back-compatible default layout).
 *   2. `--host <id>` (repeatable) → those specific matrix hosts, detected or not.
 *   3. `--all` → every host the probe detects.
 *   4. (default) → every host the probe detects (same as --all).
 *
 * For uninstall, targets also include any host recorded in an existing manifest
 * so a host that has since disappeared from the machine still gets cleaned up.
 * @param {Options} options
 * @param {import("../scripts/hosts.mjs").Probe} [probe]
 * @returns {Target[]}
 */
export function resolveTargets(options, probe = realProbe()) {
  if (options.configDir) {
    return [
      {
        id: "config-dir",
        label: `explicit (${options.configDir})`,
        dir: options.configDir,
        format: "claude-plugin",
      },
    ];
  }

  /** @type {Map<string, Target>} */
  const targets = new Map();

  if (options.hostIds.length > 0) {
    for (const id of options.hostIds) {
      const host = hostById(id);
      if (!host) throw new Error(`Unknown host id: ${id}`);
      targets.set(id, {
        id: host.id,
        label: host.label,
        dir: host.target(probe),
        format: host.format,
      });
    }
  } else {
    for (const host of detectHosts(probe)) {
      targets.set(host.id, {
        id: host.id,
        label: host.label,
        dir: host.target(probe),
        format: host.format,
      });
    }
  }

  return [...targets.values()];
}

/**
 * Expand a format into the list of install-dir-relative POSIX file paths it
 * ships, resolved against the package root. Directory specs are walked; file
 * specs are mapped one-to-one. Reuses only shipped files.
 * @param {string} formatId
 * @param {string} [packageRoot]
 * @returns {{ rel: string, src: string }[]}
 */
export function formatFiles(formatId, packageRoot = PACKAGE_ROOT) {
  const format = FORMATS[formatId];
  if (!format) throw new Error(`Unknown format: ${formatId}`);

  /** @type {{ rel: string, src: string }[]} */
  const out = [];
  for (const spec of format.specs) {
    const absFrom = path.join(packageRoot, spec.from);
    if (!existsSync(absFrom)) continue;
    if (statSync(absFrom).isDirectory()) {
      for (const child of walkFiles(absFrom)) {
        out.push({
          rel: `${spec.to}/${child}`,
          src: path.join(absFrom, child),
        });
      }
    } else {
      out.push({ rel: spec.to, src: absFrom });
    }
  }
  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return out;
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
 * The empty, current-version manifest shape.
 * @returns {{ version: number, hosts: Record<string, { target: string, format: string, files: string[] }> }}
 */
function emptyManifest() {
  return { version: MANIFEST_VERSION, hosts: {} };
}

/**
 * Read the install manifest from a dir, normalizing legacy shapes to v2.
 *
 * A v1 manifest (`{ version: 1, files: [...] }`) is upgraded in memory to a
 * single synthetic host keyed "config-dir" rooted at `dir`, so older installs
 * still uninstall cleanly.
 * @param {string} dir - Directory holding the manifest.
 * @returns {{ version: number, hosts: Record<string, { target: string, format: string, files: string[] }> }}
 */
export function readManifest(dir) {
  const manifestPath = path.join(dir, MANIFEST_NAME);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return emptyManifest();
  }
  if (!parsed || typeof parsed !== "object") return emptyManifest();

  // v2 (current): per-host record.
  if (parsed.hosts && typeof parsed.hosts === "object") {
    /** @type {Record<string, { target: string, format: string, files: string[] }>} */
    const hosts = {};
    for (const [id, entry] of Object.entries(parsed.hosts)) {
      if (!entry || typeof entry !== "object") continue;
      const e = /** @type {Record<string, unknown>} */ (entry);
      const files = Array.isArray(e.files)
        ? e.files.filter((f) => typeof f === "string")
        : [];
      const target = typeof e.target === "string" ? e.target : dir;
      const format = typeof e.format === "string" ? e.format : "claude-plugin";
      hosts[id] = { target, format, files };
    }
    return { version: MANIFEST_VERSION, hosts };
  }

  // v1 (legacy): flat file list rooted at this dir.
  if (Array.isArray(parsed.files)) {
    const files = parsed.files.filter((/** @type {unknown} */ f) => typeof f === "string");
    return {
      version: MANIFEST_VERSION,
      hosts: {
        "config-dir": { target: dir, format: "claude-plugin", files },
      },
    };
  }

  return emptyManifest();
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
 * Build the ordered actions an install would perform for one target.
 *
 * Pure: reads source and destination but writes nothing.
 * @param {Target} target
 * @param {Options} options
 * @param {string} [packageRoot]
 * @returns {Action[]}
 */
export function planInstallTarget(target, options, packageRoot = PACKAGE_ROOT) {
  /** @type {Action[]} */
  const actions = [];
  for (const { rel, src } of formatFiles(target.format, packageRoot)) {
    const dest = path.join(target.dir, rel);
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
 * Build the ordered actions an uninstall would perform for one manifest host.
 *
 * Only paths recorded in the manifest are considered, so user-authored files
 * are never touched. Pure: writes nothing.
 * @param {string} dir - The host's install dir.
 * @param {string[]} files - Manifest-recorded install-dir-relative paths.
 * @returns {Action[]}
 */
export function planUninstallTarget(dir, files) {
  /** @type {Action[]} */
  const actions = [];
  for (const rel of [...files].sort()) {
    const dest = path.join(dir, rel);
    if (existsSync(dest)) {
      actions.push({ kind: "remove", target: rel });
    } else {
      actions.push({ kind: "skip", target: rel, reason: "already absent" });
    }
  }
  return actions;
}

/**
 * Build the full multi-target install plan.
 * @param {Options} options
 * @param {{ probe?: import("../scripts/hosts.mjs").Probe, packageRoot?: string }} [ctx]
 * @returns {TargetPlan[]}
 */
export function planInstall(options, ctx = {}) {
  const targets = resolveTargets(options, ctx.probe);
  return targets.map((target) => ({
    target,
    actions: planInstallTarget(target, options, ctx.packageRoot),
  }));
}

/**
 * Build the full multi-target uninstall plan. Targets come from the manifest
 * recorded in each resolved install dir (plus any extra hosts that manifest
 * lists), never from a fresh source walk — uninstall touches only what was
 * recorded as Budzie-managed.
 * @param {Options} options
 * @param {{ probe?: import("../scripts/hosts.mjs").Probe }} [ctx]
 * @returns {TargetPlan[]}
 */
export function planUninstall(options, ctx = {}) {
  const resolved = resolveTargets(options, ctx.probe);

  /** @type {Map<string, { target: Target, files: string[] }>} */
  const byDir = new Map();
  for (const target of resolved) {
    const manifest = readManifest(target.dir);
    // The manifest in this dir may record several hosts (e.g. a shared config
    // dir). Honor every recorded host so nothing is orphaned.
    for (const [id, entry] of Object.entries(manifest.hosts)) {
      byDir.set(entry.target, {
        target: {
          id,
          label: target.id === id ? target.label : id,
          dir: entry.target,
          format: entry.format,
        },
        files: entry.files,
      });
    }
  }

  return [...byDir.values()].map(({ target, files }) => ({
    target,
    actions: planUninstallTarget(target.dir, files),
  }));
}

/**
 * Remove now-empty directories that Budzie created, walking upward, but never
 * past the install dir itself.
 * @param {string} dir
 * @param {string[]} relFiles - Install-dir-relative POSIX file paths.
 */
function pruneEmptyDirs(dir, relFiles) {
  /** @type {Set<string>} */
  const dirs = new Set();
  for (const rel of relFiles) {
    let d = path.dirname(rel);
    while (d && d !== "." && d !== "/") {
      dirs.add(d);
      d = path.dirname(d);
    }
  }
  // Deepest paths first so children are removed before parents.
  for (const rel of [...dirs].sort((a, b) => b.length - a.length)) {
    const abs = path.join(dir, rel);
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
 * Apply an install across every resolved target. Copies managed files and
 * writes one manifest per install dir.
 * @param {Options} options
 * @param {{ probe?: import("../scripts/hosts.mjs").Probe, packageRoot?: string }} [ctx]
 * @returns {TargetPlan[]} The plans performed.
 */
export function runInstall(options, ctx = {}) {
  const plans = planInstall(options, ctx);

  // Group plans by install dir so a shared dir gets one merged manifest.
  /** @type {Map<string, TargetPlan[]>} */
  const byDir = new Map();
  for (const plan of plans) {
    const list = byDir.get(plan.target.dir) ?? [];
    list.push(plan);
    byDir.set(plan.target.dir, list);
  }

  for (const [dir, dirPlans] of byDir) {
    mkdirSync(dir, { recursive: true });
    for (const plan of dirPlans) {
      const files = formatFiles(plan.target.format, ctx.packageRoot);
      /** @type {Map<string, string>} */
      const srcByRel = new Map(files.map((f) => [f.rel, f.src]));
      for (const action of plan.actions) {
        if (action.kind !== "copy") continue;
        const src = srcByRel.get(action.target);
        if (!src) continue;
        const dest = path.join(dir, action.target);
        mkdirSync(path.dirname(dest), { recursive: true });
        cpSync(src, dest);
      }
    }
    writeManifest(dir, dirPlans);
  }

  return plans;
}

/**
 * Write/merge a v2 manifest for one install dir from its plans.
 *
 * Manifest records only files Budzie actually owns per host: ones it copied now
 * and ones already byte-identical to Budzie's source. A file skipped because
 * the user authored a differing copy is theirs — recording it would let a later
 * uninstall delete the user's file. Re-runs replace each host's entry wholesale
 * (no duplicate accumulation), but preserve entries for hosts not in this run.
 * @param {string} dir
 * @param {TargetPlan[]} dirPlans
 */
function writeManifest(dir, dirPlans) {
  const manifest = readManifest(dir);
  for (const plan of dirPlans) {
    const owned = plan.actions
      .filter(
        (a) =>
          a.kind === "copy" || (a.kind === "skip" && a.reason === "unchanged")
      )
      .map((a) => a.target)
      .sort();
    manifest.hosts[plan.target.id] = {
      target: dir,
      format: plan.target.format,
      files: owned,
    };
  }
  manifest.version = MANIFEST_VERSION;
  writeFileSync(
    path.join(dir, MANIFEST_NAME),
    JSON.stringify(manifest, null, 2) + "\n"
  );
}

/**
 * Decide how uninstall should treat the local lifetime savings ledger.
 * @param {Options} options
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ path: string, deleted: boolean, existed: boolean }}
 */
export function planLedger(options, env = process.env) {
  const file = ledgerPath(env);
  return {
    path: file,
    deleted: options.deleteLedger === true,
    existed: existsSync(file),
  };
}

/**
 * Apply an uninstall across every recorded target. Removes only
 * manifest-recorded files, prunes empty Budzie dirs, and rewrites/deletes each
 * manifest.
 * @param {Options} options
 * @param {{ probe?: import("../scripts/hosts.mjs").Probe, env?: NodeJS.ProcessEnv }} [ctx]
 * @returns {TargetPlan[]} The plans performed.
 */
export function runUninstall(options, ctx = {}) {
  const env = ctx.env ?? process.env;
  const plans = planUninstall(options, ctx);

  // Group by install dir so a shared dir's manifest is rewritten once.
  /** @type {Map<string, TargetPlan[]>} */
  const byDir = new Map();
  for (const plan of plans) {
    const list = byDir.get(plan.target.dir) ?? [];
    list.push(plan);
    byDir.set(plan.target.dir, list);
  }

  for (const [dir, dirPlans] of byDir) {
    const removed = new Set(dirPlans.map((p) => p.target.id));
    /** @type {string[]} */
    const prunable = [];
    for (const plan of dirPlans) {
      for (const action of plan.actions) {
        if (action.kind !== "remove") continue;
        rmSync(path.join(dir, action.target), { force: true });
        prunable.push(action.target);
      }
    }
    pruneEmptyDirs(dir, prunable);

    // Drop the uninstalled hosts from this dir's manifest; if none remain,
    // delete the manifest entirely.
    const manifest = readManifest(dir);
    for (const id of removed) delete manifest.hosts[id];
    const manifestPath = path.join(dir, MANIFEST_NAME);
    if (Object.keys(manifest.hosts).length === 0) {
      rmSync(manifestPath, { force: true });
    } else {
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    }
  }

  removeMode(env);
  const ledger = planLedger(options, env);
  if (ledger.deleted && ledger.existed) rmSync(ledger.path, { force: true });
  return plans;
}

/**
 * Render a multi-target plan as human-readable lines.
 * @param {Options} options
 * @param {TargetPlan[]} plans
 * @returns {string}
 */
export function formatPlan(options, plans) {
  const verb = options.uninstall ? "Uninstall" : "Install";
  if (plans.length === 0) {
    return `${verb} plan\n  (no hosts detected)\n`;
  }
  /** @type {string[]} */
  const out = [];
  for (const { target, actions } of plans) {
    out.push(`${verb} plan for ${target.label} → ${target.dir}`);
    if (actions.length === 0) {
      out.push("  (nothing to do)");
      continue;
    }
    for (const a of actions) {
      const note = a.reason ? ` (${a.reason})` : "";
      out.push(`  ${a.kind.padEnd(6)} ${a.target}${note}`);
    }
  }
  return out.join("\n") + "\n";
}

/**
 * @param {{ path: string, deleted: boolean, existed: boolean }} ledger
 * @returns {string}
 */
export function formatLedgerNotice(ledger) {
  if (!ledger.existed) return `Ledger: none found at ${ledger.path}.\n`;
  if (ledger.deleted) return `Ledger: deleted ${ledger.path} (--delete-ledger).\n`;
  return `Ledger: preserved at ${ledger.path} (pass --delete-ledger to remove it).\n`;
}

/** Usage text printed by `--help`. */
export const HELP_TEXT = `Budzie installer — detect agent hosts and install the right Budzie adapter for each.

Usage:
  budzie-install [options]

By default, detects every supported host on this machine and installs Budzie's
runtime and activation files for each in the correct format.

Options:
  --all                 Install for every detected host (the default behavior)
  --host <id>           Target a specific host by id (repeatable)
  --config-dir <path>   Install one explicit target dir using the default layout
  --dry-run             Print the planned changes and write nothing
  --force               Overwrite existing differing files
  --uninstall           Remove only Budzie-managed entries (per recorded host)
  --delete-ledger       On uninstall, also delete the lifetime savings ledger
                        (default: preserve it)
  -h, --help            Show this help

Each install dir gets a manifest (${MANIFEST_NAME}) recording exactly which
files Budzie owns, so uninstall removes only Budzie-managed files and preserves
everything you authored. Uninstall preserves the lifetime savings ledger unless
--delete-ledger is passed.
`;

/**
 * CLI entry point.
 * @param {string[]} argv - `process.argv.slice(2)`.
 * @param {{ stdout?: (s: string) => void, stderr?: (s: string) => void, env?: NodeJS.ProcessEnv, probe?: import("../scripts/hosts.mjs").Probe }} [io]
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

  const probe = io.probe ?? realProbe(io.env);
  /** @type {TargetPlan[]} */
  let plans;
  try {
    plans = options.uninstall
      ? planUninstall(options, { probe })
      : planInstall(options, { probe });
  } catch (e) {
    err(`${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }

  if (options.dryRun) {
    out(formatPlan(options, plans));
    if (options.uninstall) out(formatLedgerNotice(planLedger(options, io.env)));
    out("Dry run: no changes written.\n");
    return 0;
  }

  const ledger = options.uninstall ? planLedger(options, io.env) : undefined;
  if (options.uninstall) {
    runUninstall(options, { probe, env: io.env });
  } else {
    runInstall(options, { probe });
  }
  out(formatPlan(options, plans));
  if (ledger) out(formatLedgerNotice(ledger));
  out(`${options.uninstall ? "Uninstall" : "Install"} complete.\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
