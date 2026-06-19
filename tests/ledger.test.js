import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  LEDGER_VERSION,
  appendEntry,
  cumulativeTokens,
  formatCount,
  ledgerPath,
  readLedger,
  renderBadge,
  resolveConfigDir,
} from "../src/ledger.mjs";

const SCRIPT = fileURLToPath(new URL("../src/ledger.mjs", import.meta.url));

/**
 * Run `fn` with an isolated, throwaway config dir; clean up after. The ledger
 * is pointed at a temp dir via BUDZIE_DATA_DIR so the real ~/.config/budzie is
 * never touched.
 * @param {(env: NodeJS.ProcessEnv) => void} fn
 */
function withConfigDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "budzie-ledger-"));
  const env = { BUDZIE_DATA_DIR: dir };
  try {
    return fn(env);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("readLedger returns an empty versioned ledger when missing", () => {
  withConfigDir((env) => {
    const ledger = readLedger(env);
    assert.equal(ledger.version, LEDGER_VERSION);
    assert.deepEqual(ledger.entries, []);
    assert.equal(existsSync(ledgerPath(env)), false, "no file created by a read");
  });
});

test("appendEntry creates the file on first run and persists the entry", () => {
  withConfigDir((env) => {
    assert.equal(existsSync(ledgerPath(env)), false);
    appendEntry({ tokensSaved: 1200, linesAvoided: 30, depsAvoided: 2, costAvoided: 0.05 }, env);
    assert.equal(existsSync(ledgerPath(env)), true, "ledger file created");

    const ledger = readLedger(env);
    assert.equal(ledger.version, LEDGER_VERSION);
    assert.equal(ledger.entries.length, 1);
    const [entry] = ledger.entries;
    assert.equal(entry.tokensSaved, 1200);
    assert.equal(entry.linesAvoided, 30);
    assert.equal(entry.depsAvoided, 2);
    assert.equal(entry.costAvoided, 0.05);
    assert.equal(typeof entry.timestamp, "string");
    assert.ok(entry.timestamp.length > 0, "entry gets an ISO timestamp");
  });
});

test("appendEntry creates a private ledger file on POSIX", () => {
  if (process.platform === "win32") return;
  withConfigDir((env) => {
    appendEntry({ tokensSaved: 1 }, env);
    assert.equal(statSync(ledgerPath(env)).mode & 0o777, 0o600);
  });
});

test("appendEntry accumulates across sessions and defaults omitted fields to 0", () => {
  withConfigDir((env) => {
    appendEntry({ tokensSaved: 1000 }, env);
    appendEntry({ tokensSaved: 2400 }, env);
    const ledger = readLedger(env);
    assert.equal(ledger.entries.length, 2);
    assert.equal(ledger.entries[0].linesAvoided, 0);
    assert.equal(cumulativeTokens(ledger), 3400);
  });
});

test("readLedger degrades a corrupt file to an empty ledger without throwing", () => {
  withConfigDir((env) => {
    const file = ledgerPath(env);
    writeFileSync(file, "{ not json");
    const ledger = readLedger(env);
    assert.equal(ledger.version, LEDGER_VERSION);
    assert.deepEqual(ledger.entries, []);
  });
});

test("cumulativeTokens ignores non-numeric or negative token values", () => {
  // Deliberately malformed entries (cast away the type) to prove the reducer
  // coerces junk to 0 rather than producing NaN.
  const ledger = /** @type {import("../src/ledger.mjs").Ledger} */ ({
    version: LEDGER_VERSION,
    entries: [
      { timestamp: "", tokensSaved: 100 },
      { timestamp: "", tokensSaved: "oops" },
      { timestamp: "", tokensSaved: -50 },
      { timestamp: "", tokensSaved: 25 },
    ],
  });
  assert.equal(cumulativeTokens(ledger), 125);
});

test("formatCount applies k/M thresholds, one decimal, trimmed .0", () => {
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(950), "950");
  assert.equal(formatCount(999), "999");
  assert.equal(formatCount(1000), "1k");
  assert.equal(formatCount(12400), "12.4k");
  assert.equal(formatCount(12000), "12k");
  assert.equal(formatCount(999999), "1000k");
  assert.equal(formatCount(1_000_000), "1M");
  assert.equal(formatCount(2_300_000), "2.3M");
  assert.equal(formatCount(2_000_000), "2M");
});

test("renderBadge reads the ledger and prints [BUDZIE] <total>", () => {
  withConfigDir((env) => {
    assert.equal(renderBadge(env), "[BUDZIE] 0");
    appendEntry({ tokensSaved: 12400 }, env);
    assert.equal(renderBadge(env), "[BUDZIE] 12.4k");
  });
});

test("resolveConfigDir honors XDG_CONFIG_HOME, else ~/.config/budzie", () => {
  assert.equal(
    resolveConfigDir({ XDG_CONFIG_HOME: "/tmp/xdg-cfg" }),
    path.join("/tmp/xdg-cfg", "budzie")
  );
  assert.equal(
    resolveConfigDir({}),
    path.join(homedir(), ".config", "budzie")
  );
  assert.equal(
    resolveConfigDir(
      { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
      "win32",
      "C:\\Users\\me"
    ),
    "C:\\Users\\me\\AppData\\Local\\budzie"
  );
  assert.equal(
    resolveConfigDir(
      { XDG_CONFIG_HOME: "relative/config" },
      "linux",
      "/home/me"
    ),
    "/home/me/.config/budzie"
  );
});

test("CLI append then badge round-trips through the config dir", () => {
  withConfigDir((env) => {
    const merged = { ...process.env, ...env };
    execFileSync("node", [SCRIPT, "append", "--tokens", "12400"], { env: merged, encoding: "utf8" });
    const out = execFileSync("node", [SCRIPT, "badge"], { env: merged, encoding: "utf8" }).trim();
    assert.equal(out, "[BUDZIE] 12.4k");

    // A second append accumulates.
    execFileSync("node", [SCRIPT, "append", "--tokens=600"], { env: merged, encoding: "utf8" });
    const ledger = JSON.parse(readFileSync(ledgerPath(env), "utf8"));
    const total = execFileSync("node", [SCRIPT, "badge"], {
      env: merged,
      encoding: "utf8",
    }).trim();
    assert.equal(ledger.entries.length, 2);
    assert.equal(total, "[BUDZIE] 13k");
  });
});

test("CLI rejects an unknown command with a non-zero exit", () => {
  withConfigDir((env) => {
    assert.throws(() =>
      execFileSync("node", [SCRIPT, "frobnicate"], { env: { ...process.env, ...env } })
    );
  });
});
