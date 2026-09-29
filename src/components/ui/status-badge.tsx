const GOOD = new Set(["VERIFIED", "COMPLETED", "ACTIVE", "DEPLOYED", "DONE", "APPROVED"]);
const WARN = new Set(["NEEDS_DECISION", "PENDING", "BLOCKED", "ON_HOLD", "PROPOSED", "CLAIMED"]);
const BAD = new Set(["FAILED", "REJECTED", "RETIRED"]);

export function StatusBadge({ status }: { status: string }) {
  const tone = GOOD.has(status) ? "good" : WARN.has(status) ? "warn" : BAD.has(status) ? "bad" : "neutral";
  return <span className={`badge badge-${tone}`}>{status.replaceAll("_", " ")}</span>;
}
