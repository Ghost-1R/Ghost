import { formatTimestamp } from "@/lib/format";

export type PresenceEventType = "SIGN_IN" | "SIGN_OUT" | "LAST_ACTIVE";

export type PresenceEvent = {
  id: string;
  userId: string;
  companyId: string | null;
  eventType: PresenceEventType;
  observedAt: string;
};

export type TimelineEntry = {
  id: string;
  source: "activity" | "presence";
  at: string;
  actorKind: "PERSON" | "AI" | "SYSTEM";
  actorLabel: string;
  action: string;
  summary: string;
  recordType: string | null;
  recordId: string | null;
  externalUnconnected: boolean;
  projectId: string | null;
};

const PRESENCE_VERB: Record<PresenceEventType, string> = {
  SIGN_IN: "Signed in",
  SIGN_OUT: "Signed out",
  LAST_ACTIVE: "Last active",
};

export function presenceLabel(eventType: PresenceEventType): string {
  return PRESENCE_VERB[eventType];
}

/** "Signed in · Nov 4, 2026, 6:08 PM" (fixed UTC format so SSR and client agree). */
export function formatPresenceEvent(event: Pick<PresenceEvent, "eventType" | "observedAt">): string {
  return `${presenceLabel(event.eventType)} · ${formatTimestamp(event.observedAt)}`;
}

/** Relative "5 min ago" style label; `now` is injectable for tests. */
export function formatRelativeTime(value: string, now: Date = new Date()): string {
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return value;
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export type PresenceSummary = {
  lastSignIn: string | null;
  lastSignOut: string | null;
  lastActive: string | null;
  /** Signed in after the most recent sign-out (or never signed out). */
  signedIn: boolean;
};

export function summarizePresence(
  events: ReadonlyArray<Pick<PresenceEvent, "eventType" | "observedAt">>,
): PresenceSummary {
  const latest = (type: PresenceEventType): string | null =>
    events
      .filter((event) => event.eventType === type)
      .map((event) => event.observedAt)
      .sort()
      .at(-1) ?? null;
  const lastSignIn = latest("SIGN_IN");
  const lastSignOut = latest("SIGN_OUT");
  return {
    lastSignIn,
    lastSignOut,
    lastActive: latest("LAST_ACTIVE"),
    signedIn: lastSignIn !== null && (lastSignOut === null || lastSignIn > lastSignOut),
  };
}

export function presenceSummaryLines(summary: PresenceSummary, now: Date = new Date()): string[] {
  const line = (label: string, value: string | null) =>
    `${label}: ${value ? `${formatTimestamp(value)} (${formatRelativeTime(value, now)})` : "never recorded"}`;
  return [
    line("Last sign-in", summary.lastSignIn),
    line("Last sign-out", summary.lastSignOut),
    line("Last active", summary.lastActive),
  ];
}

export function presenceToTimelineEntry(event: PresenceEvent, actorLabel = ""): TimelineEntry {
  return {
    id: `presence:${event.id}`,
    source: "presence",
    at: event.observedAt,
    actorKind: "PERSON",
    actorLabel,
    action: `presence.${event.eventType.toLowerCase()}`,
    summary: presenceLabel(event.eventType),
    recordType: null,
    recordId: null,
    externalUnconnected: false,
    projectId: null,
  };
}

export function mergeTimeline(...lists: ReadonlyArray<ReadonlyArray<TimelineEntry>>): TimelineEntry[] {
  return lists
    .flat()
    .slice()
    .sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0));
}
