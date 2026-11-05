import { createHash, randomBytes } from "node:crypto";

/** Stable approval fingerprint over exact sender/recipient/subject/body. */
export function approvalHash(input: {
  sender: string;
  recipient: string;
  subject: string;
  body: string;
}): string {
  const payload = [
    input.sender.trim().toLowerCase(),
    input.recipient.trim().toLowerCase(),
    input.subject.trim(),
    input.body.replace(/\r\n/g, "\n").trim(),
  ].join("\n");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function hashesMatch(
  approved: string,
  current: {
    sender: string;
    recipient: string;
    subject: string;
    body: string;
  },
): boolean {
  return approved === approvalHash(current);
}

export function newOptOutToken(): string {
  return randomBytes(24).toString("hex");
}

export function newLeaseToken(): string {
  return randomBytes(16).toString("hex");
}

/** Stable idempotency key for one approved content snapshot per opportunity. */
export function messageIdempotencyKey(opportunityId: string, hash: string, isFollowUp: boolean): string {
  const kind = isFollowUp ? "followup" : "initial";
  return `outreach-send:${opportunityId}:${kind}:${hash.slice(0, 24)}`;
}
