import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  defaultConfigDir,
  formatPlan,
  HELP_TEXT,
  listManagedFiles,
  main,
  parseArgs,
  planInstall,
  planUninstall,
  runInstall,
  runUninstall,
} from "../bin/budzie-install.mjs";
import {
  flagPath,
  writeMode,
} from "../scripts/hooks/mode-tracker.mjs";

/** Absolute path to the CLI under test. */
const CLI = fileURLToPath(new URL("../bin/budzie-install.mjs", import.meta.url));

/**
 * Build a throwaway "package root" with sample runtime dirs plus an isolated
 * config dir, then clean both up after `fn` runs.
 * @param {(ctx: { pkgRoot: string, configDir: string }) => Promise<void> | void} fn
 */
async function withFixture(fn) {
  const base = mkdtempSync(path.join(tmpdir(), "budzie-install-"));
  const pkgRoot = path.join(base, "pkg");
  const configDir = path.join(base, "config");
  try {
    writeFixtureFile(pkgRoot, "commands/budzie.toml", 'description = "main"\n');
    writeFixtureFile(pkgRoot, "commands/budzie-help.toml", 'description = "help"\n');
    writeFixtureFile(pkgRoot, "agents/budzie-reviewer.md", "# Budzie reviewer\n");
    writeFixtureFile(pkgRoot, "skills/budzie/SKILL.md", "# Budzie\n");
    writeFixtureFile(
      pkgRoot,
      "skills/budzie-reap/references/contracts.md",
      "# contracts\n"
    );
    writeFixtureFile(
      pkgRoot,
      "hooks/hooks.json",
      '{"hooks":{"SessionStart":[]}}\n'
    );
    writeFixtureFile(
      pkgRoot,
      "hooks/codex.json",
      '{"hooks":{"SessionStart":[]}}\n'
    );
    writeFixtureFile(
      pkgRoot,
      "scripts/hooks/activate.mjs",
      'process.stdout.write("active");\n'
    );
    writeFixtureFile(
      pkgRoot,
      "rules/budzie.mdc",
      "---\nalwaysApply: true\n---\nBudzie mode is active.\n"
    );
    await fn({ pkgRoot, configDir });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/**
 * @param {string} root
 * @param {string} rel
 * @param {string} text
 */
function writeFixtureFile(root, rel, text) {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text);
}

/**
 * Snapshot every file under `root` as a path -> bytes map for byte-comparison.
 * @param {string} root
 * @returns {Map<string, string>}
 */
function snapshot(root) {
  /** @type {Map<string, string>} */
  const out = new Map();
  /** @param {string} dir */
  const recurse = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) recurse(abs);
      else if (entry.isFile())
        out.set(path.relative(root, abs), readFileSync(abs, "utf8"));
    }
  };
  recurse(root);
  return out;
}

