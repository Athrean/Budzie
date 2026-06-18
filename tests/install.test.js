import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
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
  formatFiles,
  formatPlan,
  HELP_TEXT,
  main,
  parseArgs,
  planInstall,
  planUninstall,
  readManifest,
  resolveTargets,
  runInstall,
  runUninstall,
} from "../bin/budzie-install.mjs";
import {
  commandOnPath,
  detectHosts,
  hostById,
  HOST_MATRIX,
} from "../scripts/hosts.mjs";
import { flagPath, writeMode } from "../scripts/hooks/mode-tracker.mjs";

/** Absolute path to the CLI under test. */
const CLI = fileURLToPath(new URL("../bin/budzie-install.mjs", import.meta.url));

/**
 * Build a throwaway "package root" with the shipped adapter source files plus
 * an isolated install dir, then clean both up after `fn` runs. The fixture
 * mirrors the real package layout so the claude-plugin format resolves.
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
    writeFixtureFile(pkgRoot, "hooks/hooks.json", '{"hooks":{"SessionStart":[]}}\n');
    writeFixtureFile(pkgRoot, "hooks/codex.json", '{"hooks":{"SessionStart":[]}}\n');
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
    writeFixtureFile(
      pkgRoot,
      ".claude-plugin/plugin.json",
      '{"name":"budzie"}\n'
    );
    writeFixtureFile(
      pkgRoot,
      ".codex-plugin/plugin.json",
      '{"name":"budzie"}\n'
    );
    writeFixtureFile(
      pkgRoot,
      ".agents-plugin/plugin.json",
      '{"name":"budzie"}\n'
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

/**
 * Build a hermetic probe over a fake home + injected command/path lookups.
 * Detection never touches the real machine when given one of these.
 * @param {object} opts
 * @param {string} opts.home
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {Set<string>} [opts.commands] - Names that "exist on PATH".
 * @param {Set<string>} [opts.paths] - Absolute paths that "exist".
 * @param {NodeJS.Platform} [opts.platform]
 * @returns {import("../scripts/hosts.mjs").Probe}
 */
