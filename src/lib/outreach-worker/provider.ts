import { createHmac, createHash, randomUUID } from "node:crypto";
import type { OutreachProviderId } from "./types";

export type ProviderSendInput = {
  senderEmail: string;
  senderDisplayName: string;
  replyToEmail: string;
  recipientEmail: string;
  subject: string;
  bodyText: string;
  idempotencyKey: string;
};

export type ProviderSendResult =
  | { ok: true; certainty: "accepted"; messageId: string; rawStatus: string }
  | { ok: true; certainty: "uncertain"; messageId: string; rawStatus: string }
  | { ok: false; retryable: boolean; message: string; messageId?: string };

export type ProviderReconcileResult =
  | { ok: true; state: "sent" | "delivered" | "bounced" | "failed" | "unknown"; rawStatus: string }
  | { ok: false; message: string };

export type OutreachEmailProvider = {
  id: OutreachProviderId;
  send(input: ProviderSendInput): Promise<ProviderSendResult>;
  reconcile(messageId: string): Promise<ProviderReconcileResult>;
};

/** In-memory fake provider for local tests. Never leaves the process. */
const fakeStore = new Map<
  string,
  {
    status: "sent" | "delivered" | "bounced" | "failed";
    input: ProviderSendInput;
    createdAt: string;
  }
>();

let fakeMode: "accept" | "uncertain" | "fail" | "bounce" = "accept";

export function setFakeProviderMode(mode: typeof fakeMode): void {
  fakeMode = mode;
}

export function resetFakeProvider(): void {
  fakeStore.clear();
  fakeMode = "accept";
}

export function getFakeProviderMessage(messageId: string) {
  return fakeStore.get(messageId) ?? null;
}

export function listFakeProviderMessages() {
  return [...fakeStore.entries()].map(([id, row]) => ({ id, ...row }));
}

