import assert from "node:assert/strict";
import test from "node:test";
import { reuseUnansweredUserMessage } from "./idempotency";

test("a failed request is reused instead of storing the same user message again", () => {
  assert.equal(
    reuseUnansweredUserMessage([{ role: "user", content: "What are we building?" }], "What are we building?"),
    true,
  );
});

test("a repeated question after an answer is stored as a new message", () => {
  assert.equal(
    reuseUnansweredUserMessage(
      [
        { role: "user", content: "What are we building?" },
        { role: "assistant", content: "Your Second Mind." },
      ],
      "What are we building?",
    ),
    false,
  );
});

test("a different unanswered question is stored", () => {
  assert.equal(
    reuseUnansweredUserMessage([{ role: "user", content: "What are we building?" }], "Are we deployed?"),
    false,
  );
  assert.equal(reuseUnansweredUserMessage([], "Are we deployed?"), false);
});
