import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const WORKFLOW_PATH = ".github/workflows/ci.yml";

async function readWorkflow() {
  return readFile(WORKFLOW_PATH, "utf8");
}

test("CI workflow runs verification on pull requests and main pushes", async () => {
  const workflow = await readWorkflow();

  assert.match(workflow, /^on:\n  pull_request:\n  push:\n    branches: \[main\]/m);
  assert.match(workflow, /\n\s+- name: Install dependencies\n\s+run: npm ci\n/);
  assert.match(workflow, /\n\s+- name: Test\n\s+run: npm test\n/);
  assert.match(workflow, /\n\s+- name: Typecheck\n\s+run: npm run typecheck\n/);
});

test("CI workflow uses minimal repository access without secrets", async () => {
  const workflow = await readWorkflow();

  assert.match(workflow, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(workflow, /\bsecrets\./);
  assert.doesNotMatch(workflow, /\bGITHUB_TOKEN\b/);
});
