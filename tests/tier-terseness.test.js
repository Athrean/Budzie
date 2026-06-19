// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  readModelFromTranscript,
  buildContext,
  renderPayload,
  main,
} from "../src/hooks/tier-terseness.mjs";

const HOOK = fileURLToPath(new URL("../src/hooks/tier-terseness.mjs", import.meta.url));

/**
 * Write `lines` as a JSONL transcript in a throwaway dir, run `fn` with its
 * path, then clean up.
 * @param {object[]} records
 * @param {(transcriptPath: string) => void} fn
 */
function withTranscript(records, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "budzie-tier-"));
  const file = path.join(dir, "transcript.jsonl");
  writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  try {
    fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("readModelFromTranscript returns the last real model, skipping synthetic", () => {
  withTranscript(
    [
      { type: "assistant", message: { model: "claude-haiku-4-5" } },
      { type: "assistant", message: { model: "<synthetic>" } },
      { type: "assistant", message: { model: "claude-opus-4-8" } },
      { type: "user", message: { role: "user" } },
    ],
    (file) => {
      assert.equal(readModelFromTranscript(file), "claude-opus-4-8");
    }
  );
});

test("readModelFromTranscript reads a top-level model field too", () => {
  withTranscript([{ model: "claude-sonnet-4-6" }], (file) => {
    assert.equal(readModelFromTranscript(file), "claude-sonnet-4-6");
  });
});

test("readModelFromTranscript skips garbage lines without throwing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "budzie-tier-"));
  const file = path.join(dir, "t.jsonl");
  writeFileSync(file, 'not json\n{"message":{"model":"opus"}}\n{bad\n');
  try {
    assert.equal(readModelFromTranscript(file), "opus");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readModelFromTranscript returns null for missing, empty, or modelless input", () => {
  assert.equal(readModelFromTranscript("/no/such/transcript.jsonl"), null);
  assert.equal(readModelFromTranscript(""), null);
  assert.equal(readModelFromTranscript(undefined), null);
  withTranscript([{ type: "user", message: { role: "user" } }], (file) => {
    assert.equal(readModelFromTranscript(file), null);
  });
});

test("buildContext yields a top instruction for an opus transcript", () => {
  withTranscript([{ message: { model: "claude-opus-4-8" } }], (file) => {
    const ctx = buildContext(file);
    assert.ok(ctx && /maximize savings/i.test(ctx));
    assert.match(/** @type {string} */ (ctx), /full and clear/i);
  });
});

test("buildContext is a no-op for cheap or unknown models", () => {
  withTranscript([{ message: { model: "claude-haiku-4-5" } }], (file) => {
    assert.equal(buildContext(file), null);
  });
  withTranscript([{ message: { model: "mystery-model" } }], (file) => {
    assert.equal(buildContext(file), null);
  });
});

test("renderPayload wraps an instruction as UserPromptSubmit context, null as empty", () => {
  const payload = renderPayload("be terse");
  const parsed = JSON.parse(payload);
  assert.equal(parsed.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.equal(parsed.hookSpecificOutput.additionalContext, "be terse");
  assert.equal(renderPayload(null), "");
});

test("main emits a payload for opus and nothing for haiku / missing / bad input", () => {
  withTranscript([{ message: { model: "claude-opus-4-8" } }], (file) => {
    const out = main(JSON.stringify({ transcript_path: file }));
    assert.match(out, /UserPromptSubmit/);
    assert.match(out, /maximize savings/i);
  });
  withTranscript([{ message: { model: "claude-haiku-4-5" } }], (file) => {
    assert.equal(main(JSON.stringify({ transcript_path: file })), "");
  });
  assert.equal(main(JSON.stringify({ prompt: "hi" })), ""); // no transcript_path
  assert.equal(main("not json"), "");
  assert.equal(main(""), "");
});

test("the hook process never blocks: exit 0, empty stdout on a haiku session", () => {
  withTranscript([{ message: { model: "claude-haiku-4-5" } }], (file) => {
    const res = spawnSync("node", [HOOK], {
      input: JSON.stringify({ transcript_path: file }),
      encoding: "utf8",
    });
    assert.equal(res.status, 0);
    assert.equal(res.stdout, "");
  });
});

test("the hook process injects top-tier context for an opus session", () => {
  withTranscript([{ message: { model: "claude-opus-4-8" } }], (file) => {
    const res = spawnSync("node", [HOOK], {
      input: JSON.stringify({ transcript_path: file }),
      encoding: "utf8",
    });
    assert.equal(res.status, 0);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.hookSpecificOutput.hookEventName, "UserPromptSubmit");
    assert.match(parsed.hookSpecificOutput.additionalContext, /maximize savings/i);
  });
});
