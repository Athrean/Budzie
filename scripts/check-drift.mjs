// @ts-check
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

export const BUDZIE_INVARIANTS = Object.freeze({
  productName: "Budzie",
  packageName: "budzie",
  pluginName: "budzie",
  pluginDisplayName: "Budzie",
});

/**
 * Read and parse a JSON file relative to `root`.
 * @param {string} root
 * @param {string} file
 * @returns {Promise<unknown>}
 */
async function readJson(root, file) {
  return JSON.parse(await readFile(path.join(root, file), "utf8"));
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

  const pkg = await readJson(root, "package.json");
  const plugin = await readJson(root, ".codex-plugin/plugin.json");

  if (!isRecord(pkg) || pkg.name !== BUDZIE_INVARIANTS.packageName) {
    drift.push("package.json name must be budzie");
  }

  if (!isRecord(plugin) || plugin.name !== BUDZIE_INVARIANTS.pluginName) {
    drift.push("plugin manifest name must be budzie");
  }

  const pluginInterface = isRecord(plugin) ? plugin.interface : undefined;
  if (
    !isRecord(pluginInterface) ||
    pluginInterface.displayName !== BUDZIE_INVARIANTS.pluginDisplayName
  ) {
    drift.push("plugin display name must be Budzie");
  }

  await checkCommandFiles(root, drift);
  await checkSkillFiles(root, drift);

  return drift;
}
