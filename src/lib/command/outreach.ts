/** Outreach pipeline stages for Opportunity Radar (separate from research-task status). */

export const OUTREACH_STAGES = [
  "new",
  "waiting",
  "queued",
  "sending",
  "sent",
  "delivered",
  "bounced",
  "needs_attention",
  "replied",
  "won",
  "closed",
] as const;

export type OutreachStage = (typeof OUTREACH_STAGES)[number];

export const OUTREACH_SERVICES = ["website", "app", "ads", "wholesale"] as const;
export type OutreachService = (typeof OUTREACH_SERVICES)[number];

export type OutreachAction =
  | "move_to_review"
  | "close"
  | "save_email"
  | "mark_sent"
  | "mark_replied"
  | "mark_won"
  | "save_details";

export const OUTREACH_SECTION: Record<
  OutreachStage,
  {
    id: OutreachStage;
    label: string;
    tone:
      | "blue"
      | "gold"
      | "amber"
      | "orange"
      | "cyan"
      | "teal"
      | "red"
      | "rose"
      | "purple"
      | "green"
      | "gray";
  }
> = {
  new: { id: "new", label: "New leads", tone: "blue" },
  waiting: { id: "waiting", label: "Waiting for approval", tone: "gold" },
  queued: { id: "queued", label: "Queued", tone: "amber" },
  sending: { id: "sending", label: "Sending", tone: "orange" },
  sent: { id: "sent", label: "Sent", tone: "cyan" },
  delivered: { id: "delivered", label: "Delivered", tone: "teal" },
  bounced: { id: "bounced", label: "Bounced", tone: "red" },
  needs_attention: { id: "needs_attention", label: "Needs attention", tone: "rose" },
  replied: { id: "replied", label: "Replied", tone: "purple" },
  won: { id: "won", label: "Won", tone: "green" },
  closed: { id: "closed", label: "Closed", tone: "gray" },
};

const TRANSITIONS: Record<OutreachStage, Partial<Record<OutreachAction, OutreachStage>>> = {
  new: { move_to_review: "waiting", close: "closed", save_details: "new" },
  waiting: {
    save_email: "waiting",
    mark_sent: "sent",
    close: "closed",
    save_details: "waiting",
  },
  queued: { close: "closed", save_details: "queued" },
  sending: { close: "closed", save_details: "sending" },
  sent: { mark_replied: "replied", close: "closed", save_details: "sent" },
  delivered: { mark_replied: "replied", close: "closed", save_details: "delivered" },
  bounced: { close: "closed", save_details: "bounced" },
  needs_attention: {
    save_email: "waiting",
    close: "closed",
    save_details: "needs_attention",
  },
  replied: { mark_won: "won", close: "closed", save_details: "replied" },
  won: { save_details: "won" },
  closed: { save_details: "closed" },
};

export function isOutreachStage(value: string): value is OutreachStage {
  return (OUTREACH_STAGES as readonly string[]).includes(value);
}

export function isOutreachService(value: string): value is OutreachService {
  return (OUTREACH_SERVICES as readonly string[]).includes(value);
}

/** MOCK Brave listings use example.com/mock/… — never treat as real outreach. */
export function isMockSourceUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return (
      parsed.hostname === "example.com" &&
      parsed.pathname.toLowerCase().startsWith("/mock/")
    );
  } catch {
    return /example\.com\/mock\//i.test(trimmed);
  }
}

export function nextOutreachStage(
  current: OutreachStage,
  action: OutreachAction,
): OutreachStage | null {
  return TRANSITIONS[current][action] ?? null;
}

export function canOutreachAction(current: OutreachStage, action: OutreachAction): boolean {
  return nextOutreachStage(current, action) != null;
}
