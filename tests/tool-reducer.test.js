import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  compressCatalog,
  proxyResponse,
  byteLength,
} from "../scripts/tool-reducer.mjs";

/** Absolute path to the CLI under test. */
const CLI = fileURLToPath(new URL("../scripts/tool-reducer.mjs", import.meta.url));

/**
 * A prose-heavy fixture catalog: a `tools/list`-style result. Descriptions are
 * padded with filler the compressor should be able to trim, plus load-bearing
 * spans (URLs, paths, identifiers, code) it must preserve byte-for-byte.
 * @returns {{ tools: Array<Record<string, unknown>> }}
 */
function proseCatalog() {
  return {
    tools: [
      {
        name: "fetch_url",
        description:
          "This tool is basically used in order to fetch a URL. " +
          "Please note that you should really make sure to pass the endpoint " +
          "https://api.example.com/v1/items as the `url` argument. " +
          "It returns the response body as a string of text.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "The url to fetch" },
            method: { type: "string", enum: ["GET", "POST", "DELETE"] },
          },
          required: ["url"],
        },
      },
      {
        name: "read_path",
        description:
          "Just simply reads the file located at the given path. " +
          "For example, reading /etc/hosts or ./config/settings.json works. " +
          "Use the `runReader()` helper internally. That is all.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Absolute path to read" },
          },
        },
      },
    ],
  };
}

test("opt-out default: no config passes the catalog through unchanged", () => {
  const catalog = proseCatalog();
  const out = compressCatalog(catalog, {});
  assert.deepEqual(out.catalog, catalog);
  assert.equal(out.bytesBefore, out.bytesAfter);
});

test("opt-out default: enabled omitted is treated as off", () => {
  const catalog = proseCatalog();
  const out = compressCatalog(catalog, { fields: ["description"] });
  assert.deepEqual(out.catalog, catalog);
  assert.equal(out.bytesBefore, out.bytesAfter);
});

test("passthrough: a tool-call response goes through proxyResponse unchanged", () => {
  const response = {
    jsonrpc: "2.0",
    id: 7,
    result: {
      content: [{ type: "text", text: "the   raw    tool output\nstays\nexact" }],
      isError: false,
    },
  };
  const out = proxyResponse(response, { enabled: true, fields: ["description"] });
  assert.deepEqual(out, response);
});

test("passthrough: a request object is never mutated by the proxy", () => {
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "fetch_url", arguments: { url: "https://a.test/x" } },
  };
  const out = proxyResponse(request, { enabled: true, fields: ["description"] });
  assert.deepEqual(out, request);
});

test("prose-field compression: only configured fields shrink, structure intact", () => {
  const catalog = proseCatalog();
  const out = compressCatalog(catalog, { enabled: true, fields: ["description"] });

  // Structure is identical apart from the compressed prose field.
  assert.equal(out.catalog.tools.length, 2);
  for (let i = 0; i < catalog.tools.length; i++) {
    const before = catalog.tools[i];
    const after = out.catalog.tools[i];
    assert.equal(after.name, before.name, "tool name unchanged");
    assert.deepEqual(after.inputSchema, before.inputSchema, "schema unchanged");
    assert.ok(
      byteLength(after.description) <= byteLength(before.description),
      "description should not grow"
    );
  }

  // At least one description actually got smaller.
  const before0 = byteLength(catalog.tools[0].description);
  const after0 = byteLength(out.catalog.tools[0].description);
  assert.ok(after0 < before0, "a prose-heavy description should shrink");

  // The original catalog is not mutated.
  assert.deepEqual(catalog, proseCatalog());
});

test("prose-field compression follows the configured Budzie intensity", () => {
  const catalog = proseCatalog();
  const low = compressCatalog(catalog, {
    enabled: true,
    fields: ["description"],
    level: "low",
  });
  const ultra = compressCatalog(catalog, {
    enabled: true,
    fields: ["description"],
    level: "ultra",
  });

  assert.ok(
    byteLength(ultra.catalog.tools[0].description) <
      byteLength(low.catalog.tools[0].description)
  );
});

test("prose-field compression: unconfigured fields are left alone", () => {
  const catalog = proseCatalog();
  const out = compressCatalog(catalog, { enabled: true, fields: ["description"] });
  // inputSchema descriptions are NOT in the configured top-level field list and
  // must remain byte-for-byte identical.
  assert.deepEqual(
    out.catalog.tools[0].inputSchema,
    catalog.tools[0].inputSchema
  );
});

