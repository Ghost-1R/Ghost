"use client";

import { useEffect, useState } from "react";

function formatFullDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(now);
}

/** Full calendar date in the founder's device timezone (no stored TZ preference yet). */
export function FounderDate({ asOf }: { asOf?: string }) {
  const [label, setLabel] = useState("Today");
  const [timeZone, setTimeZone] = useState<string | null>(null);

  useEffect(() => {
    const tz = (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      } catch {
        return "UTC";
      }
    })();
    const now = asOf ? new Date(asOf) : new Date();
    setTimeZone(tz);
    setLabel(Number.isNaN(now.getTime()) ? "Date unavailable" : formatFullDate(now, tz));
  }, [asOf]);

  return (
    <p className="today-date" data-timezone={timeZone ?? "pending"}>
      <span className="today-date-label">{label}</span>
      {timeZone ? <span className="today-date-tz quiet">{timeZone}</span> : null}
    </p>
  );
}
