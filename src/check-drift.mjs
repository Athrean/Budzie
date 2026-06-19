// @ts-check
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MANIFEST_VERSION } from "../bin/budzie-install.mjs";
import { FORMATS, HOST_MATRIX } from "./hosts.mjs";

/**
 * @typedef {object} HookActivationSurface
 * @property {"hooks"} field
 * @property {"session-start"} kind
 * @property {string} runtime
 */

/**
 * @typedef {object} RuleActivationSurface
 * @property {"rules"} field
 * @property {"always-applied-rule"} kind
 * @property {string} file
 */

/** @typedef {HookActivationSurface | RuleActivationSurface} ActivationSurface */

/** @type {Readonly<Record<string, ActivationSurface>>} */
const ADAPTER_ACTIVATION_SURFACES = Object.freeze({
  ".codex-plugin/plugin.json": Object.freeze({
    field: "hooks",
    kind: "session-start",
    runtime: "src/hooks/activate.mjs",
  }),
  ".claude-plugin/plugin.json": Object.freeze({
    field: "hooks",
    kind: "session-start",
    runtime: "src/hooks/activate.mjs",
  }),
  ".agents-plugin/plugin.json": Object.freeze({
    field: "rules",
    kind: "always-applied-rule",
    file: "budzie.mdc",
  }),
  "gemini-extension.json": Object.freeze({
    field: "hooks",
    kind: "session-start",
    runtime: "src/hooks/activate.mjs",
  }),
  ".opencode/plugin.json": Object.freeze({
    field: "hooks",
    kind: "session-start",
    runtime: "src/hooks/activate.mjs",
  }),
});

export const BUDZIE_INVARIANTS = Object.freeze({
  productName: "Budzie",
  packageName: "budzie",
  pluginName: "budzie",
  pluginDisplayName: "Budzie",
  // The installer's manifest schema version. Drift bumps the moment this and
  // the installer disagree, forcing a deliberate version bump on shape changes.
  manifestVersion: 2,
  // The minimum host count the detection matrix must cover (issue contract).
  minHostMatrixSize: 15,
  requiredRuntimeDirs: Object.freeze([
    "agents/",
    "commands/",
    "skills/",
    "src/",
    "hooks/",
    "rules/",
  ]),
  // Thin host adapter manifests. Each references runtime surfaces by relative
  // path only and pins its version to the package version. No business logic.
  adapterManifests: Object.freeze([
    ".codex-plugin/plugin.json",
    ".claude-plugin/plugin.json",
    ".agents-plugin/plugin.json",
    ".opencode/plugin.json",
    "gemini-extension.json",
  ]),
  adapterActivationSurfaces: ADAPTER_ACTIVATION_SURFACES,
});

/**
 * Read and parse a required JSON file relative to `root`.
 * @param {string} root
 * @param {string} file
 * @param {string[]} drift
 * @returns {Promise<unknown | undefined>}
 */
async function readRequiredJson(root, file, drift) {
  try {
    return JSON.parse(await readFile(path.join(root, file), "utf8"));
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      err.code === "ENOENT"
    ) {
      drift.push(`${file} is missing`);
      return undefined;
    }
    if (err instanceof SyntaxError) {
      drift.push(`${file} is invalid JSON`);
      return undefined;
    }
    throw err;
  }
}

/**
 * @param {string} root
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listFiles(root, dir) {
  try {
    const entries = await readdir(path.join(root, dir), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * @param {string} root
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listDirectories(root, dir) {
  try {
    const entries = await readdir(path.join(root, dir), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * @param {string} root
 * @param {string} file
 * @returns {Promise<boolean>}
 */
async function fileExists(root, file) {
  try {
    return (await stat(path.join(root, file))).isFile();
  } catch {
    return false;
  }
}

/**
 * True when `target` resolves to a real file or directory under `root`.
 * @param {string} root
 * @param {string} target
 * @returns {Promise<boolean>}
 */
