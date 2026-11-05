import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendComplianceFooter,
  assertNoInventedClaims,
  isValidBusinessEmail,
  requireSenderSetup,
} from "./compliance";

describe("outreach compliance", () => {
  it("rejects example.com and junk emails", () => {
    assert.equal(isValidBusinessEmail("desk@driveright.com"), true);
    assert.equal(isValidBusinessEmail("x@example.com"), false);
    assert.equal(isValidBusinessEmail("not-an-email"), false);
  });

  it("requires sender, reply-to, and postal address", () => {
    const bad = requireSenderSetup({
      senderEmail: "",
      replyToEmail: "replies@badger.example",
      postalAddress: "123 Main St, Atlanta, GA 30301",
      commercialIdentity: "Badger United",
    });
    assert.equal(bad.ok, false);
    const good = requireSenderSetup({
      senderEmail: "hello@badgerunited.com",
      replyToEmail: "replies@badgerunited.com",
      postalAddress: "123 Main St, Atlanta, GA 30301",
      commercialIdentity: "Badger United",
    });
    assert.equal(good.ok, true);
  });

  it("appends commercial identity, postal address, and opt-out", () => {
    const body = appendComplianceFooter({
      body: "Hello there.",
      commercialIdentity: "Badger United",
      postalAddress: "123 Main St, Atlanta, GA 30301",
      optOutUrl: "http://127.0.0.1:3012/api/outreach/opt-out?token=abc",
    });
    assert.match(body, /Badger United/);
    assert.match(body, /123 Main St/);
    assert.match(body, /opt-out\?token=abc/);
  });

  it("blocks guarantee-style invented claims", () => {
    const bad = assertNoInventedClaims("We guarantee 100% results this week.");
    assert.equal(bad.ok, false);
    const good = assertNoInventedClaims("Happy to share a short idea if useful.");
    assert.equal(good.ok, true);
  });
});
