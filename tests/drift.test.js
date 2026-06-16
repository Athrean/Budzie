import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BUDZIE_INVARIANTS,
  checkDrift,
} from "../scripts/check-drift.mjs";

/** Absolute path to the CLI under test. */
const CLI = fileURLToPath(new URL("../scripts/check-drift.mjs", import.meta.url));

/**
 * Create a throwaway package-shaped tree and clean it up after `fn` runs.
 * @param {(root: string) => Promise<void> | void} fn
 */
async function withTree(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "budzie-drift-"));
  try {
    writeBaseline(root);
    await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Write a minimal Budzie package fixture.
 * @param {string} root
 */
function writeBaseline(root) {
  writeJson(root, "package.json", {
    name: "budzie",
    version: "0.1.0",
    files: ["commands/", "skills/", "scripts/"],
  });
  writeJson(root, "package-lock.json", {
    name: "budzie",
    version: "0.1.0",
    lockfileVersion: 3,
    packages: {
      "": {
        name: "budzie",
        version: "0.1.0",
      },
    },
  });
  writeJson(root, ".codex-plugin/plugin.json", {
    name: "budzie",
    version: "0.1.0",
    interface: {
      displayName: "Budzie",
    },
  });
  for (const dir of ["commands", "skills", "scripts"]) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
}

/**
 * @param {string} root
 * @param {string} file
 * @param {unknown} data
 */
function writeJson(root, file, data) {
  writeFixtureFile(root, file, JSON.stringify(data, null, 2) + "\n");
}

/**
 * @param {string} root
 * @param {string} file
 * @param {string} text
 */
function writeFixtureFile(root, file, text) {
  const full = path.join(root, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text);
}

test("current repo satisfies canonical Budzie invariants", async () => {
  const drift = await checkDrift();

  assert.equal(BUDZIE_INVARIANTS.productName, "Budzie");
  assert.deepEqual(drift, []);
});

test("command files report missing matching skills and runtime scripts", async () => {
  await withTree(async (root) => {
    writeFixtureFile(
      root,
      "commands/budzie-receipts.toml",
      'prompt = "Run `node scripts/receipts.mjs`."\n'
    );

    const drift = await checkDrift(root);

    assert.deepEqual(drift, [
      "commands/budzie-receipts.toml is missing skills/budzie-receipts/SKILL.md",
      "commands/budzie-receipts.toml references missing scripts/receipts.mjs",
    ]);
  });
});

test("skills report missing claimed runtime scripts", async () => {
  await withTree(async (root) => {
    writeFixtureFile(
      root,
      "skills/budzie-reap/SKILL.md",
      "# Budzie Reaper\n\nRun `node scripts/reap.mjs plan`.\n"
    );

    const drift = await checkDrift(root);

    assert.deepEqual(drift, [
      "skills/budzie-reap/SKILL.md references missing scripts/reap.mjs",
    ]);
  });
});

test("package files report missing shipped runtime directories", async () => {
  await withTree(async (root) => {
    writeJson(root, "package.json", {
      name: "budzie",
      version: "0.1.0",
      files: ["commands/"],
    });

    const drift = await checkDrift(root);

    assert.deepEqual(drift, [
      "package.json files must include skills/",
      "package.json files must include scripts/",
    ]);
  });
});

test("manifests report stale versions", async () => {
  await withTree(async (root) => {
    writeJson(root, "package-lock.json", {
      name: "budzie",
      version: "0.1.1",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "budzie",
          version: "0.1.2",
        },
      },
    });
    writeJson(root, ".codex-plugin/plugin.json", {
      name: "budzie",
      version: "0.2.0",
      interface: {
        displayName: "Budzie",
      },
    });

    const drift = await checkDrift(root);

    assert.deepEqual(drift, [
      "package-lock.json version must match package.json version 0.1.0",
      "package-lock.json root package version must match package.json version 0.1.0",
      "plugin manifest version must match package.json version 0.1.0",
    ]);
  });
});

test("required manifests report missing files", async () => {
  await withTree(async (root) => {
    rmSync(path.join(root, "package-lock.json"));

    const drift = await checkDrift(root);

    assert.deepEqual(drift, ["package-lock.json is missing"]);
  });
});

test("command exits nonzero and prints drift when checks fail", async () => {
  await withTree(async (root) => {
    writeJson(root, "package.json", {
      name: "budzie",
      version: "0.1.0",
      files: ["commands/"],
    });

    const result = spawnSync("node", [CLI, root], { encoding: "utf8" });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /package\.json files must include scripts\//);
  });
});
