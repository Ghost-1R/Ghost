export const OUTREACH_WORKER_SLUG = "outreach" as const;

export type OutreachMessageStatus =
  | "awaiting_approval"
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "bounced"
  | "failed"
  | "cancelled"
  | "suppressed";

export type OutreachProviderId = "fake" | "ses";

export type OutreachConfigRow = {
  id: string;
  company_id: string | null;
  owner_id: string | null;
  company_slug: string;
  live_enabled: boolean;
  paused: boolean;
  daily_send_cap: number;
  /** SES/live sends toward daily_send_cap. */
  sends_today: number;
  /** Local fake-provider sends (does not consume SES quota). */
  fake_sends_today: number;
  send_quota_day: string;
  ses_sandbox_recipient: string;
  window_start_hour: number;
  window_end_hour: number;
  timezone: string;
  sender_email: string;
  sender_display_name: string;
  reply_to_email: string;
  postal_address: string;
  commercial_identity: string;
  provider: OutreachProviderId;
  last_blocker: string;
};

export type OutreachBoardState = {
  configured: boolean;
  liveEnabled: boolean;
  paused: boolean;
  schedulerAvailable: boolean;
  unavailableReason: string | null;
  companySlug: string;
  companyId: string | null;
  dailySendCap: number;
  /** SES/live quota usage. */
  sendsToday: number;
  /** Fake local usage (separate). */
  fakeSendsToday: number;
  sendQuotaDay: string;
  sesSandboxRecipient: string;
  windowLabel: string;
  senderEmail: string;
  replyToEmail: string;
  postalAddress: string;
  commercialIdentity: string;
  provider: OutreachProviderId;
  queuedCount: number;
  sendingCount: number;
  needsAttentionCount: number;
  lastBlocker: string | null;
};

export type ApproveQueueInput = {
  opportunityId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  isFollowUp?: boolean;
};
