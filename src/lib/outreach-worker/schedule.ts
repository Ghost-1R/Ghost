const TZ = "America/New_York";

export function etParts(at: Date = new Date()): { hour: number; day: string } {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: TZ,
    }).format(at),
  );
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  return { hour: hour === 24 ? 0 : hour, day };
}

export function etCalendarDay(at: Date = new Date()): string {
  return etParts(at).day;
}

/** Inclusive start hour, exclusive end hour in America/New_York (default 9–17). */
export function withinBusinessHours(
  at: Date,
  windowStartHour: number,
  windowEndHour: number,
): boolean {
  const { hour } = etParts(at);
  if (windowStartHour === windowEndHour) return true;
  if (windowStartHour < windowEndHour) {
    return hour >= windowStartHour && hour < windowEndHour;
  }
  // Overnight window (unusual for outreach).
  return hour >= windowStartHour || hour < windowEndHour;
}

export function businessWindowLabel(startHour: number, endHour: number): string {
  const fmt = (h: number) => {
    const suffix = h >= 12 ? "PM" : "AM";
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:00 ${suffix}`;
  };
  return `${fmt(startHour)}–${fmt(endHour)} America/New_York · weekdays`;
}

export function isWeekdayEt(at: Date = new Date()): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: TZ,
  }).format(at);
  return weekday !== "Sat" && weekday !== "Sun";
}

export function canSendInWindow(
  at: Date,
  windowStartHour: number,
  windowEndHour: number,
): boolean {
  return isWeekdayEt(at) && withinBusinessHours(at, windowStartHour, windowEndHour);
}
