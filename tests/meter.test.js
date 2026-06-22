// @ts-check
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  encodeProjectDir,
  transcriptsRoot,
  findTranscript,
  meter,
  renderMeterBadge,
  renderMeter,
} from "../src/meter.mjs";

/**
 * @param {(root: string) => void} fn
 */
function withTemp(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "budzie-meter-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Write a JSONL transcript with one counted assistant turn.
 * @param {string} file
 * @param {number} input
 * @param {number} output
 */
function writeTranscript(file, input, output) {
  const lines = [
    JSON.stringify({ role: "user", content: "hi" }),
    JSON.stringify({ role: "assistant", content: "ok", usage: { input_tokens: input, output_tokens: output } }),
  ];
  writeFileSync(file, lines.join("\n") + "\n");
}

test("encodeProjectDir matches Claude Code's slash/dot encoding", () => {
  assert.equal(encodeProjectDir("/Users/x/Desktop/budzie"), "-Users-x-Desktop-budzie");
  assert.equal(encodeProjectDir("/a/my.app"), "-a-my-app");
});

test("transcriptsRoot honours CLAUDE_CONFIG_DIR, else ~/.claude/projects", () => {
  assert.equal(
    transcriptsRoot({ CLAUDE_CONFIG_DIR: "/cfg" }, "/home/u"),
    path.join("/cfg", "projects")
  );
  assert.equal(transcriptsRoot({}, "/home/u"), path.join("/home/u", ".claude", "projects"));
});

test("findTranscript prefers an explicit path that exists", () => {
  withTemp((root) => {
    const file = path.join(root, "explicit.jsonl");
    writeTranscript(file, 10, 5);
    assert.equal(findTranscript({ explicit: file }), file);
    // A non-existent explicit path falls through, not used blindly.
    assert.equal(findTranscript({ explicit: path.join(root, "nope.jsonl"), cwd: "/x", env: { CLAUDE_CONFIG_DIR: root }, home: root }), null);
  });
});

test("findTranscript auto-discovers the newest jsonl in the project dir", () => {
  withTemp((base) => {
    const cwd = "/proj/demo";
    const dir = path.join(base, "projects", encodeProjectDir(cwd));
    mkdirSync(dir, { recursive: true });
    const older = path.join(dir, "older.jsonl");
    const newer = path.join(dir, "newer.jsonl");
    writeTranscript(older, 1, 1);
    writeTranscript(newer, 2, 2);
    // Force a clear mtime ordering: older is one hour behind.
    utimesSync(older, new Date(1_000_000), new Date(1_000_000));
    utimesSync(newer, new Date(2_000_000), new Date(2_000_000));

    const found = findTranscript({ cwd, env: { CLAUDE_CONFIG_DIR: base }, home: base });
    assert.equal(found, newer);
  });
});

test("findTranscript returns null when no project transcript dir exists", () => {
  withTemp((base) => {
    assert.equal(findTranscript({ cwd: "/no/such", env: { CLAUDE_CONFIG_DIR: base }, home: base }), null);
  });
});

test("meter reports real counted input/output tokens from the transcript", () => {
  withTemp((root) => {
    const file = path.join(root, "s.jsonl");
    writeTranscript(file, 80, 20);
    const result = meter({ explicit: file });
    assert.equal(result.transcript, file);
    assert.equal(result.usage?.tokensSource, "counted");
    assert.equal(result.usage?.inputTokens, 80);
    assert.equal(result.usage?.outputTokens, 20);
    assert.equal(result.usage?.totalTokens, 100);
  });
});

test("renderMeterBadge shows counted figures and stays empty when unknown", () => {
  withTemp((root) => {
    const file = path.join(root, "s.jsonl");
    writeTranscript(file, 18000, 3200);
    assert.equal(renderMeterBadge(meter({ explicit: file })), "session 3.2k out / 18k in");
    // No transcript -> no fabricated number.
    assert.equal(renderMeterBadge({ transcript: null, usage: null }), "");
  });
});

test("renderMeter notes a missing transcript without inventing numbers", () => {
  assert.match(renderMeter({ transcript: null, usage: null }), /no session transcript found/);
});
