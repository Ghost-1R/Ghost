import { randomUUID } from "node:crypto";
import {
  alertForAllowance,
  availableCents,
  type AllowanceReservation,
  type AllowanceSnapshot,
  type AllowanceUsageEvent,
  type ProjectAiAllowance,
} from "./types";

/**
 * Deterministic in-memory allowance ledger for unit/mock tests.
 * Mirrors SQL fail-closed semantics. Not a substitute for production DB.
 */
export class MemoryAllowanceLedger {
  private allowances = new Map<string, ProjectAiAllowance>();
  private reservations = new Map<string, AllowanceReservation>();
  private events: AllowanceUsageEvent[] = [];
  private byIdem = new Map<string, string>();

  snapshot(ownerId: string, projectId: string): AllowanceSnapshot | null {
    const row = this.allowances.get(projectId);
    if (!row || row.ownerId !== ownerId) return null;
    const available = availableCents(row);
    return { ...row, availableCents: available, alert: alertForAllowance(row) };
  }

  setAllowance(input: {
    ownerId: string;
    projectId: string;
    allowanceCents: number;
    at?: string;
  }): { ok: true; snapshot: AllowanceSnapshot } | { ok: false; reason: string; message: string } {
    if (!Number.isInteger(input.allowanceCents) || input.allowanceCents < 0) {
      return { ok: false, reason: "INVALID_ALLOWANCE", message: "Allowance must be a non-negative integer cent amount." };
    }
    const at = input.at ?? new Date().toISOString();
    const existing = this.allowances.get(input.projectId);
    if (existing && existing.ownerId !== input.ownerId) {
      return { ok: false, reason: "OWNER_MISMATCH", message: "Cross-owner allowance mutation denied." };
    }
    const reserved = existing?.reservedCents ?? 0;
    const charged = existing?.chargedCents ?? 0;
    if (reserved + charged > input.allowanceCents) {
      return {
        ok: false,
        reason: "ALLOWANCE_BELOW_COMMITTED",
        message: "Cannot set allowance below reserved+charged commitments.",
      };
    }
    const row: ProjectAiAllowance = {
      projectId: input.projectId,
      ownerId: input.ownerId,
      allowanceCents: input.allowanceCents,
      reservedCents: reserved,
      chargedCents: charged,
      currency: "USD",
      updatedAt: at,
    };
    this.allowances.set(input.projectId, row);
    this.pushEvent({
      projectId: input.projectId,
      ownerId: input.ownerId,
      reservationId: null,
      eventType: "ADJUST_ALLOWANCE",
      amountCents: input.allowanceCents,
      detail: "Founder set project AI allowance",
      idempotencyKey: `allow-${input.projectId}-${at}`,
      at,
    });
    return { ok: true, snapshot: this.snapshot(input.ownerId, input.projectId)! };
  }

  reserve(input: {
    ownerId: string;
    projectId: string;
    taskKey: string;
    estimatedCents: number;
    idempotencyKey: string;
    at?: string;
  }):
    | { ok: true; reservation: AllowanceReservation; snapshot: AllowanceSnapshot }
    | { ok: false; reason: string; message: string } {
    const existingId = this.byIdem.get(`${input.ownerId}:${input.idempotencyKey}`);
    if (existingId) {
      const reservation = this.reservations.get(existingId)!;
      return { ok: true, reservation, snapshot: this.snapshot(input.ownerId, input.projectId)! };
    }
    if (!Number.isInteger(input.estimatedCents) || input.estimatedCents <= 0) {
      return { ok: false, reason: "INVALID_ESTIMATE", message: "Estimate must be a positive integer cent amount." };
    }
    const row = this.allowances.get(input.projectId);
    if (!row || row.ownerId !== input.ownerId) {
      return { ok: false, reason: "NOT_FOUND", message: "Allowance row not visible for owner/project." };
    }
    for (const r of this.reservations.values()) {
      if (r.projectId === input.projectId && r.taskKey === input.taskKey && r.status === "OPEN") {
        return { ok: false, reason: "DUPLICATE_OPEN_RESERVATION", message: "An open reservation already exists for this task." };
      }
    }
    const available = availableCents(row);
    if (available < input.estimatedCents) {
      return { ok: false, reason: "INSUFFICIENT_ALLOWANCE", message: "Available allowance is below estimated task cost." };
    }
    const at = input.at ?? new Date().toISOString();
    const id = randomUUID();
    row.reservedCents += input.estimatedCents;
    row.updatedAt = at;
    const reservation: AllowanceReservation = {
      id,
      projectId: input.projectId,
      ownerId: input.ownerId,
      taskKey: input.taskKey,
      estimatedCents: input.estimatedCents,
      status: "OPEN",
      idempotencyKey: input.idempotencyKey,
      createdAt: at,
      closedAt: null,
    };
    this.reservations.set(id, reservation);
    this.byIdem.set(`${input.ownerId}:${input.idempotencyKey}`, id);
    this.pushEvent({
      projectId: input.projectId,
      ownerId: input.ownerId,
      reservationId: id,
      eventType: "RESERVE",
      amountCents: input.estimatedCents,
      detail: "Reserved for in-flight AI task",
      idempotencyKey: `${input.idempotencyKey}:event`,
      at,
    });
    return { ok: true, reservation, snapshot: this.snapshot(input.ownerId, input.projectId)! };
  }

