// @ts-check
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BUDZIE_INVARIANTS = Object.freeze({
  productName: "Budzie",
  packageName: "budzie",
  pluginName: "budzie",
  pluginDisplayName: "Budzie",
  requiredRuntimeDirs: Object.freeze(["agents/", "commands/", "skills/", "scripts/"]),
  // Thin host adapter manifests. Each references runtime surfaces by relative
  // path only and pins its version to the package version. No business logic.
  adapterManifests: Object.freeze([
    ".codex-plugin/plugin.json",
    ".claude-plugin/plugin.json",
    ".agents-plugin/plugin.json",
    ".opencode/plugin.json",
  ]),
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
  const re = /node\s+(scripts\/[A-Za-z0-9._/-]+\.mjs)\b/g;
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
    if (referenced === 0) {
      drift.push(`${manifest} must reference at least one runtime surface`);
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
