import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("development-tasks page loads real data only and forbids fake metrics", () => {
  const page = readFileSync(
    new URL("../../app/(workspace)/development-tasks/page.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(page.includes("loadRemoteDevTasks"));
  assert.ok(page.includes("toFounderReviewCard"));
  assert.ok(page.includes("Deployment authorized: no"));
  assert.ok(!/fake task|sample task|78\s*%|velocity/i.test(page));
  assert.ok(!page.includes("@/lib/agent-runtime"));
});
