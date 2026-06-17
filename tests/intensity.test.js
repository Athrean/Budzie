import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readLevel, writeLevel, shouldAutoClarify, DEFAULT_LEVEL } from "../scripts/intensity.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/intensity.mjs", import.meta.url));

/**
 * Run `fn` with an isolated, throwaway data dir; clean up after.
 * @param {(env: NodeJS.ProcessEnv) => void} fn
 */
function withDataDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "budzie-intensity-"));
  const env = { BUDZIE_DATA_DIR: dir };
  try {
    return fn(env);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("writeLevel then readLevel round-trips the chosen level", () => {
  withDataDir((env) => {
    writeLevel("ultra", env);
    assert.equal(readLevel(env), "ultra");
  });
});

test("readLevel returns the default when nothing is set", () => {
  withDataDir((env) => {
    assert.equal(readLevel(env), DEFAULT_LEVEL);
    assert.equal(DEFAULT_LEVEL, "medium");
  });
});

test("readLevel persists until changed, ignoring an interleaved bad write", () => {
  withDataDir((env) => {
    writeLevel("low", env);
    assert.throws(() => writeLevel("turbo", env), /invalid intensity level/);
    assert.equal(readLevel(env), "low");
  });
});

test("shouldAutoClarify fires on destructive SQL and shell", () => {
  assert.equal(shouldAutoClarify("Run DROP TABLE users; to clear it"), true);
  assert.equal(shouldAutoClarify("just rm -rf / to clean up"), true);
  assert.equal(shouldAutoClarify("TRUNCATE TABLE sessions"), true);
  assert.equal(shouldAutoClarify("git push --force to main"), true);
});

test("shouldAutoClarify stays off for benign prose", () => {
  assert.equal(shouldAutoClarify("Add a helper that formats the date"), false);
  assert.equal(shouldAutoClarify("Explain how React re-renders"), false);
});

test("shouldAutoClarify fires on conditional multi-step sequences", () => {
  const steps = "1. stop the service\n2. if the backup exists then restore it\n3. otherwise reinitialize the db";
  assert.equal(shouldAutoClarify(steps), true);
});

test("CLI set then get round-trips through the data dir", () => {
  withDataDir((env) => {
    const merged = { ...process.env, ...env };
    execFileSync("node", [SCRIPT, "set", "xhigh"], { env: merged, encoding: "utf8" });
    const out = execFileSync("node", [SCRIPT, "get"], { env: merged, encoding: "utf8" }).trim();
    assert.equal(out, "xhigh");
  });
});

test("CLI rejects an invalid level with a non-zero exit", () => {
  withDataDir((env) => {
    assert.throws(() =>
      execFileSync("node", [SCRIPT, "set", "turbo"], { env: { ...process.env, ...env } })
    );
  });
});
