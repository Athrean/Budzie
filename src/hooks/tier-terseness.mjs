// @ts-check
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { classifyTier, tersenessFor } from "../model-tier.mjs";

/**
 * Claude Code `UserPromptSubmit` hook. Reads the active model from the session
 * transcript, classifies its budget tier, and injects a tier-scaled terseness
 * instruction as hidden context. Expensive models compress hardest; cheap or
 * unknown models inject nothing.
 *
 * Claude Code only: other hosts pass no transcript with model lines, so every
 * step degrades to a clean no-op. The hook never throws — it must not block a
 * prompt.
 */

/**
 * Read the most recent real model id from a Claude Code transcript (JSONL,
 * one record per line, model recorded per assistant turn). Returns `null` when
 * the path is missing, unreadable, or carries no usable model.
 *
 * budzie: reads the whole transcript then reverse-scans for the last model;
 * upgrade to a bounded tail read if large transcripts push the hook past its
 * timeout.
 * @param {unknown} transcriptPath
 * @returns {string | null}
 */
export function readModelFromTranscript(transcriptPath) {
  if (typeof transcriptPath !== "string" || transcriptPath.trim() === "") return null;
  let raw;
  try {
    raw = readFileSync(transcriptPath, "utf8");
  } catch {
    return null;
  }
  const lines = raw.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const model = record?.message?.model ?? record?.model;
    if (typeof model === "string" && model && model !== "<synthetic>") return model;
  }
  return null;
}

/**
 * Build the terseness instruction for the session behind `transcriptPath`, or
 * `null` when the tier warrants no injection.
 * @param {unknown} transcriptPath
 * @returns {string | null}
 */
export function buildContext(transcriptPath) {
  return tersenessFor(classifyTier(readModelFromTranscript(transcriptPath)));
}

/**
 * Render the hook stdout payload. An instruction becomes a UserPromptSubmit
 * `additionalContext` payload; `null` becomes empty output (no context added).
 * @param {string | null} instruction
 * @returns {string}
 */
export function renderPayload(instruction) {
  if (!instruction) return "";
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: instruction,
    },
  });
}

/**
 * Hook entry point: parse the stdin payload, resolve the context, render it.
 * Any parse or read error degrades to empty output so the prompt is never
 * blocked.
 * @param {string} stdinRaw - Raw stdin Claude Code pipes to the hook.
 * @returns {string}
 */
export function main(stdinRaw) {
  try {
    const parsed = stdinRaw && stdinRaw.trim() ? JSON.parse(stdinRaw) : {};
    const transcriptPath =
      parsed && typeof parsed === "object" ? parsed.transcript_path : undefined;
    return renderPayload(buildContext(transcriptPath));
  } catch {
    return "";
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let out = "";
  try {
    out = main(readFileSync(0, "utf8"));
  } catch {
    // Last-resort guard: a hook error must never surface to the user.
    out = "";
  }
  if (out) process.stdout.write(out);
}
