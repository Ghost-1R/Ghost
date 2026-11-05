import { normalizeEmail } from "./compliance";

export const SES_SANDBOX_SOURCE = "ses_sandbox_probe";

/** Founder-owned verified SES sandbox inbox (env). Empty = SES blocked while live is off. */
export function sesSandboxRecipientFromEnv(): string {
  return normalizeEmail(process.env.GHOST_OUTREACH_SES_SANDBOX_TO ?? "");
}

export type SesSendGate =
  | { ok: true; mode: "live" | "sandbox" }
  | { ok: false; reason: string };

/**
 * SES send gate:
 * - live_enabled: normal commercial path (still never invents recipients)
 * - live off: only the configured verified sandbox inbox, never a prospect lead
 */
export function gateSesRecipient(input: {
  liveEnabled: boolean;
  recipientEmail: string;
  opportunitySource: string;
  sandboxRecipient?: string;
}): SesSendGate {
  const recipient = normalizeEmail(input.recipientEmail);
  const sandbox = normalizeEmail(input.sandboxRecipient ?? sesSandboxRecipientFromEnv());

  if (!recipient) {
    return { ok: false, reason: "SES send blocked — recipient missing." };
  }

  if (!input.liveEnabled) {
    if (!sandbox) {
      return {
        ok: false,
        reason:
          "SES sandbox blocked — set GHOST_OUTREACH_SES_SANDBOX_TO to your verified inbox. Live sending stays off.",
      };
    }
    if (recipient !== sandbox) {
      return {
        ok: false,
        reason: `SES sandbox blocked — recipient is not the verified sandbox inbox (${sandbox}). Prospects are never sent while live is off.`,
      };
    }
    if (input.opportunitySource !== SES_SANDBOX_SOURCE) {
      return {
        ok: false,
        reason:
          "SES sandbox blocked — only ses_sandbox_probe messages may send while live is off. Prospect leads are refused.",
      };
    }
    return { ok: true, mode: "sandbox" };
  }

  // Live path still refuses the sandbox-only probe source mixing with production prospects is fine,
  // but never allow live to bypass suppression/eligibility elsewhere.
  return { ok: true, mode: "live" };
}

export function isProspectLeadSource(source: string): boolean {
  const s = source.trim().toLowerCase();
  if (!s) return false;
  if (s === SES_SANDBOX_SOURCE) return false;
  if (s === "outreach_test") return false;
  return (
    s.startsWith("lead_worker:") ||
    s === "brave" ||
    s === "manual" ||
    s.includes("prospect")
  );
}
