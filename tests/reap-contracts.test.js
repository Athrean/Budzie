import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const CONTRACT_PATH = "skills/budzie-reap/references/operator-contracts.md";

test("reaper skill links the operator contracts", async () => {
  await access(CONTRACT_PATH);

  const skill = await readFile("skills/budzie-reap/SKILL.md", "utf8");

  assert.ok(skill.includes(CONTRACT_PATH));
});

test("reaper skill summarizes operator boundaries", async () => {
  const skill = await readFile("skills/budzie-reap/SKILL.md", "utf8");

  assert.match(skill, /Locate[\s\S]*read-only/);
  assert.match(skill, /Cut[\s\S]*one cut per worktree/);
  assert.match(skill, /Review[\s\S]*findings only/);
  assert.match(skill, /no files changed/i);
  assert.match(skill, /explicitly[\s\S]*approves/i);
});

test("operator contracts define the required boundaries", async () => {
  const contracts = await readFile(CONTRACT_PATH, "utf8");

  assert.match(contracts, /^## Locate Contract$/m);
  assert.match(contracts, /read-only discovery/);
  assert.match(contracts, /file and line evidence/);
  assert.match(contracts, /stop after the locate summary/);

  assert.match(contracts, /^## Cut Contract$/m);
  assert.match(contracts, /one cut per worktree/);
  assert.match(contracts, /refuse broad or destructive edits/);

  assert.match(contracts, /^## Review Contract$/m);
  assert.match(contracts, /Report findings only/);
  assert.match(contracts, /Apply fixes/);
});
