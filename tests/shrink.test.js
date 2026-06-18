import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
 * @param {number} [timeoutMs]
 * @returns {Promise<{
 *   messages: any[],
 *   stdout: string,
 *   stderr: string,
 *   code: number | null
 * }>}
 */
function runProxy(messages, timeoutMs = 5_000) {
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
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      rmSync(dataDir, { recursive: true, force: true });
      reject(new Error("budzie-shrink timed out"));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rmSync(dataDir, { recursive: true, force: true });
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      rmSync(dataDir, { recursive: true, force: true });
      try {
        const parsed = stdout
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
        resolve({ messages: parsed, stdout, stderr, code });
      } catch (error) {
        reject(error);
      }
    });

    for (const message of messages) {
      child.stdin.write(JSON.stringify(message) + "\n");
    }
    child.stdin.end();
  });
}

test("stdio proxy compresses tools/list descriptions and preserves schemas", async () => {
  const description =
    "Please make sure to carefully fetch the requested URL in order to return the response body as a string.";
  const response = await runProxy([
    { jsonrpc: "2.0", id: 7, method: "tools/list", params: {} },
  ]);

  assert.equal(response.code, 0, response.stderr);
  assert.equal(response.messages.length, 1);
  const tool = response.messages[0].result.tools[0];
  assert.ok(tool.description.length < description.length);
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
  assert.equal(response.stdout, JSON.stringify(response.messages[0]) + "\n");

  const before = Buffer.byteLength(description);
  const after = Buffer.byteLength(tool.description);
  const saved = before - after;
  const percent = Math.round((saved / before) * 100);
  assert.equal(
    response.stderr,
    `Budzie Shrink: level medium, descriptions ${before} -> ${after} bytes, saved ${saved} (${percent}%)\n`
  );
});

test("non-tools/list traffic passes through byte-for-byte", async () => {
  const request = {
    jsonrpc: "2.0",
    id: "echo-1",
    method: "test/echo",
    params: {
      value: "the   raw    value stays exact",
    },
  };
  const expected = {
    jsonrpc: "2.0",
    id: "echo-1",
    result: {
      received: JSON.stringify(request),
      tools: [
        {
          description:
            "Please make sure to leave this non-catalog description exactly unchanged.",
        },
      ],
    },
  };
  const response = await runProxy([request]);

  assert.equal(response.code, 0, response.stderr);
  assert.equal(response.stdout, JSON.stringify(expected) + "\n");
  assert.deepEqual(response.messages, [expected]);
});

test("failed tools/list responses pass through without a savings report", async () => {
  const expected = {
    jsonrpc: "2.0",
    id: 9,
    error: {
      code: -32603,
      message: "catalog unavailable",
      data: {
        retryable: true,
      },
    },
  };
  const response = await runProxy([
    {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/list",
      params: { fail: true },
    },
  ]);

  assert.equal(response.code, 0, response.stderr);
  assert.equal(response.stdout, JSON.stringify(expected) + "\n");
  assert.deepEqual(response.messages, [expected]);
  assert.equal(response.stderr, "");
});

test("timeout rejects cleanly when stdout contains a partial message", async () => {
  await assert.rejects(
    runProxy(
      [{ jsonrpc: "2.0", id: "hang", method: "test/hang", params: {} }],
      50
    ),
    /timed out/
  );
});

test("package, command, skill, and README ship the budzie-shrink server", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  const command = readFileSync("commands/budzie-shrink.toml", "utf8");
  const skill = readFileSync("skills/budzie-shrink/SKILL.md", "utf8");
  const readme = readFileSync("README.md", "utf8");

  assert.equal(pkg.bin["budzie-shrink"], "./bin/budzie-shrink.mjs");
  assert.equal(
    lock.packages[""].bin["budzie-shrink"],
    "bin/budzie-shrink.mjs"
  );
  assert.ok(pkg.files.includes("bin/"));
  for (const text of [command, skill, readme]) {
    assert.match(text, /budzie-shrink --upstream/);
  }
  assert.match(skill, /stderr/);
  assert.match(skill, /current Budzie intensity/i);
});
