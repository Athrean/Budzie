import assert from "node:assert/strict";
import test from "node:test";

import {
  BUDZIE_INVARIANTS,
  checkDrift,
} from "../scripts/check-drift.mjs";

test("current repo satisfies canonical Budzie invariants", async () => {
  const drift = await checkDrift();

  assert.equal(BUDZIE_INVARIANTS.productName, "Budzie");
  assert.deepEqual(drift, []);
});
