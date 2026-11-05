import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  getOutreachProvider,
  resetFakeProvider,
  setFakeProviderMode,
  getFakeProviderMessage,
} from "./provider";

describe("fake outreach provider", () => {
  beforeEach(() => {
    resetFakeProvider();
  });

  it("accepts sends and stores message id", async () => {
    setFakeProviderMode("accept");
    const provider = getOutreachProvider("fake");
    const result = await provider.send({
      senderEmail: "hello@badger.example",
      senderDisplayName: "Badger United",
      replyToEmail: "replies@badger.example",
      recipientEmail: "desk@school.example",
      subject: "Hi",
      bodyText: "Hello",
      idempotencyKey: "outreach-send:test:initial:abc",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.certainty, "accepted");
    assert.ok(getFakeProviderMessage(result.messageId));
  });

  it("marks uncertain responses for reconcile", async () => {
    setFakeProviderMode("uncertain");
    const provider = getOutreachProvider("fake");
    const result = await provider.send({
      senderEmail: "hello@badger.example",
      senderDisplayName: "Badger United",
      replyToEmail: "replies@badger.example",
      recipientEmail: "desk@school.example",
      subject: "Hi",
      bodyText: "Hello",
      idempotencyKey: "outreach-send:test:initial:def",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.certainty, "uncertain");
    const reconciled = await provider.reconcile(result.messageId);
    assert.equal(reconciled.ok, true);
    if (!reconciled.ok) return;
    assert.equal(reconciled.state, "sent");
  });

  it("surfaces retryable failures", async () => {
    setFakeProviderMode("fail");
    const provider = getOutreachProvider("fake");
    const result = await provider.send({
      senderEmail: "hello@badger.example",
      senderDisplayName: "Badger United",
      replyToEmail: "replies@badger.example",
      recipientEmail: "desk@school.example",
      subject: "Hi",
      bodyText: "Hello",
      idempotencyKey: "outreach-send:test:initial:ghi",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.retryable, true);
  });
});
