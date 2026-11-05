const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export function isValidBusinessEmail(value: string): boolean {
  const email = value.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return false;
  if (email.endsWith("@example.com") || email.endsWith(".example")) return false;
  return email.length <= 320;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export type ComplianceGate =
  | { ok: true }
  | { ok: false; reason: string };

export function requireSenderSetup(input: {
  senderEmail: string;
  replyToEmail: string;
  postalAddress: string;
  commercialIdentity: string;
}): ComplianceGate {
  if (!isValidBusinessEmail(input.senderEmail)) {
    return { ok: false, reason: "Configure a verified Badger United sender email first." };
  }
  if (!isValidBusinessEmail(input.replyToEmail)) {
    return { ok: false, reason: "Configure a monitored reply-to address first." };
  }
  if (input.postalAddress.trim().length < 10) {
    return {
      ok: false,
      reason: "Configure Badger United’s postal address for commercial identification.",
    };
  }
  if (input.commercialIdentity.trim().length < 2) {
    return { ok: false, reason: "Configure commercial identity (Badger United)." };
  }
  return { ok: true };
}

/** Append CAN-SPAM style footer with identity, postal address, and working opt-out URL. */
export function appendComplianceFooter(input: {
  body: string;
  commercialIdentity: string;
  postalAddress: string;
  optOutUrl: string;
}): string {
  const base = input.body.replace(/\r\n/g, "\n").trimEnd();
  const footer = [
    "",
    "--",
    `This message is a commercial communication from ${input.commercialIdentity.trim()}.`,
    input.postalAddress.trim(),
    `Opt out of future emails: ${input.optOutUrl}`,
  ].join("\n");
  if (base.includes(input.optOutUrl)) return base;
  return `${base}\n${footer}`.slice(0, 8000);
}

export function defaultSubject(businessName: string): string {
  const name = businessName.trim() || "your business";
  return `Introduction — ${name}`.slice(0, 300);
}

export function assertNoInventedClaims(body: string): ComplianceGate {
  if (/\b(guaranteed|100%\s*results|act\s*now\s*or\s*lose)\b/i.test(body)) {
    return {
      ok: false,
      reason: "Remove unverifiable guarantee-style claims before approving.",
    };
  }
  return { ok: true };
}
