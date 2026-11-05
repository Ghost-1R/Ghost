import type { LeadWorkerSlug } from "./types";
import { zonedParts } from "@/lib/underworld-shifts/schedule";

export const LEAD_WORKER_TIMEZONE = "America/New_York";

/** Will: 08:00–20:00 ET every day. Bubba: 20:00–08:00 ET every day. End hour exclusive. */
export function onDutyWorker(at: Date = new Date(), timeZone = LEAD_WORKER_TIMEZONE): LeadWorkerSlug {
  const parts = zonedParts(at, timeZone);
  const minutes = parts.hour * 60 + parts.minute;
  const dayStart = 8 * 60;
  const dayEnd = 20 * 60;
  if (minutes >= dayStart && minutes < dayEnd) return "will";
  return "bubba";
}

export function isWorkerOnDuty(
  slug: LeadWorkerSlug,
  at: Date = new Date(),
  timeZone = LEAD_WORKER_TIMEZONE,
): boolean {
  return onDutyWorker(at, timeZone) === slug;
}

/** Hour bucket key in America/New_York for idempotent scheduled runs. */
export function hourBucketKey(at: Date = new Date(), timeZone = LEAD_WORKER_TIMEZONE): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(at).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}`;
}

export function etCalendarDay(at: Date = new Date(), timeZone = LEAD_WORKER_TIMEZONE): string {
  return hourBucketKey(at, timeZone).slice(0, 10);
}

/**
 * Approximate next top-of-hour in ET as an ISO timestamp for display.
 * Walks forward minute-by-minute until the ET hour bucket changes, then returns that instant.
 */
export function nextHourlyRunAt(at: Date = new Date(), timeZone = LEAD_WORKER_TIMEZONE): Date {
  const current = hourBucketKey(at, timeZone);
  let cursor = new Date(at.getTime());
  for (let i = 0; i < 70; i += 1) {
    cursor = new Date(cursor.getTime() + 60_000);
    if (hourBucketKey(cursor, timeZone) !== current) {
      cursor.setUTCSeconds(0, 0);
      return cursor;
    }
  }
  return new Date(at.getTime() + 60 * 60 * 1000);
}

export function scheduledIdempotencyKey(at: Date = new Date()): string {
  const worker = onDutyWorker(at);
  return `lead-find:${hourBucketKey(at)}:${worker}:schedule`;
}

export function manualIdempotencyKey(at: Date = new Date()): string {
  const worker = onDutyWorker(at);
  return `lead-find:${hourBucketKey(at)}:${worker}:manual:${Math.floor(at.getTime() / 1000)}`;
}

export function workerShiftLabel(slug: LeadWorkerSlug): string {
  return slug === "will"
    ? "8:00 AM–8:00 PM America/New_York · every day"
    : "8:00 PM–8:00 AM America/New_York · every day";
}
