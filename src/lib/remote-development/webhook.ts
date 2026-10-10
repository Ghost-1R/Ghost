import { createHmac, timingSafeEqual } from "node:crypto";
import type { RemoteProviderStatusEvent } from "./types";

export type WebhookValidationResult =
  | { ok: true; event: RemoteProviderStatusEvent; duplicate: boolean }
  | { ok: false; reason: string; message: string };

/**
 * Validate webhook/callback authenticity with HMAC signature, replay window,
 * and event-id idempotency. Fail closed on ambiguity.
 */
export function validateProviderWebhook(input: {
  rawBody: string;
  signatureHeader: string;
  sharedSecret: string;
  event: RemoteProviderStatusEvent;
  seenEventIds: ReadonlySet<string>;
  nowMs?: number;
  maxSkewMs?: number;
}): WebhookValidationResult {
  if (!input.sharedSecret.trim() || input.sharedSecret.length < 16) {
    return { ok: false, reason: "SECRET_MISSING", message: "Webhook secret is not configured." };
  }
  if (!input.event.eventId.trim()) {
    return { ok: false, reason: "MISSING_EVENT_ID", message: "eventId is required for idempotency." };
  }
  if (!input.event.externalJobId.trim()) {
    return { ok: false, reason: "MISSING_JOB_ID", message: "externalJobId is required." };
  }

  const expected = createHmac("sha256", input.sharedSecret)
    .update(input.rawBody)
    .digest("hex");
  const provided = input.signatureHeader.replace(/^sha256=/i, "").trim();
  if (!provided || provided.length !== expected.length) {
    return { ok: false, reason: "SIGNATURE_INVALID", message: "Webhook signature rejected." };
  }
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (!timingSafeEqual(a, b)) {
    return { ok: false, reason: "SIGNATURE_INVALID", message: "Webhook signature rejected." };
  }

  // Signature must match event.signature claim when present.
  if (input.event.signature && input.event.signature !== provided && input.event.signature !== expected) {
    return { ok: false, reason: "SIGNATURE_MISMATCH", message: "Event signature claim does not match header." };
  }

  const now = input.nowMs ?? Date.now();
  const occurred = Date.parse(input.event.occurredAt);
  const skew = input.maxSkewMs ?? 5 * 60 * 1000;
  if (!Number.isFinite(occurred) || Math.abs(now - occurred) > skew) {
    return { ok: false, reason: "REPLAY_OR_SKEW", message: "Event timestamp outside replay window." };
  }

  if (input.seenEventIds.has(input.event.eventId)) {
    return { ok: true, event: input.event, duplicate: true };
  }

  return { ok: true, event: input.event, duplicate: false };
}

export function signProviderWebhookBody(rawBody: string, sharedSecret: string): string {
  return createHmac("sha256", sharedSecret).update(rawBody).digest("hex");
}
