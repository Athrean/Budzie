// @ts-check
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BUDZIE_INVARIANTS = Object.freeze({
  productName: "Budzie",
  packageName: "budzie",
  pluginName: "budzie",
  pluginDisplayName: "Budzie",
  requiredRuntimeDirs: Object.freeze(["commands/", "skills/", "scripts/"]),
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
 * Return every detected instruction or adapter drift problem.
 * @param {string} [root]
 * @returns {Promise<string[]>}
 */
export async function checkDrift(root = process.cwd()) {
  /** @type {string[]} */
  const drift = [];

  const pkg = await readRequiredJson(root, "package.json", drift);
  const lock = await readRequiredJson(root, "package-lock.json", drift);
  const plugin = await readRequiredJson(root, ".codex-plugin/plugin.json", drift);

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

    if (
      plugin !== undefined &&
      (!isRecord(plugin) || plugin.version !== packageVersion)
    ) {
      drift.push(
        `plugin manifest version must match package.json version ${packageVersion}`
      );
    }
  }

  if (
    plugin !== undefined &&
    (!isRecord(plugin) || plugin.name !== BUDZIE_INVARIANTS.pluginName)
  ) {
    drift.push("plugin manifest name must be budzie");
  }

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
