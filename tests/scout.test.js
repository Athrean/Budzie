import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { audit, renderAudit } from "../scripts/scout.mjs";

/** Absolute path to the CLI under test. */
const CLI = fileURLToPath(new URL("../scripts/scout.mjs", import.meta.url));

/**
 * Create a throwaway directory tree and clean it up after `fn` runs.
 * @param {(root: string) => Promise<void> | void} fn
 */
async function withTree(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "budzie-scout-"));
  try {
    await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Write a fixture: a context file, code with one cut of each relevant tier, and
 * a sensitive file that must be refused.
 * @param {string} root
 */
function writeFixture(root) {
  writeFileSync(path.join(root, "CLAUDE.md"), "# Project rules\n\nBe terse.\n");
  writeFileSync(
    path.join(root, "src.js"),
    [
      "const a = 1;",
      "// budzie: delete this dead branch",
      "// budzie: stdlib path module instead of a dep",
      "// budzie: native fetch, no axios",
      "// budzie: yagni, drop the speculative hook",
      "// budzie: shrink the config surface",
      "const b = 2;",
    ].join("\n") + "\n"
  );
  writeFileSync(path.join(root, ".env"), "SECRET=should-never-be-read\n");
}

test("audit counts bloat cuts and context, refuses sensitive paths", async () => {
  await withTree(async (root) => {
    writeFixture(root);

    const a = await audit(root);

    // Default plan: auto (delete, stdlib) + suggest (shrink); never aggressive.
    assert.equal(a.bloat.byTier.auto, 2, "two auto-tier cuts");
    assert.equal(a.bloat.byTier.suggest, 1, "one shrink suggestion");
    assert.equal(a.bloat.byTier.aggressive, undefined, "no aggressive cuts by default");
    assert.equal(a.bloat.total, 3);

    assert.equal(a.context.count, 1, "CLAUDE.md is the only context file");
    assert.ok(a.context.totalBytes > 0, "real byte count reported");
    assert.equal(a.context.refused, 1, ".env refused");

    // .env contents must never surface anywhere in the audit.
    assert.ok(!JSON.stringify(a).includes("should-never-be-read"));

    // Findings lead with counted figures; tokens stay labelled ESTIMATE.
    assert.match(a.findings[0], /auto-tier cut/);
    assert.ok(a.findings.some((f) => /ESTIMATE/.test(f)));
    assert.match(a.tokenizerNote, /ESTIMATE/);
  });
});

test("--aggressive includes native/yagni cuts", async () => {
  await withTree(async (root) => {
    writeFixture(root);

    const plain = await audit(root);
    const aggr = await audit(root, { aggressive: true });

    assert.equal(plain.bloat.byTier.aggressive, undefined);
    assert.equal(aggr.bloat.byTier.aggressive, 2, "native + yagni now counted");
    assert.ok(aggr.bloat.total > plain.bloat.total);
  });
});

test("--top caps each list to stay token-lean", async () => {
  await withTree(async (root) => {
    // Five shrink suggestions; top=2 must keep only the first two cuts.
    writeFileSync(
      path.join(root, "code.js"),
      Array.from({ length: 5 }, (_, i) => `// budzie: shrink block ${i}`).join("\n") + "\n"
    );

    const a = await audit(root, { top: 2 });
    assert.equal(a.bloat.total, 5, "all cuts still counted");
    assert.equal(a.bloat.top.length, 2, "but only top 2 listed");
  });
});

test("empty scope reports nothing found, never throws", async () => {
  await withTree(async (root) => {
    const a = await audit(root);
    assert.equal(a.bloat.total, 0);
    assert.equal(a.context.count, 0);
    assert.deepEqual(a.findings, ["no bloat markers or context files found"]);
  });
});

test("scopes are independent: parallel audits do not cross-talk", async () => {
  await withTree(async (a) => {
    await withTree(async (b) => {
      writeFileSync(path.join(a, "x.js"), "// budzie: delete me\n");
      mkdirSync(path.join(b, "sub"));
      writeFileSync(path.join(b, "NOTES.md"), "notes\n");

      const [ra, rb] = await Promise.all([audit(a), audit(b)]);

      assert.equal(ra.bloat.total, 1);
      assert.equal(ra.context.count, 0);
      assert.equal(rb.bloat.total, 0);
      assert.equal(rb.context.count, 1);
      assert.equal(ra.scope, a);
      assert.equal(rb.scope, b);
    });
  });
});

test("renderAudit leads with counted figures and labels estimates", async () => {
  await withTree(async (root) => {
    writeFixture(root);
    const card = renderAudit(await audit(root));
    assert.match(card, /real local count/);
    assert.match(card, /\(ESTIMATE\)/);
    assert.match(card, /findings:/);
  });
});

test("CLI --json emits structured audit; default renders a card", async () => {
  await withTree(async (root) => {
    writeFixture(root);

    const json = execFileSync(process.execPath, [CLI, root, "--json"], { encoding: "utf8" });
    const parsed = JSON.parse(json);
    assert.equal(parsed.scope, root);
    assert.equal(parsed.bloat.total, 3);
    assert.ok(!json.includes("should-never-be-read"));

    const card = execFileSync(process.execPath, [CLI, root], { encoding: "utf8" });
    assert.match(card, /Budzie scout audit/);
  });
});

test("CLI rejects a non-positive --top", async () => {
  assert.throws(() =>
    execFileSync(process.execPath, [CLI, "--top", "0"], { encoding: "utf8", stdio: "pipe" })
  );
});
