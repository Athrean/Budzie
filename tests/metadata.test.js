import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("package and plugin are named budzie", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const plugin = JSON.parse(
    await readFile(".codex-plugin/plugin.json", "utf8")
  );

  assert.equal(pkg.name, "budzie");
  assert.equal(plugin.name, "budzie");
  assert.equal(plugin.interface.displayName, "Budzie");
});
