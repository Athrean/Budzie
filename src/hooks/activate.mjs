// @ts-check
import { fileURLToPath } from "node:url";

import { writeMode } from "./mode-tracker.mjs";

/**
 * Budzie ruleset injected as hidden context on session start. Mirrors the
 * budzie skill: smallest-correct-code discipline plus a visible meter.
 */
const RULESET = [
  "Budzie mode is active: code less, spend less, watch the meter.",
  "",
  "Ladder (stop at the first rung that works):",
  "1. Does this need to exist? If not, skip it.",
  "2. Stdlib does it? Use it.",
  "3. Native platform does it? Use it.",
  "4. Existing dependency does it? Use it.",
  "5. One line works? Use one line.",
  "6. Only then: minimum custom code.",
  "",
  "Meter: mark deliberate shortcuts with `// budzie:` comments naming the",
  "ceiling plus the upgrade trigger. Receipts count real local markers first;",
  "estimates must be labelled ESTIMATE.",
  "",
  "Budget: respect the local ceiling in .budzie/budget.json. Warn or stop when",
  "an estimate exceeds the allowance.",
  "",
  "Boundaries: no telemetry, no backend, no new dependency unless stdlib,",
  "native, and existing deps all fail. Never remove security, trust-boundary",
  "validation, data-loss handling, or accessibility basics.",
].join("\n");

/**
 * Emit the SessionStart hook payload Claude Code reads from stdout. The ruleset
 * lands in the model context via `hookSpecificOutput.additionalContext`.
 * @returns {string}
 */
export function renderPayload() {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: RULESET,
    },
  });
}

/**
 * SessionStart entry point. Records activation locally, then prints the
 * ruleset payload. Any filesystem error is swallowed so the hook never blocks
 * session start — the context is still emitted.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function activate(env = process.env) {
  try {
    writeMode(true, env);
  } catch {
    // Silent-fail: activation tracking is best-effort, context still ships.
  }
  return renderPayload();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Drain stdin (Claude Code pipes hook JSON) but do not require it.
  process.stdin.resume();
  process.stdin.on("data", () => {});
  process.stdout.write(activate());
}