/** @param {string} p */
function exists(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

test("parseArgs reads each flag", () => {
  const opts = parseArgs(
    ["--dry-run", "--force", "--uninstall", "--config-dir", "/tmp/x"],
    {}
  );
  assert.equal(opts.dryRun, true);
  assert.equal(opts.force, true);
  assert.equal(opts.uninstall, true);
  assert.equal(opts.configDir, path.resolve("/tmp/x"));
});

test("parseArgs supports --config-dir=value and -h", () => {
  const opts = parseArgs(["--config-dir=/tmp/y", "-h"], {});
  assert.equal(opts.configDir, path.resolve("/tmp/y"));
  assert.equal(opts.help, true);
});

test("parseArgs defaults config dir and honors env overrides", () => {
  const fallback = parseArgs([], {});
  assert.equal(fallback.configDir, defaultConfigDir({}));

  const overridden = parseArgs([], { BUDZIE_CONFIG_DIR: "/tmp/env-cfg" });
  assert.equal(overridden.configDir, path.resolve("/tmp/env-cfg"));

  assert.equal(
    defaultConfigDir({ CLAUDE_CONFIG_DIR: "/tmp/claude-cfg" }),
    path.resolve("/tmp/claude-cfg")
  );
});

test("parseArgs rejects unknown flags and missing --config-dir value", () => {
  assert.throws(() => parseArgs(["--nope"], {}), /Unknown argument/);
  assert.throws(() => parseArgs(["--config-dir"], {}), /requires a path/);
});

test("dry-run writes nothing", async () => {
  await withFixture(async ({ pkgRoot, configDir }) => {
    const before = snapshot(configDir);
    const opts = parseArgs(["--dry-run", "--config-dir", configDir], {});
    const actions = planInstall(opts, pkgRoot);

    // Render and confirm the plan describes copies but touches no disk.
    const text = formatPlan(opts, actions);
    assert.match(text, /Install plan/);
    assert.ok(actions.some((a) => a.kind === "copy"));

    const after = snapshot(configDir);
    assert.deepEqual([...after.keys()], [...before.keys()]);
    assert.equal(exists(configDir), false, "config dir not created by dry-run");
  });
});

test("fresh install creates expected Budzie entries and a manifest", async () => {
  await withFixture(async ({ pkgRoot, configDir }) => {
    const opts = parseArgs(["--config-dir", configDir], {});
    runInstall(opts, pkgRoot);

    for (const rel of [
      "commands/budzie.toml",
      "commands/budzie-help.toml",
      "agents/budzie-reviewer.md",
      "skills/budzie/SKILL.md",
      "skills/budzie-reap/references/contracts.md",
    ]) {
      assert.ok(exists(path.join(configDir, rel)), `installed ${rel}`);
    }

    const manifest = JSON.parse(
      readFileSync(path.join(configDir, ".budzie-manifest.json"), "utf8")
    );
    assert.deepEqual(manifest.files.sort(), listManagedFiles(pkgRoot).sort());
  });
});

test("fresh install includes every activation hook and its runtime", async () => {
  await withFixture(async ({ pkgRoot, configDir }) => {
    const opts = parseArgs(["--config-dir", configDir], {});
    runInstall(opts, pkgRoot);

    for (const rel of [
      "hooks/hooks.json",
      "hooks/codex.json",
      "scripts/hooks/activate.mjs",
      "rules/budzie.mdc",
    ]) {
      assert.ok(exists(path.join(configDir, rel)), `installed ${rel}`);
    }
  });
});

test("reinstall is idempotent (byte-identical, no churn)", async () => {
  await withFixture(async ({ pkgRoot, configDir }) => {
    const opts = parseArgs(["--config-dir", configDir], {});
    runInstall(opts, pkgRoot);
    const first = snapshot(configDir);

    const secondActions = runInstall(opts, pkgRoot);
    const second = snapshot(configDir);

    // Every file unchanged byte for byte.
    assert.deepEqual([...second.entries()], [...first.entries()]);
    // No file was (re)copied on the second pass.
    assert.ok(
      secondActions.every((a) => a.kind === "skip"),
      "second install copies nothing"
    );
  });
});

test("uninstall removes only Budzie entries and preserves user files", async () => {
  await withFixture(async ({ pkgRoot, configDir }) => {
    const opts = parseArgs(["--config-dir", configDir], {});
    runInstall(opts, pkgRoot);

    // A pre-existing user-authored file living alongside Budzie commands.
    writeFixtureFile(configDir, "commands/my-own.toml", "mine\n");
    writeFixtureFile(configDir, "settings.json", "{}\n");

    runUninstall(opts, {
      BUDZIE_DATA_DIR: path.join(path.dirname(configDir), "data"),
    });

    // Budzie entries gone.
    assert.equal(exists(path.join(configDir, "commands/budzie.toml")), false);
    assert.equal(exists(path.join(configDir, "agents/budzie-reviewer.md")), false);
    assert.equal(exists(path.join(configDir, "skills/budzie")), false);
    assert.equal(
      exists(path.join(configDir, ".budzie-manifest.json")),
      false,
      "manifest removed"
    );

    // User files intact.
    assert.equal(
      readFileSync(path.join(configDir, "commands/my-own.toml"), "utf8"),
      "mine\n"
    );
    assert.equal(
      readFileSync(path.join(configDir, "settings.json"), "utf8"),
      "{}\n"
    );
    // The user's commands dir survives because it still holds my-own.toml.
    assert.ok(exists(path.join(configDir, "commands")));
  });
});

test("uninstall removes Budzie hooks and activation flag but preserves neighboring files", async () => {
  await withFixture(async ({ pkgRoot, configDir }) => {
    const opts = parseArgs(["--config-dir", configDir], {});
    const env = { BUDZIE_DATA_DIR: path.join(path.dirname(configDir), "data") };
    runInstall(opts, pkgRoot);
    writeMode(true, env);
    writeFixtureFile(configDir, "hooks/user.json", '{"hooks":{}}\n');
    writeFixtureFile(path.dirname(flagPath(env)), "ledger.json", '{"sessions":[]}\n');

    runUninstall(opts, env);

    assert.equal(exists(path.join(configDir, "hooks/hooks.json")), false);
    assert.equal(exists(path.join(configDir, "hooks/codex.json")), false);
    assert.equal(exists(path.join(configDir, "rules/budzie.mdc")), false);
    assert.equal(exists(flagPath(env)), false);
    assert.equal(
      readFileSync(path.join(configDir, "hooks/user.json"), "utf8"),
      '{"hooks":{}}\n'
    );
    assert.equal(
      readFileSync(path.join(path.dirname(flagPath(env)), "ledger.json"), "utf8"),
      '{"sessions":[]}\n'
    );
  });
});

test("install does not clobber a differing existing file without --force", async () => {
  await withFixture(async ({ pkgRoot, configDir }) => {
    writeFixtureFile(configDir, "commands/budzie.toml", "USER EDIT\n");
    const opts = parseArgs(["--config-dir", configDir], {});
    runInstall(opts, pkgRoot);

    assert.equal(
      readFileSync(path.join(configDir, "commands/budzie.toml"), "utf8"),
      "USER EDIT\n",
      "existing differing file preserved"
    );

    const forced = parseArgs(["--config-dir", configDir, "--force"], {});
    runInstall(forced, pkgRoot);
    assert.equal(
      readFileSync(path.join(configDir, "commands/budzie.toml"), "utf8"),
      'description = "main"\n',
      "--force overwrites"
    );
  });
});

test("planUninstall touches only manifest-recorded paths", async () => {
  await withFixture(async ({ pkgRoot, configDir }) => {
    const opts = parseArgs(["--config-dir", configDir], {});
    runInstall(opts, pkgRoot);
    writeFixtureFile(configDir, "commands/my-own.toml", "mine\n");

    const targets = planUninstall(opts).map((a) => a.target);
    assert.ok(!targets.includes("commands/my-own.toml"));
    assert.ok(targets.includes("commands/budzie.toml"));
  });
});

test("main --help prints usage and exits 0 without writing", async () => {
  await withFixture(async ({ configDir }) => {
    let out = "";
    const code = main(["--help", "--config-dir", configDir], {
      stdout: (s) => (out += s),
      stderr: () => {},
      env: {},
    });
    assert.equal(code, 0);
    assert.equal(out, HELP_TEXT);
    assert.match(out, /runtime and activation files/);
    assert.equal(exists(configDir), false);
  });
});

test("main dry-run writes nothing to disk", async () => {
  await withFixture(async ({ configDir }) => {
    let out = "";
    const code = main(["--dry-run", "--config-dir", configDir], {
      stdout: (s) => (out += s),
      stderr: () => {},
      env: {},
    });
    assert.equal(code, 0);
    assert.match(out, /Dry run: no changes written/);
    assert.equal(exists(configDir), false);
  });
});

test("CLI subprocess installs into an isolated config dir", async () => {
  await withFixture(async ({ configDir }) => {
    // Run the real bin against the repo's own commands/skills, but into a temp
    // config dir so nothing real is touched.
    const result = spawnSync(
      "node",
      [CLI, "--config-dir", configDir],
      { encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Install complete/);
    assert.ok(exists(path.join(configDir, ".budzie-manifest.json")));
    assert.ok(exists(path.join(configDir, "commands")));
    assert.ok(exists(path.join(configDir, "skills")));
    assert.ok(exists(path.join(configDir, "agents")));
  });
});
