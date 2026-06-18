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
    files: ["agents/", "commands/", "skills/", "scripts/"],
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
    skills: "./skills/",
    agents: "./agents/",
    hooks: "./hooks/codex.json",
    interface: {
      displayName: "Budzie",
    },
  });
  writeJson(root, ".claude-plugin/plugin.json", {
    name: "budzie",
    version: "0.1.0",
    commands: "./commands/",
    skills: "./skills/",
    agents: "./agents/",
    hooks: "./hooks/hooks.json",
  });
  writeJson(root, ".agents-plugin/plugin.json", {
    name: "budzie",
    version: "0.1.0",
    commands: "./commands/",
    skills: "./skills/",
    agents: "./agents/",
    scripts: "./scripts/",
    rules: "./rules/",
  });
  for (const dir of ["agents", "commands", "skills", "scripts", "hooks", "rules"]) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
  for (const file of ["hooks/hooks.json", "hooks/codex.json"]) {
    writeJson(root, file, {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: "node \"${PLUGIN_ROOT}/scripts/hooks/activate.mjs\"",
              },
            ],
          },
        ],
      },
    });
  }
  writeFixtureFile(root, "scripts/hooks/activate.mjs", "// @ts-check\n");
  writeFixtureFile(
    root,
    "rules/budzie.mdc",
    "---\nalwaysApply: true\n---\nBudzie mode is active.\n"
  );
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

test("invariants pin the installer manifest version and matrix size", () => {
  assert.equal(BUDZIE_INVARIANTS.manifestVersion, 2);
  assert.ok(BUDZIE_INVARIANTS.minHostMatrixSize >= 15);
});

test("installer matrix drift reports a format source missing from the tree", async () => {
  await withTree(async (root) => {
    // The rules-file format ships rules/budzie.mdc; remove it and the
    // data-driven installer-matrix check must catch the dangling source.
    rmSync(path.join(root, "rules/budzie.mdc"));

    const drift = await checkDrift(root);

    assert.ok(
      drift.some((d) =>
        d.includes("format rules-file references missing source rules/budzie.mdc")
      ),
      `expected installer-matrix drift, got: ${JSON.stringify(drift)}`
    );
  });
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

test("agents report missing claimed runtime scripts", async () => {
  await withTree(async (root) => {
    writeFixtureFile(
      root,
      "agents/budzie-reviewer.md",
      "---\nname: budzie-reviewer\n---\nRun `node scripts/agents.mjs dispatch`.\n"
    );

    const drift = await checkDrift(root);

    assert.deepEqual(drift, [
      "agents/budzie-reviewer.md references missing scripts/agents.mjs",
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
      "package.json files must include agents/",
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
      skills: "./skills/",
      hooks: "./hooks/hooks.json",
      interface: {
        displayName: "Budzie",
      },
    });

    const drift = await checkDrift(root);

    assert.deepEqual(drift, [
      "package-lock.json version must match package.json version 0.1.0",
      "package-lock.json root package version must match package.json version 0.1.0",
      ".codex-plugin/plugin.json version must match package.json version 0.1.0",
    ]);
  });
});

test("adapters report references to missing runtime surfaces", async () => {
  await withTree(async (root) => {
    writeJson(root, ".claude-plugin/plugin.json", {
      name: "budzie",
      version: "0.1.0",
      commands: "./commands/",
      skills: "./skills/",
      hooks: "./hooks/nope.json",
    });

    const drift = await checkDrift(root);

    assert.deepEqual(drift, [
      ".claude-plugin/plugin.json references missing ./hooks/nope.json",
    ]);
  });
});

test("adapters report hook surfaces without SessionStart activation", async () => {
  await withTree(async (root) => {
    writeJson(root, "hooks/codex.json", { hooks: {} });

    const drift = await checkDrift(root);

    assert.deepEqual(drift, [
      ".codex-plugin/plugin.json hook surface must declare SessionStart",
    ]);
  });
});

test("adapters report SessionStart hooks without the activation runtime", async () => {
  await withTree(async (root) => {
    writeJson(root, "hooks/codex.json", {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: "node \"${PLUGIN_ROOT}/scripts/hooks/missing.mjs\"",
              },
            ],
          },
        ],
      },
    });

    const drift = await checkDrift(root);

    assert.deepEqual(drift, [
      ".codex-plugin/plugin.json SessionStart must run scripts/hooks/activate.mjs",
    ]);
  });
});

test("adapters report rules that are not always applied", async () => {
  await withTree(async (root) => {
    writeFixtureFile(
      root,
      "rules/budzie.mdc",
      "---\nalwaysApply: false\n---\nBudzie mode is active.\n"
    );

    const drift = await checkDrift(root);

    assert.deepEqual(drift, [
      ".agents-plugin/plugin.json rule rules/budzie.mdc must set alwaysApply: true",
    ]);
  });
});

test("adapters report stale versions per manifest", async () => {
  await withTree(async (root) => {
    writeJson(root, ".agents-plugin/plugin.json", {
      name: "budzie",
      version: "0.9.9",
      skills: "./skills/",
      agents: "./agents/",
      rules: "./rules/",
    });

    const drift = await checkDrift(root);

    assert.deepEqual(drift, [
      ".agents-plugin/plugin.json version must match package.json version 0.1.0",
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
