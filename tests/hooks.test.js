import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  resolveDataDir,
  flagPath,
  readMode,
  writeMode,
} from "../scripts/hooks/mode-tracker.mjs";

/** Absolute paths to the hook scripts under test. */
const ACTIVATE = fileURLToPath(new URL("../scripts/hooks/activate.mjs", import.meta.url));
const STATUS = fileURLToPath(new URL("../scripts/hooks/status.mjs", import.meta.url));

/** Env keys that influence host data dir + budget resolution. */
const ENV_KEYS = [
  "BUDZIE_DATA_DIR",
  "XDG_DATA_HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "HOME",
  "USERPROFILE",
  "BUDZIE_BUDGET_CEILING",
  "BUDZIE_BUDGET_UNIT",
  "BUDZIE_BUDGET_WARN_AT",
  "BUDZIE_BUDGET_MODE",
  "BUDZIE_BUDGET_CONFIG",
];

/**
 * Create a throwaway directory tree and clean it up after `fn` runs.
 * @param {(ctx: { root: string, dataDir: string }) => Promise<void> | void} fn
 */
async function withTree(fn) {
  const base = mkdtempSync(path.join(tmpdir(), "budzie-hooks-"));
  const root = path.join(base, "repo");
  const dataDir = path.join(base, "data");
  mkdirSync(root, { recursive: true });
  try {
    await fn({ root, dataDir });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/**
 * Build an environment with hook + budget overrides cleared unless supplied.
 * @param {Record<string, string>} [extra]
 * @returns {NodeJS.ProcessEnv}
 */
function testEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of ENV_KEYS) delete env[key];
  return { ...env, ...extra };
}

/**
 * Run a hook script and capture stdout.
 * @param {string} script
 * @param {string} root
 * @param {Record<string, string>} env
 * @param {string} [stdin]
 * @returns {string}
 */
function runHook(script, root, env, stdin = "") {
  return execFileSync("node", [script], {
    cwd: root,
    encoding: "utf8",
    env: testEnv(env),
    input: stdin,
  });
}

test("resolveDataDir prefers BUDZIE_DATA_DIR over host defaults", () => {
  const env = { BUDZIE_DATA_DIR: "/tmp/explicit", XDG_DATA_HOME: "/tmp/xdg" };
  assert.equal(resolveDataDir(env), path.resolve("/tmp/explicit"));
});

test("resolveDataDir falls back to XDG_DATA_HOME then HOME on posix", () => {
  const xdg = resolveDataDir({ XDG_DATA_HOME: "/tmp/xdg" });
  assert.equal(xdg, path.join("/tmp/xdg", "budzie"));

  const home = resolveDataDir({ HOME: "/tmp/home" });
  assert.equal(home, path.join("/tmp/home", ".local", "share", "budzie"));
});

test("flagPath lives under the resolved data dir", () => {
  const dir = "/tmp/explicit";
  assert.equal(flagPath({ BUDZIE_DATA_DIR: dir }), path.join(path.resolve(dir), "mode.json"));
});

test("mode tracker records activation and deactivation locally", async () => {
  await withTree(({ dataDir }) => {
    const env = { BUDZIE_DATA_DIR: dataDir };
    assert.equal(readMode(env).active, false);

    const onState = writeMode(true, env);
    assert.equal(onState.active, true);
    assert.equal(typeof onState.updatedAt, "string");
    assert.ok(existsSync(flagPath(env)));
    assert.equal(readMode(env).active, true);

    const offState = writeMode(false, env);
    assert.equal(offState.active, false);
    assert.equal(readMode(env).active, false);
  });
});

test("SessionStart hook writes the activation flag and emits the ruleset as context", async () => {
  await withTree(({ root, dataDir }) => {
    const env = { BUDZIE_DATA_DIR: dataDir };
    const out = runHook(ACTIVATE, root, env, JSON.stringify({ hook_event_name: "SessionStart" }));

    const parsed = JSON.parse(out);
    assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart");
    const context = parsed.hookSpecificOutput.additionalContext;
    assert.match(context, /Budzie/);
    assert.match(context, /budget/i);

    const state = JSON.parse(readFileSync(flagPath(env), "utf8"));
    assert.equal(state.active, true);
  });
});

test("every native-hook adapter activates Budzie through its declared SessionStart hook", async () => {
  const adapters = [
    [".claude-plugin/plugin.json", "CLAUDE_PLUGIN_ROOT"],
    [".codex-plugin/plugin.json", "PLUGIN_ROOT"],
  ];

  for (const [manifestPath, rootEnv] of adapters) {
    await withTree(({ root, dataDir }) => {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const hookPath = path.resolve(manifest.hooks);
      const hookConfig = JSON.parse(readFileSync(hookPath, "utf8"));
      const handler = hookConfig.hooks.SessionStart[0].hooks[0];
      const env = testEnv({ BUDZIE_DATA_DIR: dataDir });
      delete env.CLAUDE_PLUGIN_ROOT;
      delete env.PLUGIN_ROOT;
      env[rootEnv] = process.cwd();

      const result = spawnSync(handler.command, {
        cwd: root,
        encoding: "utf8",
        env,
        input: JSON.stringify({
          hook_event_name: "SessionStart",
          source: "startup",
        }),
        shell: true,
      });

      assert.equal(result.status, 0, `${manifestPath}: ${result.stderr}`);
      const payload = JSON.parse(result.stdout);
      assert.equal(
        payload.hookSpecificOutput.hookEventName,
        "SessionStart",
        manifestPath
      );
      assert.match(
        payload.hookSpecificOutput.additionalContext,
        /Budzie mode is active/,
        manifestPath
      );
      assert.equal(readMode({ BUDZIE_DATA_DIR: dataDir }).active, true, manifestPath);
    });
  }
});