  reconcile(input: {
    ownerId: string;
    reservationId: string;
    actualCents: number;
    idempotencyKey: string;
    at?: string;
  }):
    | { ok: true; snapshot: AllowanceSnapshot }
    | { ok: false; reason: string; message: string } {
    if (this.byIdem.has(`${input.ownerId}:${input.idempotencyKey}`)) {
      return { ok: true, snapshot: this.snapshot(input.ownerId, this.reservations.get(input.reservationId)!.projectId)! };
    }
    if (!Number.isInteger(input.actualCents) || input.actualCents < 0) {
      return { ok: false, reason: "INVALID_ACTUAL", message: "Actual charge must be a non-negative integer cent amount." };
    }
    const reservation = this.reservations.get(input.reservationId);
    if (!reservation || reservation.ownerId !== input.ownerId) {
      return { ok: false, reason: "NOT_FOUND", message: "Reservation not visible." };
    }
    if (reservation.status !== "OPEN") {
      return { ok: false, reason: "NOT_OPEN", message: "Reservation is not open." };
    }
    if (input.actualCents > reservation.estimatedCents) {
      return {
        ok: false,
        reason: "ACTUAL_EXCEEDS_RESERVATION",
        message: "Actual usage exceeds reserved estimate — fail closed (increase estimate before retry).",
      };
    }
    const row = this.allowances.get(reservation.projectId);
    if (!row || row.ownerId !== input.ownerId) {
      return { ok: false, reason: "NOT_FOUND", message: "Allowance missing." };
    }
    const at = input.at ?? new Date().toISOString();
    row.reservedCents -= reservation.estimatedCents;
    row.chargedCents += input.actualCents;
    row.updatedAt = at;
    reservation.status = "RECONCILED";
    reservation.closedAt = at;
    this.byIdem.set(`${input.ownerId}:${input.idempotencyKey}`, reservation.id);
    this.pushEvent({
      projectId: reservation.projectId,
      ownerId: input.ownerId,
      reservationId: reservation.id,
      eventType: "CHARGE",
      amountCents: input.actualCents,
      detail: "Reconciled provider usage against reservation",
      idempotencyKey: input.idempotencyKey,
      at,
    });
    return { ok: true, snapshot: this.snapshot(input.ownerId, reservation.projectId)! };
  }

  release(input: {
    ownerId: string;
    reservationId: string;
    idempotencyKey: string;
    at?: string;
  }):
    | { ok: true; snapshot: AllowanceSnapshot }
    | { ok: false; reason: string; message: string } {
    if (this.byIdem.has(`${input.ownerId}:${input.idempotencyKey}`)) {
      const r = this.reservations.get(input.reservationId)!;
      return { ok: true, snapshot: this.snapshot(input.ownerId, r.projectId)! };
    }
    const reservation = this.reservations.get(input.reservationId);
    if (!reservation || reservation.ownerId !== input.ownerId) {
      return { ok: false, reason: "NOT_FOUND", message: "Reservation not visible." };
    }
    if (reservation.status !== "OPEN") {
      return { ok: false, reason: "NOT_OPEN", message: "Reservation is not open." };
    }
    const row = this.allowances.get(reservation.projectId)!;
    const at = input.at ?? new Date().toISOString();
    row.reservedCents -= reservation.estimatedCents;
    row.updatedAt = at;
    reservation.status = "RELEASED";
    reservation.closedAt = at;
    this.byIdem.set(`${input.ownerId}:${input.idempotencyKey}`, reservation.id);
    this.pushEvent({
      projectId: reservation.projectId,
      ownerId: input.ownerId,
      reservationId: reservation.id,
      eventType: "RELEASE",
      amountCents: reservation.estimatedCents,
      detail: "Released unused reservation",
      idempotencyKey: input.idempotencyKey,
      at,
    });
    return { ok: true, snapshot: this.snapshot(input.ownerId, reservation.projectId)! };
  }

  listEvents(ownerId: string, projectId: string): AllowanceUsageEvent[] {
    return this.events.filter((e) => e.ownerId === ownerId && e.projectId === projectId);
  }

  private pushEvent(input: {
    projectId: string;
    ownerId: string;
    reservationId: string | null;
    eventType: AllowanceUsageEvent["eventType"];
    amountCents: number;
    detail: string;
    idempotencyKey: string;
    at: string;
  }) {
    if (this.events.some((e) => e.ownerId === input.ownerId && e.idempotencyKey === input.idempotencyKey)) {
      return;
    }
    this.events.push({
      id: randomUUID(),
      projectId: input.projectId,
      ownerId: input.ownerId,
      reservationId: input.reservationId,
      eventType: input.eventType,
      amountCents: input.amountCents,
      detail: input.detail,
      idempotencyKey: input.idempotencyKey,
      createdAt: input.at,
    });
  }
}
