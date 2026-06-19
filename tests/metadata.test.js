import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("package and plugin are named budzie", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const plugin = JSON.parse(
    await readFile(".codex-plugin/plugin.json", "utf8")
  );
  const marketplace = JSON.parse(
    await readFile(".claude-plugin/marketplace.json", "utf8")
  );

  assert.equal(pkg.name, "budzie");
  assert.equal(plugin.name, "budzie");
  assert.equal(plugin.interface.displayName, "Budzie");
  assert.equal(marketplace.name, "budzie");
  assert.equal(marketplace.owner.name, "Athrean");
});

test("package ships the local runtime scripts used by skills", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));

  assert.ok(pkg.files.includes("src/"));
});
