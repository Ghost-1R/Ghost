/**
 * SQL-backed Ghost Allowance V1 ledger (disposable / authenticated RPC).
 * Authority for real spending paths — not MemoryAllowanceLedger.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GhostClient } from "@/lib/auth/session";
import { fromError, type QueryResult } from "@/lib/result";
import { alertForAllowance, availableCents, type AllowanceSnapshot } from "./types";

export type SqlReserveResult =
  | { ok: true; reservationId: string; snapshot: AllowanceSnapshot }
  | { ok: false; reason: string; message: string };

/** Untyped client — allowance tables/RPCs may precede generated Database types. */
function db(supabase: GhostClient): SupabaseClient {
  return supabase as unknown as SupabaseClient;
}

function mapRpcError(message: string): { reason: string; message: string } {
  if (/INSUFFICIENT_ALLOWANCE/i.test(message)) {
    return { reason: "INSUFFICIENT_ALLOWANCE", message: "Available allowance is below estimated task cost." };
  }
  if (/INVALID_ESTIMATE/i.test(message)) {
    return { reason: "INVALID_ESTIMATE", message: "Estimate must be a positive integer cent amount." };
  }
  if (/ACTUAL_EXCEEDS_RESERVATION/i.test(message)) {
    return { reason: "ACTUAL_EXCEEDS_RESERVATION", message: "Actual usage exceeds reserved estimate." };
  }
  if (/NOT_OPEN/i.test(message)) {
    return { reason: "NOT_OPEN", message: "Reservation is not open." };
  }
  if (/NOT_FOUND/i.test(message)) {
    return { reason: "NOT_FOUND", message: "Allowance or reservation not visible." };
  }
  if (/OWNER_MISMATCH/i.test(message)) {
    return { reason: "OWNER_MISMATCH", message: "Allowance operations require the owning founder session." };
  }
  if (/duplicate key|unique/i.test(message)) {
    return { reason: "DUPLICATE_OPEN_RESERVATION", message: "Duplicate open reservation or idempotency conflict." };
  }
  return { reason: "ALLOWANCE_RPC_FAILED", message };
}

export async function loadSqlAllowanceSnapshot(
  supabase: GhostClient,
  ownerId: string,
  projectId: string,
): Promise<QueryResult<AllowanceSnapshot & { provisioned: boolean }>> {
  const { data, error } = await db(supabase)
    .from("project_ai_allowances")
    .select("project_id, owner_id, allowance_cents, reserved_cents, charged_cents, currency, updated_at")
    .eq("owner_id", ownerId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) return fromError(error);
  if (!data) {
    const empty = {
      projectId,
      ownerId,
      allowanceCents: 0,
      reservedCents: 0,
      chargedCents: 0,
      currency: "USD" as const,
      updatedAt: new Date(0).toISOString(),
    };
    return {
      status: "ok",
      data: {
        ...empty,
        availableCents: 0,
        alert: alertForAllowance(empty, 100),
        provisioned: false,
      },
    };
  }

  const row = data as {
    project_id: string;
    owner_id: string;
    allowance_cents: number;
    reserved_cents: number;
    charged_cents: number;
    currency: "USD";
    updated_at: string;
  };
  const base = {
    projectId: row.project_id,
    ownerId: row.owner_id,
    allowanceCents: Number(row.allowance_cents),
    reservedCents: Number(row.reserved_cents),
    chargedCents: Number(row.charged_cents),
    currency: row.currency,
    updatedAt: row.updated_at,
  };
  return {
    status: "ok",
    data: {
      ...base,
      availableCents: availableCents(base),
      alert: alertForAllowance(base),
      provisioned: true,
    },
  };
}

