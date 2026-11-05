import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { approvalHash, hashesMatch, messageIdempotencyKey } from "./hash";

describe("outreach approval hash", () => {
  it("is stable for identical content", () => {
    const a = approvalHash({
      sender: "hello@badger.example",
      recipient: "desk@school.example",
      subject: "Introduction — Drive Right",
      body: "Hello,\n\nShort note.",
    });
    const b = approvalHash({
      sender: "Hello@Badger.Example",
      recipient: " Desk@School.Example ",
      subject: "Introduction — Drive Right",
      body: "Hello,\r\n\r\nShort note.",
    });
    assert.equal(a, b);
  });

  it("changes when body changes", () => {
    const base = {
      sender: "hello@badger.example",
      recipient: "desk@school.example",
      subject: "Hi",
      body: "One",
    };
    assert.equal(hashesMatch(approvalHash(base), base), true);
    assert.equal(hashesMatch(approvalHash(base), { ...base, body: "Two" }), false);
  });

  it("builds distinct idempotency keys for follow-ups", () => {
    const hash = "abcdef0123456789abcdef01";
    assert.notEqual(
      messageIdempotencyKey("11111111-1111-4111-8111-111111111111", hash, false),
      messageIdempotencyKey("11111111-1111-4111-8111-111111111111", hash, true),
    );
  });
});
