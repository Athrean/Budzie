import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { BUDZIE_INVARIANTS } from "../scripts/check-drift.mjs";

/**
 * @param {string} file
 * @returns {Promise<Record<string, unknown>>}
 */
async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

/**
 * @param {string} target
 * @returns {Promise<boolean>}
 */
async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/** Relative-path references look like `./commands/` or `./hooks/hooks.json`. */
const RELATIVE_REF = /^\.\.?\//;

test("adapter manifest list is non-empty and includes every host", () => {
  assert.ok(BUDZIE_INVARIANTS.adapterManifests.length >= 2);
  assert.ok(BUDZIE_INVARIANTS.adapterManifests.includes(".codex-plugin/plugin.json"));
  assert.ok(BUDZIE_INVARIANTS.adapterManifests.includes(".claude-plugin/plugin.json"));
  assert.ok(BUDZIE_INVARIANTS.adapterManifests.includes(".agents-plugin/plugin.json"));
});

test("every adapter manifest exposes the shared agents surface", async () => {
  for (const manifest of BUDZIE_INVARIANTS.adapterManifests) {
    const data = await readJson(manifest);
    assert.equal(data.agents, "./agents/", `${manifest} must wire up ./agents/`);
  }
});

test("every adapter manifest exists, parses, and is named budzie", async () => {
  for (const manifest of BUDZIE_INVARIANTS.adapterManifests) {
    assert.ok(await pathExists(manifest), `${manifest} should exist`);
    const data = await readJson(manifest);
    assert.equal(data.name, "budzie", `${manifest} name must be budzie`);
  }
});

test("every adapter pins its version to the package version", async () => {
  const pkg = await readJson("package.json");
  for (const manifest of BUDZIE_INVARIANTS.adapterManifests) {
    const data = await readJson(manifest);
    assert.equal(
      data.version,
      pkg.version,
      `${manifest} version must equal package version ${pkg.version}`
    );
  }
});

test("every relative path an adapter references resolves to a real surface", async () => {
  for (const manifest of BUDZIE_INVARIANTS.adapterManifests) {
    const data = await readJson(manifest);
    let referenced = 0;
    for (const value of Object.values(data)) {
      if (typeof value !== "string" || !RELATIVE_REF.test(value)) continue;
      referenced += 1;
      assert.ok(
        await pathExists(path.normalize(value)),
        `${manifest} references missing ${value}`
      );
    }
    assert.ok(referenced > 0, `${manifest} should wire up at least one runtime surface`);
  }
});

test("every shipped adapter directory is in the package files allowlist", async () => {
  const pkg = await readJson("package.json");
  const files = pkg.files;
  assert.ok(Array.isArray(files), "package.json files must be an array");
  for (const manifest of BUDZIE_INVARIANTS.adapterManifests) {
    const dir = manifest.split("/")[0] + "/";
    assert.ok(
      files.includes(dir),
      `package.json files must include ${dir} so ${manifest} ships`
    );
  }
});

test("shared agents surface is in the package files allowlist", async () => {
  const pkg = await readJson("package.json");
  const files = pkg.files;
  assert.ok(Array.isArray(files), "package.json files must be an array");
  assert.ok(files.includes("agents/"), "package.json files must include agents/");
});
