import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const CLI = fileURLToPath(new URL("../bin/budzie-shrink.mjs", import.meta.url));
const UPSTREAM = fileURLToPath(
  new URL("./fixtures/shrink-upstream.mjs", import.meta.url)
);

/**
 * @param {object[]} messages
 * @returns {Promise<{ messages: any[], stderr: string, code: number | null }>}
 */
function runProxy(messages) {
  const dataDir = mkdtempSync(path.join(tmpdir(), "budzie-shrink-"));
  const upstream = `${JSON.stringify(process.execPath)} ${JSON.stringify(UPSTREAM)}`;

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [CLI, "--upstream", upstream],
      {
        env: { ...process.env, BUDZIE_DATA_DIR: dataDir },
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("budzie-shrink timed out"));
    }, 5_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      rmSync(dataDir, { recursive: true, force: true });
      const parsed = stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      resolve({ messages: parsed, stderr, code });
    });

    for (const message of messages) {
      child.stdin.write(JSON.stringify(message) + "\n");
    }
    child.stdin.end();
  });
}

test("stdio proxy compresses tools/list descriptions and preserves schemas", async () => {
  const response = await runProxy([
    { jsonrpc: "2.0", id: 7, method: "tools/list", params: {} },
  ]);

  assert.equal(response.code, 0, response.stderr);
  assert.equal(response.messages.length, 1);
  const tool = response.messages[0].result.tools[0];
  assert.ok(
    tool.description.length <
      "Please make sure to carefully fetch the requested URL in order to return the response body as a string."
        .length
  );
  assert.deepEqual(tool.inputSchema, {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The exact URL to fetch without changing it.",
      },
      method: {
        type: "string",
        enum: ["GET", "POST", "DELETE"],
      },
    },
    required: ["url"],
  });
  assert.deepEqual(tool.outputSchema, {
    type: "object",
    properties: {
      body: { type: "string" },
    },
    required: ["body"],
  });
  assert.equal(response.messages[0].result.nextCursor, "page-2");
});
