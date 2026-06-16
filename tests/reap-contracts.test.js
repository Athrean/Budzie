import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const CONTRACT_PATH = "skills/budzie-reap/references/operator-contracts.md";

test("reaper skill links the operator contracts", async () => {
  await access(CONTRACT_PATH);

  const skill = await readFile("skills/budzie-reap/SKILL.md", "utf8");

  assert.ok(skill.includes(CONTRACT_PATH));
});
