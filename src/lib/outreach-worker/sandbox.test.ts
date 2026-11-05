import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SES_SANDBOX_SOURCE, gateSesRecipient, isProspectLeadSource } from "./sandbox";

describe("SES sandbox gate", () => {
  it("blocks SES to prospects while live is off", () => {
    const blocked = gateSesRecipient({
      liveEnabled: false,
      recipientEmail: "desk@prospect-school.test",
      opportunitySource: "lead_worker:will",
      sandboxRecipient: "founder@verified.example",
    });
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.match(blocked.reason, /not the verified sandbox|Prospects/i);
  });

  it("allows only the verified sandbox inbox + probe source while live is off", () => {
    const ok = gateSesRecipient({
      liveEnabled: false,
      recipientEmail: "founder@verified.example",
      opportunitySource: SES_SANDBOX_SOURCE,
      sandboxRecipient: "founder@verified.example",
    });
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.equal(ok.mode, "sandbox");
  });

  it("refuses sandbox inbox on a prospect opportunity while live is off", () => {
    const blocked = gateSesRecipient({
      liveEnabled: false,
      recipientEmail: "founder@verified.example",
      opportunitySource: "lead_worker:bubba",
      sandboxRecipient: "founder@verified.example",
    });
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.match(blocked.reason, /ses_sandbox_probe|Prospect/i);
  });

  it("labels Will/Bubba sources as prospects", () => {
    assert.equal(isProspectLeadSource("lead_worker:will"), true);
    assert.equal(isProspectLeadSource(SES_SANDBOX_SOURCE), false);
  });
});
