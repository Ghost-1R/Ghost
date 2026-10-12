/** Ghost Allowance V1 — integer USD cents. Internal authorization only. */

export type AllowanceAlertLevel = "OK" | "WARNING" | "HARD_STOP";

export type ProjectAiAllowance = {
  projectId: string;
  ownerId: string;
  allowanceCents: number;
  reservedCents: number;
  chargedCents: number;
  currency: "USD";
  updatedAt: string;
};

export type AllowanceReservation = {
  id: string;
  projectId: string;
  ownerId: string;
  taskKey: string;
  estimatedCents: number;
  status: "OPEN" | "RECONCILED" | "RELEASED";
  idempotencyKey: string;
  createdAt: string;
  closedAt: string | null;
};

export type AllowanceUsageEvent = {
  id: string;
  projectId: string;
  ownerId: string;
  reservationId: string | null;
  eventType: "RESERVE" | "CHARGE" | "RELEASE" | "ADJUST_ALLOWANCE" | "ALERT";
  amountCents: number;
  detail: string;
  idempotencyKey: string;
  createdAt: string;
};

export type AllowanceSnapshot = ProjectAiAllowance & {
  availableCents: number;
  alert: AllowanceAlertLevel;
};

export function availableCents(row: Pick<ProjectAiAllowance, "allowanceCents" | "reservedCents" | "chargedCents">): number {
  return row.allowanceCents - row.chargedCents - row.reservedCents;
}

export function centsToUsdDisplay(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

export function alertForAllowance(
  row: Pick<ProjectAiAllowance, "allowanceCents" | "reservedCents" | "chargedCents">,
  nextEstimateCents = 0,
  warningBps = 2000,
): AllowanceAlertLevel {
  const available = availableCents(row);
  if (nextEstimateCents > 0 && available < nextEstimateCents) return "HARD_STOP";
  if (row.allowanceCents <= 0) return available <= 0 ? "HARD_STOP" : "OK";
  const threshold = Math.floor((row.allowanceCents * warningBps) / 10_000);
  if (available <= threshold) return "WARNING";
  return "OK";
}