test("native SessionStart hooks reactivate after every context reset source", () => {
  for (const manifestPath of [
    ".claude-plugin/plugin.json",
    ".codex-plugin/plugin.json",
  ]) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const hookConfig = JSON.parse(readFileSync(path.resolve(manifest.hooks), "utf8"));
    const sources = hookConfig.hooks.SessionStart[0].matcher.split("|").sort();

    assert.deepEqual(
      sources,
      ["clear", "compact", "resume", "startup"],
      manifestPath
    );
  }
});

test("generic adapter activates Budzie through an always-applied rule", () => {
  const manifest = JSON.parse(
    readFileSync(".agents-plugin/plugin.json", "utf8")
  );

  assert.equal(manifest.hooks, undefined);
  assert.equal(manifest.rules, "./rules/");
  const rule = readFileSync(path.join(manifest.rules, "budzie.mdc"), "utf8");
  assert.match(rule, /^---\n[\s\S]*alwaysApply: true\n[\s\S]*---\n/);
  assert.match(rule, /Budzie mode is active/);
  assert.match(rule, /`budzie` skill/i);
});

test("SessionStart hook silent-fails on a bad data dir without throwing", async () => {
  await withTree(({ root }) => {
    // Point the data dir at a path whose parent is a file: mkdir must fail.
    const blocker = path.join(root, "blocker");
    writeFileSync(blocker, "x");
    const env = { BUDZIE_DATA_DIR: path.join(blocker, "nested") };

    const out = runHook(ACTIVATE, root, env, "");
    // Still emits valid JSON context; never blocks the session.
    const parsed = JSON.parse(out);
    assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(parsed.hookSpecificOutput.additionalContext, /Budzie/);
  });
});

test("status output reflects active mode and budget state when a budget file is present", async () => {
  await withTree(({ root, dataDir }) => {
    const env = { BUDZIE_DATA_DIR: dataDir };
    // Activate, then write a budget config the way budget.mjs does.
    writeMode(true, env);
    mkdirSync(path.join(root, ".budzie"), { recursive: true });
    writeFileSync(
      path.join(root, ".budzie", "budget.json"),
      JSON.stringify({ ceiling: 1000, unit: "tokens", warnAt: 0.8, mode: "warn" }) + "\n"
    );

    const out = runHook(STATUS, root, env, "").trim();
    assert.match(out, /Budzie/);
    assert.match(out, /on/i);
    assert.match(out, /1000 tokens/);
  });
});

test("status degrades gracefully when no budget file is present", async () => {
  await withTree(({ root, dataDir }) => {
    const env = { BUDZIE_DATA_DIR: dataDir };
    const out = runHook(STATUS, root, env, "").trim();
    assert.match(out, /Budzie/);
    // Inactive + no budget: still a clean single line, no crash.
    assert.match(out, /off/i);
    assert.match(out, /no budget/i);
    assert.equal(out.includes("\n"), false);
  });
});

test("status reads the cwd from statusline stdin JSON when provided", async () => {
  await withTree(({ root, dataDir }) => {
    const env = { BUDZIE_DATA_DIR: dataDir };
    const projectDir = path.join(root, "project");
    mkdirSync(path.join(projectDir, ".budzie"), { recursive: true });
    writeFileSync(
      path.join(projectDir, ".budzie", "budget.json"),
      JSON.stringify({ ceiling: 42, unit: "usd", warnAt: 0.8, mode: "stop" }) + "\n"
    );

    // Run from root, but tell the statusline our cwd is projectDir via stdin.
    const out = runHook(STATUS, root, env, JSON.stringify({ cwd: projectDir })).trim();
    assert.match(out, /42 usd/);
  });
});

test("status never throws on malformed stdin", async () => {
  await withTree(({ root, dataDir }) => {
    const env = { BUDZIE_DATA_DIR: dataDir };
    const out = runHook(STATUS, root, env, "{ not json").trim();
    assert.match(out, /Budzie/);
  });
});

test("hooks manifest declares a SessionStart command and a statusLine", () => {
  const manifest = JSON.parse(readFileSync("hooks/hooks.json", "utf8"));

  assert.ok(Array.isArray(manifest.hooks.SessionStart));
  const inner = manifest.hooks.SessionStart[0].hooks[0];
  assert.equal(inner.type, "command");
  assert.match(inner.command, /scripts\/hooks\/activate\.mjs/);
  assert.equal(typeof inner.timeout, "number");

  assert.equal(manifest.statusLine.type, "command");
  assert.match(manifest.statusLine.command, /statusline/);
});

test("Claude adapter registers the status-line hook file", () => {
  const plugin = JSON.parse(readFileSync(".claude-plugin/plugin.json", "utf8"));
  assert.equal(plugin.hooks, "./hooks/hooks.json");
});

test("both posix and powershell statusline wrappers exist and call the node script", () => {
  const sh = readFileSync("hooks/statusline.sh", "utf8");
  const ps1 = readFileSync("hooks/statusline.ps1", "utf8");

  for (const text of [sh, ps1]) {
    assert.match(text, /scripts\/hooks\/status\.mjs/);
  }
});