function createFakeProvider(): OutreachEmailProvider {
  return {
    id: "fake",
    async send(input) {
      if (fakeMode === "fail") {
        return { ok: false, retryable: true, message: "Fake provider forced failure." };
      }
      const messageId = `fake_${randomUUID()}`;
      if (fakeMode === "uncertain") {
        fakeStore.set(messageId, {
          status: "sent",
          input,
          createdAt: new Date().toISOString(),
        });
        return {
          ok: true,
          certainty: "uncertain",
          messageId,
          rawStatus: "accepted_uncertain",
        };
      }
      const status = fakeMode === "bounce" ? "bounced" : "sent";
      fakeStore.set(messageId, { status, input, createdAt: new Date().toISOString() });
      if (status === "bounced") {
        return {
          ok: true,
          certainty: "accepted",
          messageId,
          rawStatus: "bounced_immediate",
        };
      }
      return { ok: true, certainty: "accepted", messageId, rawStatus: "accepted" };
    },
    async reconcile(messageId) {
      const row = fakeStore.get(messageId);
      if (!row) return { ok: true, state: "unknown", rawStatus: "missing" };
      return { ok: true, state: row.status, rawStatus: row.status };
    },
  };
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function toAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

/**
 * Minimal SES v2 SendEmail via SigV4. Credentials stay server-side.
 * SES permits commercial mail when recipients reasonably expect contact and
 * bounce/complaint rates stay healthy — not purchased-list blasting.
 */
function createSesProvider(): OutreachEmailProvider {
  const region = (process.env.GHOST_OUTREACH_SES_REGION || process.env.AWS_REGION || "us-east-1").trim();
  const accessKey = (process.env.AWS_ACCESS_KEY_ID || "").trim();
  const secretKey = (process.env.AWS_SECRET_ACCESS_KEY || "").trim();
  const sessionToken = (process.env.AWS_SESSION_TOKEN || "").trim();

  return {
    id: "ses",
    async send(input) {
      if (!accessKey || !secretKey) {
        return {
          ok: false,
          retryable: false,
          message: "SES credentials missing (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY).",
        };
      }
      const host = `email.${region}.amazonaws.com`;
      const path = "/v2/email/outbound-emails";
      const body = JSON.stringify({
        FromEmailAddress: `${input.senderDisplayName} <${input.senderEmail}>`,
        Destination: { ToAddresses: [input.recipientEmail] },
        ReplyToAddresses: input.replyToEmail ? [input.replyToEmail] : undefined,
        Content: {
          Simple: {
            Subject: { Data: input.subject, Charset: "UTF-8" },
            Body: { Text: { Data: input.bodyText, Charset: "UTF-8" } },
          },
        },
        EmailTags: [{ Name: "ghost_idempotency", Value: input.idempotencyKey.slice(0, 256) }],
      });
      const { amzDate, dateStamp } = toAmzDate(new Date());
      const payloadHash = sha256Hex(body);
      const canonicalHeaders = [
        `content-type:application/json`,
        `host:${host}`,
        `x-amz-date:${amzDate}`,
        sessionToken ? `x-amz-security-token:${sessionToken}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const signedHeaders = sessionToken
        ? "content-type;host;x-amz-date;x-amz-security-token"
        : "content-type;host;x-amz-date";
      const canonicalRequest = [
        "POST",
        path,
        "",
        `${canonicalHeaders}\n`,
        signedHeaders,
        payloadHash,
      ].join("\n");
      const credentialScope = `${dateStamp}/${region}/ses/aws4_request`;
      const stringToSign = [
        "AWS4-HMAC-SHA256",
        amzDate,
        credentialScope,
        sha256Hex(canonicalRequest),
      ].join("\n");
      const kDate = hmac(`AWS4${secretKey}`, dateStamp);
      const kRegion = hmac(kDate, region);
      const kService = hmac(kRegion, "ses");
      const kSigning = hmac(kService, "aws4_request");
      const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
      const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

      const headers: Record<string, string> = {
        "content-type": "application/json",
        host,
        "x-amz-date": amzDate,
        Authorization: authorization,
      };
      if (sessionToken) headers["x-amz-security-token"] = sessionToken;

      let response: Response;
      try {
        response = await fetch(`https://${host}${path}`, {
          method: "POST",
          headers,
          body,
        });
      } catch (error) {
        return {
          ok: false,
          retryable: true,
          message: error instanceof Error ? error.message : "SES network error",
        };
      }

      const text = await response.text();
      let parsed: { MessageId?: string; message?: string } = {};
      try {
        parsed = JSON.parse(text) as typeof parsed;
      } catch {
        parsed = {};
      }

      if (response.status >= 200 && response.status < 300 && parsed.MessageId) {
        return {
          ok: true,
          certainty: "accepted",
          messageId: parsed.MessageId,
          rawStatus: String(response.status),
        };
      }
      if (response.status === 429 || response.status >= 500) {
        return {
          ok: false,
          retryable: true,
          message: parsed.message || `SES temporary error ${response.status}`,
        };
      }
      if (response.status === 200 && !parsed.MessageId) {
        return {
          ok: true,
          certainty: "uncertain",
          messageId: `ses_uncertain_${sha256Hex(input.idempotencyKey).slice(0, 16)}`,
          rawStatus: "200_missing_id",
        };
      }
      return {
        ok: false,
        retryable: false,
        message: parsed.message || `SES rejected send (${response.status})`,
      };
    },
    async reconcile(messageId) {
      // Without SNS event wiring, SES reconcile is unknown — caller must not duplicate-send.
      if (!messageId) return { ok: true, state: "unknown", rawStatus: "empty" };
      if (messageId.startsWith("ses_uncertain_")) {
        return { ok: true, state: "unknown", rawStatus: "needs_manual_or_sns" };
      }
      // Accepted MessageIds are treated as sent until bounce/delivery webhooks arrive.
      return { ok: true, state: "sent", rawStatus: "assumed_sent_pending_events" };
    },
  };
}

export function getOutreachProvider(id: OutreachProviderId): OutreachEmailProvider {
  if (id === "ses") return createSesProvider();
  return createFakeProvider();
}