async function pathExists(root, target) {
  try {
    await stat(path.join(root, target));
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {value is string[]}
 */
function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function runtimeScriptRefs(text) {
  const refs = new Set();
  const re = /node\s+(src\/[A-Za-z0-9._/-]+\.mjs)\b/g;
  for (const match of text.matchAll(re)) refs.add(match[1]);
  return [...refs].sort();
}

/**
 * @param {string} root
 * @param {string[]} drift
 * @returns {Promise<void>}
 */
async function checkCommandFiles(root, drift) {
  const commands = (await listFiles(root, "commands")).filter((file) =>
    file.endsWith(".toml")
  );

  for (const commandFile of commands) {
    const commandPath = `commands/${commandFile}`;
    const commandName = commandFile.slice(0, -".toml".length);
    const skillPath = `skills/${commandName}/SKILL.md`;
    if (!(await fileExists(root, skillPath))) {
      drift.push(`${commandPath} is missing ${skillPath}`);
    }

    const text = await readFile(path.join(root, commandPath), "utf8");
    for (const scriptPath of runtimeScriptRefs(text)) {
      if (!(await fileExists(root, scriptPath))) {
        drift.push(`${commandPath} references missing ${scriptPath}`);
      }
    }
  }
}

/**
 * @param {string} root
 * @param {string[]} drift
 * @returns {Promise<void>}
 */
async function checkSkillFiles(root, drift) {
  for (const skillDir of await listDirectories(root, "skills")) {
    const skillPath = `skills/${skillDir}/SKILL.md`;
    if (!(await fileExists(root, skillPath))) continue;

    const text = await readFile(path.join(root, skillPath), "utf8");
    for (const scriptPath of runtimeScriptRefs(text)) {
      if (!(await fileExists(root, scriptPath))) {
        drift.push(`${skillPath} references missing ${scriptPath}`);
      }
    }
  }
}

/**
 * @param {string} root
 * @param {string[]} drift
 * @returns {Promise<void>}
 */
async function checkAgentFiles(root, drift) {
  const agents = (await listFiles(root, "agents")).filter((file) =>
    file.endsWith(".md")
  );

  for (const agentFile of agents) {
    const agentPath = `agents/${agentFile}`;
    const text = await readFile(path.join(root, agentPath), "utf8");
    for (const scriptPath of runtimeScriptRefs(text)) {
      if (!(await fileExists(root, scriptPath))) {
        drift.push(`${agentPath} references missing ${scriptPath}`);
      }
    }
  }
}

/**
 * Validate that an adapter hook file exposes a real SessionStart surface.
 * @param {string} root
 * @param {string} manifest
 * @param {string} hookPath
 * @param {string} runtime
 * @param {string[]} drift
 * @returns {Promise<void>}
 */
async function checkHookSurface(root, manifest, hookPath, runtime, drift) {
  const data = await readRequiredJson(root, hookPath, drift);
  const hooks = isRecord(data) ? data.hooks : undefined;
  const sessionStart = isRecord(hooks) ? hooks.SessionStart : undefined;
  if (!Array.isArray(sessionStart) || sessionStart.length === 0) {
    drift.push(`${manifest} hook surface must declare SessionStart`);
    return;
  }

  const commands = sessionStart.flatMap((group) => {
    if (!isRecord(group) || !Array.isArray(group.hooks)) return [];
    return group.hooks
      .filter(isRecord)
      .map((handler) => handler.command)
      .filter((command) => typeof command === "string");
  });
  if (
    !commands.some((command) => command.includes(runtime)) ||
    !(await fileExists(root, runtime))
  ) {
    drift.push(`${manifest} SessionStart must run ${runtime}`);
  }
}

/**
 * Validate the always-applied rule file declared by a rules adapter.
 * @param {string} root
 * @param {string} manifest
 * @param {string} rulesPath
 * @param {string} file
 * @param {string[]} drift
 * @returns {Promise<void>}
 */
async function checkRuleSurface(root, manifest, rulesPath, file, drift) {
  const rulePath = path.join(rulesPath, file);
  if (!(await fileExists(root, rulePath))) {
    drift.push(`${manifest} rules activation is missing ${rulePath}`);
    return;
  }

  const text = await readFile(path.join(root, rulePath), "utf8");
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (
    frontmatter === null ||
    !/^alwaysApply:\s*true\s*$/m.test(frontmatter[1])
  ) {
    drift.push(`${manifest} rule ${rulePath} must set alwaysApply: true`);
  }
}

/**
 * Validate the activation contract assigned to one adapter.
 * @param {string} root
 * @param {string} manifest
 * @param {Record<string, unknown>} data
 * @param {string[]} drift
 * @returns {Promise<void>}
 */
async function checkAdapterActivationSurface(root, manifest, data, drift) {
  const surface = ADAPTER_ACTIVATION_SURFACES[manifest];
  if (surface === undefined) {
    drift.push(`${manifest} is missing an activation-surface contract`);
    return;
  }

  const surfacePath = data[surface.field];
  if (typeof surfacePath !== "string") {
    drift.push(`${manifest} must declare a ${surface.field} activation surface`);
    return;
  }
  if (!(await pathExists(root, surfacePath))) {
    drift.push(
      `${manifest} ${surface.field} activation surface is missing ${surfacePath}`
    );
    return;
  }

  if (surface.kind === "session-start") {
    await checkHookSurface(
      root,
      manifest,
      surfacePath,
      surface.runtime,
      drift
    );
  } else {
    await checkRuleSurface(root, manifest, surfacePath, surface.file, drift);
  }
}

/**
 * Validate every thin host adapter manifest: its version must equal the
 * package version, and every relative path it references must resolve to a real
 * runtime surface (command, skill, script, or hook). Data-driven over
 * `BUDZIE_INVARIANTS.adapterManifests`; adds no per-host special cases.
 * @param {string} root
 * @param {string | undefined} packageVersion
 * @param {string[]} drift
 * @returns {Promise<void>}
 */
async function checkAdapterManifests(root, packageVersion, drift) {
  for (const manifest of BUDZIE_INVARIANTS.adapterManifests) {
    const data = await readRequiredJson(root, manifest, drift);
    if (data === undefined) continue;
    if (!isRecord(data)) {
      drift.push(`${manifest} must be a JSON object`);
      continue;
    }

    if (data.name !== BUDZIE_INVARIANTS.pluginName) {
      drift.push(`${manifest} name must be ${BUDZIE_INVARIANTS.pluginName}`);
    }

    if (typeof packageVersion === "string" && data.version !== packageVersion) {
      drift.push(
        `${manifest} version must match package.json version ${packageVersion}`
      );
    }

    let referenced = 0;
    for (const value of Object.values(data)) {
      if (typeof value !== "string" || !/^\.\.?\//.test(value)) continue;
      referenced += 1;
      if (!(await pathExists(root, value))) {
        drift.push(`${manifest} references missing ${value}`);
      }
    }
    await checkAdapterActivationSurface(root, manifest, data, drift);
    if (referenced === 0) {
      drift.push(`${manifest} must reference at least one runtime surface`);
    }
  }
}

/**
 * Validate the installer's host-detection matrix and manifest logic.
 *
 * Data-driven over `HOST_MATRIX` and `FORMATS` — no per-host special cases:
 *   - The matrix covers at least the contracted host count.
 *   - Host ids are unique (manifest keys must not collide).
 *   - Every host references a real format.
 *   - Every format's source paths resolve to real shipped surfaces under root.
 *   - The manifest version constant is current (forces a bump on shape change).
 * @param {string} root
 * @param {string[]} drift
 * @returns {Promise<void>}
 */
async function checkInstallerMatrix(root, drift) {
  if (HOST_MATRIX.length < BUDZIE_INVARIANTS.minHostMatrixSize) {
    drift.push(
      `host matrix must cover at least ${BUDZIE_INVARIANTS.minHostMatrixSize} hosts (has ${HOST_MATRIX.length})`
    );
  }

  /** @type {Set<string>} */
  const seen = new Set();
  for (const host of HOST_MATRIX) {
    if (seen.has(host.id)) drift.push(`host matrix has a duplicate id ${host.id}`);
    seen.add(host.id);
    if (!FORMATS[host.format]) {
      drift.push(`host ${host.id} references unknown format ${host.format}`);
    }
  }

  // Every format must reuse only shipped source paths (no invented files).
  /** @type {Set<string>} */
  const checked = new Set();
  for (const format of Object.values(FORMATS)) {
    for (const spec of format.specs) {
      if (checked.has(spec.from)) continue;
      checked.add(spec.from);
      if (!(await pathExists(root, spec.from))) {
        drift.push(`format ${format.id} references missing source ${spec.from}`);
      }
    }
  }

  if (MANIFEST_VERSION !== BUDZIE_INVARIANTS.manifestVersion) {
    drift.push(
      `installer manifest version ${MANIFEST_VERSION} must equal invariant ${BUDZIE_INVARIANTS.manifestVersion}`
    );
  }

  // Every detected host must be named in the README so the supported-host list
  // can't silently fall behind the matrix (the matrix grew to 17 while the docs
  // still advertised 5). budzie: a substring presence check, not a table
  // parser; upgrade to structured table parsing if the README ever needs to
  // list a host's label without claiming support for it.
  let readme;
  try {
    readme = await readFile(path.join(root, "README.md"), "utf8");
  } catch {
    readme = null;
  }
  if (readme !== null) {
    for (const host of HOST_MATRIX) {
      if (!readme.includes(host.label)) {
        drift.push(
          `host ${host.id} (${host.label}) is not documented in README.md`
        );
      }
    }
  }
}

/**
 * Return every detected instruction or adapter drift problem.
 * @param {string} [root]
 * @returns {Promise<string[]>}
 */
export async function checkDrift(root = process.cwd()) {
  /** @type {string[]} */
  const drift = [];

  const pkg = await readRequiredJson(root, "package.json", drift);
  const lock = await readRequiredJson(root, "package-lock.json", drift);
  // The codex adapter's existence/parse/name/version is reported by the
  // data-driven checkAdapterManifests pass; here we only read it (drift sink
  // discarded) for its host-specific interface.displayName surface.
  const plugin = await readRequiredJson(root, ".codex-plugin/plugin.json", []);

  if (
    pkg !== undefined &&
    (!isRecord(pkg) || pkg.name !== BUDZIE_INVARIANTS.packageName)
  ) {
    drift.push("package.json name must be budzie");
  }

  const packageFiles = isRecord(pkg) ? pkg.files : undefined;
  if (pkg !== undefined) {
    if (!isStringArray(packageFiles)) {
      drift.push("package.json files must list shipped runtime directories");
    } else {
      for (const dir of BUDZIE_INVARIANTS.requiredRuntimeDirs) {
        if (!packageFiles.includes(dir)) {
          drift.push(`package.json files must include ${dir}`);
        }
      }
    }
  }

  const packageVersion = isRecord(pkg) ? pkg.version : undefined;
  if (pkg !== undefined && typeof packageVersion !== "string") {
    drift.push("package.json version must be a string");
  } else if (typeof packageVersion === "string") {
    if (
      lock !== undefined &&
      (!isRecord(lock) || lock.version !== packageVersion)
    ) {
      drift.push(
        `package-lock.json version must match package.json version ${packageVersion}`
      );
    }

    const lockPackages = isRecord(lock) ? lock.packages : undefined;
    const lockRootPackage = isRecord(lockPackages) ? lockPackages[""] : undefined;
    if (
      lock !== undefined &&
      (!isRecord(lockRootPackage) ||
        lockRootPackage.version !== packageVersion)
    ) {
      drift.push(
        `package-lock.json root package version must match package.json version ${packageVersion}`
      );
    }
  }

  // Adapter name + version + referenced-surface checks are data-driven over
  // BUDZIE_INVARIANTS.adapterManifests (covers .codex-plugin and every host).
  await checkAdapterManifests(
    root,
    typeof packageVersion === "string" ? packageVersion : undefined,
    drift
  );

  const pluginInterface = isRecord(plugin) ? plugin.interface : undefined;
  if (
    plugin !== undefined &&
    (!isRecord(pluginInterface) ||
      pluginInterface.displayName !== BUDZIE_INVARIANTS.pluginDisplayName)
  ) {
    drift.push("plugin display name must be Budzie");
  }

  await checkCommandFiles(root, drift);
  await checkSkillFiles(root, drift);
  await checkAgentFiles(root, drift);
  await checkInstallerMatrix(root, drift);

  return drift;
}

/**
 * CLI entry point. Optional positional arg sets the repo root.
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const root = argv[0] ?? process.cwd();
  const drift = await checkDrift(root);

  if (drift.length === 0) {
    process.stdout.write("Budzie drift checks passed\n");
    return 0;
  }

  process.stderr.write(
    ["Budzie drift checks failed:", ...drift.map((item) => `- ${item}`)].join(
      "\n"
    ) + "\n"
  );
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
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