function fakeProbe({ home, env = {}, commands = new Set(), paths = new Set(), platform = "linux" }) {
  return {
    home,
    env,
    platform,
    commandExists: (name) => commands.has(name),
    pathExists: (abs) => paths.has(abs),
  };
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

test("parseArgs reads each flag", () => {
  const opts = parseArgs(
    ["--dry-run", "--force", "--uninstall", "--all", "--config-dir", "/tmp/x"],
    {}
  );
  assert.equal(opts.dryRun, true);
  assert.equal(opts.force, true);
  assert.equal(opts.uninstall, true);
  assert.equal(opts.all, true);
  assert.equal(opts.configDir, path.resolve("/tmp/x"));
});

test("parseArgs supports --config-dir=value, --host, and -h", () => {
  const opts = parseArgs(["--config-dir=/tmp/y", "--host=cursor", "--host", "zed", "-h"], {});
  assert.equal(opts.configDir, path.resolve("/tmp/y"));
  assert.deepEqual(opts.hostIds, ["cursor", "zed"]);
  assert.equal(opts.help, true);
});

test("parseArgs rejects unknown flags and missing values", () => {
  assert.throws(() => parseArgs(["--nope"], {}), /Unknown argument/);
  assert.throws(() => parseArgs(["--config-dir"], {}), /requires a path/);
  assert.throws(() => parseArgs(["--host"], {}), /requires a host id/);
});

// ---------------------------------------------------------------------------
// Hermetic host detection (matrix)
// ---------------------------------------------------------------------------

test("matrix covers 15+ hosts with valid format references", () => {
  assert.ok(HOST_MATRIX.length >= 15, `expected 15+ hosts, got ${HOST_MATRIX.length}`);
  const ids = HOST_MATRIX.map((h) => h.id);
  assert.equal(new Set(ids).size, ids.length, "host ids are unique");
  for (const host of HOST_MATRIX) {
    assert.ok(formatFiles(host.format), `${host.id} has a real format`);
  }
});

test("detectHosts finds nothing in an empty environment", () => {
  const probe = fakeProbe({ home: "/fake/home" });
  assert.deepEqual(detectHosts(probe), []);
});

test("detectHosts finds a CLI host via command-v probe", () => {
  const probe = fakeProbe({
    home: "/fake/home",
    commands: new Set(["claude"]),
  });
  const ids = detectHosts(probe).map((h) => h.id);
  assert.deepEqual(ids, ["claude-code"]);
});

test("detectHosts finds an editor via config-directory probe", () => {
  const probe = fakeProbe({
    home: "/fake/home",
    paths: new Set([path.join("/fake/home", ".cursor")]),
  });
  const ids = detectHosts(probe).map((h) => h.id);
  assert.ok(ids.includes("cursor"));
});

test("detectHosts finds VS Code via extension-dir probe", () => {
  const probe = fakeProbe({
    home: "/fake/home",
    paths: new Set([path.join("/fake/home", ".vscode", "extensions")]),
  });
  assert.ok(detectHosts(probe).some((h) => h.id === "vscode"));
});

test("detectHosts finds macOS app bundles only on darwin", () => {
  const paths = new Set(["/Applications/Claude.app"]);
  const linux = fakeProbe({ home: "/fake/home", paths, platform: "linux" });
  const darwin = fakeProbe({ home: "/fake/home", paths, platform: "darwin" });
  assert.ok(!detectHosts(linux).some((h) => h.id === "claude-desktop"));
  assert.ok(detectHosts(darwin).some((h) => h.id === "claude-desktop"));
});

test("detectHosts returns multiple hosts and resolves correct targets", () => {
  const home = "/fake/home";
  const probe = fakeProbe({
    home,
    commands: new Set(["claude", "codex"]),
    paths: new Set([path.join(home, ".cursor")]),
  });
  const opts = parseArgs([], {});
  const targets = resolveTargets(opts, probe);
  const byId = new Map(targets.map((t) => [t.id, t]));
  assert.equal(byId.get("claude-code")?.dir, path.join(home, ".claude"));
  assert.equal(byId.get("codex-cli")?.dir, path.join(home, ".codex"));
  assert.equal(byId.get("cursor")?.format, "rules-file");
});

test("CLAUDE_CONFIG_DIR/CODEX_HOME override host targets", () => {
  const probe = fakeProbe({
    home: "/fake/home",
    commands: new Set(["claude", "codex"]),
    env: { CLAUDE_CONFIG_DIR: "/custom/claude", CODEX_HOME: "/custom/codex" },
  });
  const targets = resolveTargets(parseArgs([], {}), probe);
  const byId = new Map(targets.map((t) => [t.id, t]));
  assert.equal(byId.get("claude-code")?.dir, path.resolve("/custom/claude"));
  assert.equal(byId.get("codex-cli")?.dir, path.resolve("/custom/codex"));
});

test("relative XDG_CONFIG_HOME falls back to an absolute home target", () => {
  const home = "/fake/home";
  const host = hostById("opencode");
  const probe = fakeProbe({
    home,
    env: { XDG_CONFIG_HOME: "relative/config" },
  });

  assert.equal(host?.target(probe), path.join(home, ".config", "opencode"));
});

test("Zed target matches the config path that triggered detection", () => {
  const home = "/fake/home";
  const xdg = path.join(home, ".config", "zed");
  const host = hostById("zed");
  const probe = fakeProbe({
    home,
    platform: "darwin",
    paths: new Set([xdg]),
  });

  assert.equal(host?.detect(probe), true);
  assert.equal(host?.target(probe), xdg);
});

test("commandOnPath ignores non-executable files on POSIX", () => {
  if (process.platform === "win32") return;
  const dir = mkdtempSync(path.join(tmpdir(), "budzie-path-"));
  const command = path.join(dir, "budzie-probe");
  try {
    writeFileSync(command, "#!/bin/sh\n");
    chmodSync(command, 0o644);
    assert.equal(commandOnPath("budzie-probe", { PATH: dir }), false);

    chmodSync(command, 0o755);
    assert.equal(commandOnPath("budzie-probe", { PATH: dir }), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveTargets honors --host even when not detected", () => {
  const probe = fakeProbe({ home: "/fake/home" });
  const opts = parseArgs(["--host", "cursor"], {});
  const targets = resolveTargets(opts, probe);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].id, "cursor");
});

test("resolveTargets rejects an unknown --host id", () => {
  const probe = fakeProbe({ home: "/fake/home" });
  assert.throws(
    () => resolveTargets(parseArgs(["--host", "nope"], {}), probe),
    /Unknown host id/
  );
});

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

test("dry-run writes nothing", async () => {
  await withFixture(async ({ pkgRoot, configDir }) => {
    const before = snapshot(configDir);
    const opts = parseArgs(["--dry-run", "--config-dir", configDir], {});
    const plans = planInstall(opts, { packageRoot: pkgRoot });

    const text = formatPlan(opts, plans);
    assert.match(text, /Install plan/);
    assert.ok(plans[0].actions.some((a) => a.kind === "copy"));

    const after = snapshot(configDir);
    assert.deepEqual([...after.keys()], [...before.keys()]);
    assert.equal(exists(configDir), false, "config dir not created by dry-run");
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

// ---------------------------------------------------------------------------
// Install (explicit config dir == claude-plugin format)
// ---------------------------------------------------------------------------

test("fresh install creates expected Budzie entries and a v2 manifest", async () => {
  await withFixture(async ({ pkgRoot, configDir }) => {
    const opts = parseArgs(["--config-dir", configDir], {});
    runInstall(opts, { packageRoot: pkgRoot });

    for (const rel of [
      "commands/budzie.toml",
      "commands/budzie-help.toml",
      "agents/budzie-reviewer.md",
      "skills/budzie/SKILL.md",
      "skills/budzie-reap/references/contracts.md",
      "hooks/hooks.json",
      "scripts/hooks/activate.mjs",
      "rules/budzie.mdc",
      ".claude-plugin/plugin.json",
    ]) {
      assert.ok(exists(path.join(configDir, rel)), `installed ${rel}`);
    }

    const manifest = JSON.parse(
      readFileSync(path.join(configDir, ".budzie-manifest.json"), "utf8")
    );
    assert.equal(manifest.version, 2);
    const entry = manifest.hosts["config-dir"];
    assert.equal(entry.format, "claude-plugin");
    const expected = formatFiles("claude-plugin", pkgRoot).map((f) => f.rel).sort();
    assert.deepEqual(entry.files.slice().sort(), expected);
  });
});

test("reinstall is idempotent (byte-identical, no churn, no dup manifest entries)", async () => {
  await withFixture(async ({ pkgRoot, configDir }) => {
    const opts = parseArgs(["--config-dir", configDir], {});
    runInstall(opts, { packageRoot: pkgRoot });
    const first = snapshot(configDir);

    const secondPlans = runInstall(opts, { packageRoot: pkgRoot });
    const second = snapshot(configDir);

    assert.deepEqual([...second.entries()], [...first.entries()]);
    assert.ok(
      secondPlans[0].actions.every((a) => a.kind === "skip"),
      "second install copies nothing"
    );

    const manifest = readManifest(configDir);
    const files = manifest.hosts["config-dir"].files;
    assert.equal(new Set(files).size, files.length, "no duplicated manifest entries");
  });
});

test("install does not clobber a differing existing file without --force", async () => {
  await withFixture(async ({ pkgRoot, configDir }) => {
    writeFixtureFile(configDir, "commands/budzie.toml", "USER EDIT\n");
    const opts = parseArgs(["--config-dir", configDir], {});
    runInstall(opts, { packageRoot: pkgRoot });

    assert.equal(
      readFileSync(path.join(configDir, "commands/budzie.toml"), "utf8"),
      "USER EDIT\n",
      "existing differing file preserved"
    );

    const forced = parseArgs(["--config-dir", configDir, "--force"], {});
    runInstall(forced, { packageRoot: pkgRoot });
    assert.equal(
      readFileSync(path.join(configDir, "commands/budzie.toml"), "utf8"),
      'description = "main"\n',
      "--force overwrites"
    );
  });
});

// ---------------------------------------------------------------------------
// Multi-host install via detection
// ---------------------------------------------------------------------------

test("detected install lands the right format in each host dir", async () => {
  await withFixture(async ({ pkgRoot }) => {
    const home = mkdtempSync(path.join(tmpdir(), "budzie-home-"));
    try {
      const probe = fakeProbe({
        home,
        commands: new Set(["claude"]),
        paths: new Set([path.join(home, ".cursor")]),
      });
      const opts = parseArgs([], {});
      runInstall(opts, { probe, packageRoot: pkgRoot });

      // Claude host (claude-plugin): full runtime present.
      assert.ok(exists(path.join(home, ".claude", "skills/budzie/SKILL.md")));
      assert.ok(exists(path.join(home, ".claude", ".claude-plugin/plugin.json")));
      assert.ok(exists(path.join(home, ".claude", ".budzie-manifest.json")));

      // Cursor host (rules-file): only the rules file, no runtime dirs.
      assert.ok(exists(path.join(home, ".cursor", "rules/budzie.mdc")));
      assert.equal(exists(path.join(home, ".cursor", "skills")), false);
      assert.equal(exists(path.join(home, ".cursor", "commands")), false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Uninstall (data-loss boundary)
// ---------------------------------------------------------------------------

test("uninstall removes only Budzie entries and preserves user files", async () => {
  await withFixture(async ({ pkgRoot, configDir }) => {
    const opts = parseArgs(["--config-dir", configDir], {});
    runInstall(opts, { packageRoot: pkgRoot });

    writeFixtureFile(configDir, "commands/my-own.toml", "mine\n");
    writeFixtureFile(configDir, "settings.json", "{}\n");

    runUninstall(opts, {
      env: { BUDZIE_DATA_DIR: path.join(path.dirname(configDir), "data") },
    });

    assert.equal(exists(path.join(configDir, "commands/budzie.toml")), false);
    assert.equal(exists(path.join(configDir, "agents/budzie-reviewer.md")), false);
    assert.equal(exists(path.join(configDir, "skills/budzie")), false);
    assert.equal(
      exists(path.join(configDir, ".budzie-manifest.json")),
      false,
      "manifest removed"
    );

    assert.equal(
      readFileSync(path.join(configDir, "commands/my-own.toml"), "utf8"),
      "mine\n"
    );
    assert.equal(
      readFileSync(path.join(configDir, "settings.json"), "utf8"),
      "{}\n"
    );
    assert.ok(exists(path.join(configDir, "commands")));
  });
});

test("uninstall removes the activation flag but preserves neighboring files", async () => {
  await withFixture(async ({ pkgRoot, configDir }) => {
    const opts = parseArgs(["--config-dir", configDir], {});
    const env = { BUDZIE_DATA_DIR: path.join(path.dirname(configDir), "data") };
    runInstall(opts, { packageRoot: pkgRoot });
    writeMode(true, env);
    writeFixtureFile(configDir, "hooks/user.json", '{"hooks":{}}\n');
    writeFixtureFile(path.dirname(flagPath(env)), "ledger.json", '{"sessions":[]}\n');

    runUninstall(opts, { env });

    assert.equal(exists(path.join(configDir, "hooks/hooks.json")), false);
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

test("uninstall preserves a user file that install skipped (not in manifest)", async () => {
  await withFixture(async ({ pkgRoot, configDir }) => {
    writeFixtureFile(configDir, "commands/budzie.toml", "USER EDIT\n");
    const opts = parseArgs(["--config-dir", configDir], {});
    runInstall(opts, { packageRoot: pkgRoot });

    const manifest = readManifest(configDir);
    assert.ok(
      !manifest.hosts["config-dir"].files.includes("commands/budzie.toml"),
      "user-authored skip is not in the manifest"
    );

    runUninstall(opts, {
      env: { BUDZIE_DATA_DIR: path.join(path.dirname(configDir), "data") },
    });

    assert.equal(
      readFileSync(path.join(configDir, "commands/budzie.toml"), "utf8"),
      "USER EDIT\n",
      "user-authored file survives install + uninstall"
    );
  });
});

test("planUninstall touches only manifest-recorded paths", async () => {
  await withFixture(async ({ pkgRoot, configDir }) => {
    const opts = parseArgs(["--config-dir", configDir], {});
    runInstall(opts, { packageRoot: pkgRoot });
    writeFixtureFile(configDir, "commands/my-own.toml", "mine\n");

    const targets = planUninstall(opts)[0].actions.map((a) => a.target);
    assert.ok(!targets.includes("commands/my-own.toml"));
    assert.ok(targets.includes("commands/budzie.toml"));
  });
});

// ---------------------------------------------------------------------------
// Manifest versioning / back-compat
// ---------------------------------------------------------------------------

test("readManifest upgrades a v1 manifest to v2 in memory", async () => {
  await withFixture(async ({ configDir }) => {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      path.join(configDir, ".budzie-manifest.json"),
      JSON.stringify({ version: 1, files: ["skills/budzie/SKILL.md"] }, null, 2)
    );
    const manifest = readManifest(configDir);
    assert.equal(manifest.version, 2);
    assert.deepEqual(manifest.hosts["config-dir"].files, ["skills/budzie/SKILL.md"]);
    assert.equal(manifest.hosts["config-dir"].target, configDir);
  });
});

test("uninstall cleans an old v1-shaped manifest install", async () => {
  await withFixture(async ({ pkgRoot, configDir }) => {
    // Simulate a legacy install: copy files, then write a v1 manifest by hand.
    const opts = parseArgs(["--config-dir", configDir], {});
    runInstall(opts, { packageRoot: pkgRoot });
    const owned = formatFiles("claude-plugin", pkgRoot).map((f) => f.rel);
    writeFileSync(
      path.join(configDir, ".budzie-manifest.json"),
      JSON.stringify({ version: 1, files: owned }, null, 2)
    );

    runUninstall(opts, {
      env: { BUDZIE_DATA_DIR: path.join(path.dirname(configDir), "data") },
    });
    assert.equal(exists(path.join(configDir, "skills/budzie/SKILL.md")), false);
    assert.equal(exists(path.join(configDir, ".budzie-manifest.json")), false);
  });
});

// ---------------------------------------------------------------------------
// CLI surface
// ---------------------------------------------------------------------------

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
    assert.match(out, /detect agent hosts/);
    assert.equal(exists(configDir), false);
  });
});

test("CLI subprocess installs into an isolated config dir", async () => {
  await withFixture(async ({ configDir }) => {
    const result = spawnSync("node", [CLI, "--config-dir", configDir], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Install complete/);
    assert.ok(exists(path.join(configDir, ".budzie-manifest.json")));
    assert.ok(exists(path.join(configDir, "skills")));
    assert.ok(exists(path.join(configDir, "agents")));
  });
});
