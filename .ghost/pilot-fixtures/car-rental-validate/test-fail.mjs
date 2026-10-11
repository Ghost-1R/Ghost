import assert from "node:assert/strict";
import test from "node:test";

test("intentional failing test for pilot negative path", () => {
  assert.equal(1, 2);
});
