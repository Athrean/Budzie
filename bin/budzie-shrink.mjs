#!/usr/bin/env node
// @ts-check
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { Transform } from "node:stream";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { readLevel } from "../scripts/intensity.mjs";
import { compressCatalog } from "../scripts/tool-reducer.mjs";

/**
 * @typedef {import("../scripts/intensity.mjs").Level} Level
 * @typedef {(line: string) => string | undefined} LineHandler
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {string} line
 * @returns {Record<string, any> | null}
 */
function parseMessage(line) {
  try {
    const value = JSON.parse(line);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} id
 * @returns {string | null}
 */
function requestKey(id) {
  if (typeof id !== "string" && typeof id !== "number") return null;
  return `${typeof id}:${JSON.stringify(id)}`;
}

/**
 * Transform newline-delimited JSON without changing untouched lines.
 * @param {LineHandler} handleLine
 * @returns {Transform}
 */
function createLineTransform(handleLine) {
  const decoder = new StringDecoder("utf8");
  let buffered = "";

  /**
   * @param {Transform} stream
   * @param {boolean} flush
   */
  function drain(stream, flush) {
    let newline = buffered.indexOf("\n");
    while (newline !== -1) {
      const raw = buffered.slice(0, newline + 1);
      buffered = buffered.slice(newline + 1);
      const ending = raw.endsWith("\r\n") ? "\r\n" : "\n";
      const line = raw.slice(0, -ending.length);
      const replacement = handleLine(line);
      stream.push(replacement === undefined ? raw : replacement + ending);
      newline = buffered.indexOf("\n");
    }

    if (flush && buffered !== "") {
      const replacement = handleLine(buffered);
      stream.push(replacement === undefined ? buffered : replacement);
      buffered = "";
    }
  }

  return new Transform({
    transform(chunk, _encoding, callback) {
      buffered += decoder.write(chunk);
      drain(this, false);
      callback();
    },
    flush(callback) {
      buffered += decoder.end();
      drain(this, true);
      callback();
    },
  });
}

/**
 * @param {Level} level
 * @param {number} before
 * @param {number} after
 * @returns {string}
 */
export function renderStartupReport(level, before, after) {
  const saved = before - after;
  const percent = before === 0 ? 0 : Math.round((saved / before) * 100);
  return `Budzie Shrink: level ${level}, descriptions ${before} -> ${after} bytes, saved ${saved} (${percent}%)`;
}

/**
 * Start the MCP stdio proxy.
 * @param {string[]} argv
 */
export function main(argv) {
  const parsed = parseArgs({
    args: argv,
    options: {
      upstream: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (parsed.values.help) {
    process.stdout.write('usage: budzie-shrink --upstream "<command>"\n');
    return;
  }

  const command = parsed.values.upstream;
  if (!command) {
    throw new Error('usage: budzie-shrink --upstream "<command>"');
  }

  const level = readLevel();
  const pendingToolLists = new Set();
  let startupReported = false;
  const upstream = spawn(command, {
    shell: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const requests = createLineTransform((line) => {
    const message = parseMessage(line);
    if (message?.method === "tools/list") {
      const key = requestKey(message.id);
      if (key !== null) pendingToolLists.add(key);
    }
    return undefined;
  });

  const responses = createLineTransform((line) => {
    const message = parseMessage(line);
    const key = requestKey(message?.id);
    if (key === null || !pendingToolLists.has(key)) return undefined;
    if (!isRecord(message) || !("result" in message)) {
      if (isRecord(message) && "error" in message) pendingToolLists.delete(key);
      return undefined;
    }

    pendingToolLists.delete(key);
    if (!isRecord(message.result) || !Array.isArray(message.result.tools)) {
      return undefined;
    }

    const reduced = compressCatalog(message.result, {
      enabled: true,
      fields: ["description"],
      level,
    });
    if (!startupReported) {
      process.stderr.write(
        renderStartupReport(level, reduced.bytesBefore, reduced.bytesAfter) + "\n"
      );
      startupReported = true;
    }
    return JSON.stringify({ ...message, result: reduced.catalog });
  });

  process.stdin.pipe(requests).pipe(upstream.stdin);
  upstream.stdout.pipe(responses).pipe(process.stdout, { end: false });
  upstream.stderr.pipe(process.stderr, { end: false });

  upstream.on("error", (error) => {
    process.stderr.write(`budzie-shrink: ${error.message}\n`);
    process.exitCode = 1;
  });
  upstream.stdin.on("error", (error) => {
    if ("code" in error && error.code === "EPIPE") return;
    process.stderr.write(`budzie-shrink: ${error.message}\n`);
    process.exitCode = 1;
  });
  upstream.on("close", (code) => {
    process.stdin.unpipe(requests);
    process.stdin.pause();
    process.exitCode = code ?? 1;
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