test("preservation: URLs survive byte-for-byte inside a compressed description", () => {
  const catalog = proseCatalog();
  const out = compressCatalog(catalog, { enabled: true, fields: ["description"] });
  assert.match(
    String(out.catalog.tools[0].description),
    /https:\/\/api\.example\.com\/v1\/items/
  );
});

test("preservation: file paths survive byte-for-byte", () => {
  const catalog = proseCatalog();
  const out = compressCatalog(catalog, { enabled: true, fields: ["description"] });
  const desc = String(out.catalog.tools[1].description);
  assert.ok(desc.includes("/etc/hosts"), "absolute path preserved");
  assert.ok(desc.includes("./config/settings.json"), "relative path preserved");
});

test("preservation: backtick code spans and identifiers survive", () => {
  const catalog = proseCatalog();
  const out = compressCatalog(catalog, { enabled: true, fields: ["description"] });
  assert.ok(
    String(out.catalog.tools[0].description).includes("`url`"),
    "code span preserved"
  );
  assert.ok(
    String(out.catalog.tools[1].description).includes("`runReader()`"),
    "function-call code span preserved"
  );
  // Tool names and enum values (identifiers) never change.
  assert.equal(out.catalog.tools[0].name, "fetch_url");
  assert.deepEqual(out.catalog.tools[0].inputSchema.properties.method.enum, [
    "GET",
    "POST",
    "DELETE",
  ]);
});

test("byte accounting: reported counts match actual serialized field sizes", () => {
  const catalog = proseCatalog();
  const fields = ["description"];
  const out = compressCatalog(catalog, { enabled: true, fields });

  let expectedBefore = 0;
  let expectedAfter = 0;
  for (let i = 0; i < catalog.tools.length; i++) {
    expectedBefore += byteLength(catalog.tools[i].description);
    expectedAfter += byteLength(out.catalog.tools[i].description);
  }
  assert.equal(out.bytesBefore, expectedBefore);
  assert.equal(out.bytesAfter, expectedAfter);
  assert.ok(out.bytesAfter < out.bytesBefore, "net savings on prose catalog");
});

test("byteLength counts UTF-8 bytes, not characters", () => {
  // "é" is one char but two UTF-8 bytes.
  assert.equal(byteLength("é"), 2);
  assert.equal(byteLength("abc"), 3);
  assert.equal(byteLength(undefined), 0);
});

test("compressCatalog tolerates a catalog with no tools array", () => {
  const weird = { somethingElse: true };
  const out = compressCatalog(weird, { enabled: true, fields: ["description"] });
  assert.deepEqual(out.catalog, weird);
  assert.equal(out.bytesBefore, out.bytesAfter);
});

test("CLI --json reports before/after bytes and emits the catalog", () => {
  const root = mkdtempSync(path.join(tmpdir(), "budzie-reducer-"));
  try {
    const file = path.join(root, "catalog.json");
    writeFileSync(file, JSON.stringify(proseCatalog()));
    const out = execFileSync(
      "node",
      [CLI, "--json", "--fields", "description", file],
      { encoding: "utf8" }
    );
    const parsed = JSON.parse(out);
    assert.ok(parsed.bytesBefore > parsed.bytesAfter);
    assert.equal(parsed.catalog.tools.length, 2);
    assert.equal(parsed.catalog.tools[0].name, "fetch_url");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI is opt-in: without --fields the catalog is unchanged", () => {
  const root = mkdtempSync(path.join(tmpdir(), "budzie-reducer-"));
  try {
    const file = path.join(root, "catalog.json");
    const original = proseCatalog();
    writeFileSync(file, JSON.stringify(original));
    const out = execFileSync("node", [CLI, "--json", file], { encoding: "utf8" });
    const parsed = JSON.parse(out);
    assert.deepEqual(parsed.catalog, original);
    assert.equal(parsed.bytesBefore, parsed.bytesAfter);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("skill documents the opt-in flag and preservation guarantee", () => {
  const skill = execFileSync("cat", ["skills/budzie-shrink/SKILL.md"], {
    encoding: "utf8",
  });
  assert.match(skill, /--fields/);
  assert.match(skill, /opt-in/i);
  assert.match(skill, /preserv/i);
});
