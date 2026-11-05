import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  needsPermissionLabel,
  requiredEmailScope,
  scopeLabel,
} from "./eligibility";

describe("outreach eligibility helpers", () => {
  it("maps service and follow-up to exact scopes", () => {
    assert.equal(requiredEmailScope({ isFollowUp: false, serviceInterest: "website" }), "service_website");
    assert.equal(requiredEmailScope({ isFollowUp: true }), "follow_up");
    assert.equal(requiredEmailScope({ isFollowUp: false }), "commercial_introduction");
    assert.match(scopeLabel("service_website"), /website/);
  });

  it("flags Needs permission when only a public email exists", () => {
    assert.equal(
      needsPermissionLabel({
        contactEmail: "desk@school.test",
        eligibility: [],
        serviceInterest: "website",
      }),
      true,
    );
    assert.equal(
      needsPermissionLabel({
        contactEmail: "desk@school.test",
        eligibility: [
          {
            id: "1",
            kind: "documented_request",
            source: "voicemail",
            scope: "service_website",
            recordedAt: new Date().toISOString(),
            recipientEmail: "desk@school.test",
            notes: "",
          },
        ],
        serviceInterest: "website",
      }),
      false,
    );
  });
});
