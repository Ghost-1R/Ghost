import {
  DEFAULT_SHIFT_END_HOUR,
  DEFAULT_SHIFT_START_HOUR,
  DEFAULT_SHIFT_TIMEZONE,
  DEFAULT_SHIFT_WEEKDAYS,
} from "./types";

export type ShiftWindow = {
  timezone: string;
  weekdays: readonly number[];
  startHour: number;
  endHour: number;
};

export const DEFAULT_SHIFT_WINDOW: ShiftWindow = {
  timezone: DEFAULT_SHIFT_TIMEZONE,
  weekdays: DEFAULT_SHIFT_WEEKDAYS,
  startHour: DEFAULT_SHIFT_START_HOUR,
  endHour: DEFAULT_SHIFT_END_HOUR,
};

/** Parts in the shift timezone using Intl (no extra deps). */
export function zonedParts(
  at: Date,
  timeZone: string,
): { weekday: number; hour: number; minute: number; dayPeriod?: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(at).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    weekday: weekdayMap[parts.weekday ?? ""] ?? -1,
    hour: Number(parts.hour ?? "0"),
    minute: Number(parts.minute ?? "0"),
  };
}

/**
 * Default Underworld shift: Mon–Fri, 09:00–17:00 America/New_York.
 * End hour is exclusive (stops claiming at 17:00).
 */
export function isWithinShift(
  at: Date | string = new Date(),
  window: ShiftWindow = DEFAULT_SHIFT_WINDOW,
): boolean {
  const date = typeof at === "string" ? new Date(at) : at;
  if (!Number.isFinite(date.getTime())) return false;
  const parts = zonedParts(date, window.timezone);
  if (!window.weekdays.includes(parts.weekday as (typeof DEFAULT_SHIFT_WEEKDAYS)[number])) {
    return false;
  }
  const minutes = parts.hour * 60 + parts.minute;
  const start = window.startHour * 60;
  const end = window.endHour * 60;
  return minutes >= start && minutes < end;
}

export function shouldClaimNewTasks(input: {
  at?: Date | string;
  forceWithinShift?: boolean;
  window?: ShiftWindow;
}): boolean {
  if (input.forceWithinShift) return true;
  return isWithinShift(input.at ?? new Date(), input.window ?? DEFAULT_SHIFT_WINDOW);
}
