// @ts-check
import { readFile } from "node:fs/promises";
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
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

  return drift;
}
