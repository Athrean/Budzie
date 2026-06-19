// @ts-check
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { compressMarkdown } from "../src/compress.mjs";

/**
 * @typedef {import("../src/intensity.mjs").Level} Level
 */

/**
 * @typedef {object} MultilingualTask
 * @property {string} id
 * @property {"es" | "pt" | "fr"} language
 * @property {Level} level
 * @property {string} input
 * @property {string} expected
 * @property {string[]} languageMarkers
 * @property {string[]} forbiddenMarkers
 * @property {string[]} preservedSpans
 */

/**
 * @typedef {object} MultilingualRun
 * @property {string} id
 * @property {"es" | "pt" | "fr"} language
 * @property {Level} level
 * @property {string} output
 * @property {string} expected
 * @property {number} bytesBefore
 * @property {number} bytesAfter
 * @property {boolean} sameLanguage
 * @property {boolean} preserved
 * @property {boolean} passed
 */

const FIXTURE = fileURLToPath(
  new URL("./fixtures/multilingual-compression.json", import.meta.url)
);

/** @type {readonly MultilingualTask[]} */
export const MULTILINGUAL_TASKS = Object.freeze(JSON.parse(readFileSync(FIXTURE, "utf8")));

/**
 * Run deterministic, zero-network language-preservation fixtures.
 * @param {readonly MultilingualTask[]} [tasks]
 * @returns {MultilingualRun[]}
 */
export function runMultilingualBenchmark(tasks = MULTILINGUAL_TASKS) {
  return tasks.map((task) => {
    const output = compressMarkdown(task.input, task.level);
    const lowered = output.toLocaleLowerCase(task.language);
    const sameLanguage =
      task.languageMarkers.every((marker) =>
        lowered.includes(marker.toLocaleLowerCase(task.language))
      ) &&
      task.forbiddenMarkers.every(
        (marker) => !lowered.includes(marker.toLocaleLowerCase(task.language))
      );
    const preserved = task.preservedSpans.every((span) => output.includes(span));
    const bytesBefore = Buffer.byteLength(task.input);
    const bytesAfter = Buffer.byteLength(output);

    return {
      id: task.id,
      language: task.language,
      level: task.level,
      output,
      expected: task.expected,
      bytesBefore,
      bytesAfter,
      sameLanguage,
      preserved,
      passed:
        output === task.expected &&
        sameLanguage &&
        preserved &&
        bytesAfter < bytesBefore,
    };
  });
}

/**
 * @param {string[]} argv
 * @returns {number}
 */
export function main(argv) {
  const rows = runMultilingualBenchmark();
  if (argv.includes("--json")) {
    process.stdout.write(JSON.stringify(rows) + "\n");
  } else {
    for (const row of rows) {
      process.stdout.write(
        `${row.passed ? "PASS" : "FAIL"} ${row.language} ${row.id} ` +
          `${row.bytesBefore} -> ${row.bytesAfter} bytes\n`
      );
    }
  }
  return rows.every((row) => row.passed) ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