export async function setSqlProjectAllowance(
  supabase: GhostClient,
  input: { ownerId: string; projectId: string; allowanceCents: number },
): Promise<QueryResult<AllowanceSnapshot>> {
  if (!Number.isInteger(input.allowanceCents) || input.allowanceCents < 0) {
    return { status: "error", message: "Allowance must be a non-negative integer cent amount." };
  }
  const { data, error } = await db(supabase)
    .from("project_ai_allowances")
    .upsert(
      {
        project_id: input.projectId,
        owner_id: input.ownerId,
        allowance_cents: input.allowanceCents,
        reserved_cents: 0,
        charged_cents: 0,
        currency: "USD",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id" },
    )
    .select("project_id, owner_id, allowance_cents, reserved_cents, charged_cents, currency, updated_at")
    .single();

  if (error) {
    // Upsert may fail when reserved+charged > new allowance — reload and update carefully.
    const existing = await loadSqlAllowanceSnapshot(supabase, input.ownerId, input.projectId);
    if (existing.status !== "ok" || !existing.data.provisioned) return fromError(error);
    const { data: updated, error: updErr } = await db(supabase)
      .from("project_ai_allowances")
      .update({
        allowance_cents: input.allowanceCents,
        updated_at: new Date().toISOString(),
      })
      .eq("project_id", input.projectId)
      .eq("owner_id", input.ownerId)
      .select("project_id, owner_id, allowance_cents, reserved_cents, charged_cents, currency, updated_at")
      .single();
    if (updErr || !updated) return fromError(updErr ?? { message: "Allowance update failed." });
    const row = updated as {
      project_id: string;
      owner_id: string;
      allowance_cents: number;
      reserved_cents: number;
      charged_cents: number;
      currency: "USD";
      updated_at: string;
    };
    const base = {
      projectId: row.project_id,
      ownerId: row.owner_id,
      allowanceCents: Number(row.allowance_cents),
      reservedCents: Number(row.reserved_cents),
      chargedCents: Number(row.charged_cents),
      currency: row.currency,
      updatedAt: row.updated_at,
    };
    return { status: "ok", data: { ...base, availableCents: availableCents(base), alert: alertForAllowance(base) } };
  }

  const row = data as {
    project_id: string;
    owner_id: string;
    allowance_cents: number;
    reserved_cents: number;
    charged_cents: number;
    currency: "USD";
    updated_at: string;
  };
  const base = {
    projectId: row.project_id,
    ownerId: row.owner_id,
    allowanceCents: Number(row.allowance_cents),
    reservedCents: Number(row.reserved_cents),
    chargedCents: Number(row.charged_cents),
    currency: row.currency,
    updatedAt: row.updated_at,
  };
  return { status: "ok", data: { ...base, availableCents: availableCents(base), alert: alertForAllowance(base) } };
}

export async function reserveSqlAllowance(
  supabase: GhostClient,
  input: {
    ownerId: string;
    projectId: string;
    taskKey: string;
    estimatedCents: number;
    idempotencyKey: string;
  },
): Promise<SqlReserveResult> {
  const { data, error } = await db(supabase).rpc("reserve_project_ai_allowance", {
    p_owner_id: input.ownerId,
    p_project_id: input.projectId,
    p_task_key: input.taskKey,
    p_estimated_cents: input.estimatedCents,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    const mapped = mapRpcError(error.message);
    return { ok: false, reason: mapped.reason, message: mapped.message };
  }
  const snapshot = await loadSqlAllowanceSnapshot(supabase, input.ownerId, input.projectId);
  if (snapshot.status !== "ok") {
    return { ok: false, reason: "SNAPSHOT_FAILED", message: snapshot.message };
  }
  return { ok: true, reservationId: String(data), snapshot: snapshot.data };
}

export async function reconcileSqlAllowance(
  supabase: GhostClient,
  input: {
    ownerId: string;
    reservationId: string;
    actualCents: number;
    idempotencyKey: string;
  },
): Promise<SqlReserveResult> {
  const { error } = await db(supabase).rpc("reconcile_project_ai_allowance", {
    p_owner_id: input.ownerId,
    p_reservation_id: input.reservationId,
    p_actual_cents: input.actualCents,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    const mapped = mapRpcError(error.message);
    return { ok: false, reason: mapped.reason, message: mapped.message };
  }
  // Need project id from reservation
  const { data: res } = await db(supabase)
    .from("project_ai_allowance_reservations")
    .select("project_id")
    .eq("id", input.reservationId)
    .eq("owner_id", input.ownerId)
    .maybeSingle();
  const projectId = (res as { project_id?: string } | null)?.project_id;
  if (!projectId) {
    return { ok: false, reason: "NOT_FOUND", message: "Reservation missing after reconcile." };
  }
  const snapshot = await loadSqlAllowanceSnapshot(supabase, input.ownerId, projectId);
  if (snapshot.status !== "ok") {
    return { ok: false, reason: "SNAPSHOT_FAILED", message: snapshot.message };
  }
  return { ok: true, reservationId: input.reservationId, snapshot: snapshot.data };
}

export async function releaseSqlAllowance(
  supabase: GhostClient,
  input: {
    ownerId: string;
    reservationId: string;
    idempotencyKey: string;
  },
): Promise<SqlReserveResult> {
  const { error } = await db(supabase).rpc("release_project_ai_allowance", {
    p_owner_id: input.ownerId,
    p_reservation_id: input.reservationId,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    const mapped = mapRpcError(error.message);
    return { ok: false, reason: mapped.reason, message: mapped.message };
  }
  const { data: res } = await db(supabase)
    .from("project_ai_allowance_reservations")
    .select("project_id")
    .eq("id", input.reservationId)
    .eq("owner_id", input.ownerId)
    .maybeSingle();
  const projectId = (res as { project_id?: string } | null)?.project_id;
  if (!projectId) {
    return { ok: false, reason: "NOT_FOUND", message: "Reservation missing after release." };
  }
  const snapshot = await loadSqlAllowanceSnapshot(supabase, input.ownerId, projectId);
  if (snapshot.status !== "ok") {
    return { ok: false, reason: "SNAPSHOT_FAILED", message: snapshot.message };
  }
  return { ok: true, reservationId: input.reservationId, snapshot: snapshot.data };
}
