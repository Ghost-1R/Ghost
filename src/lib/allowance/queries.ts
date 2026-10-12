import type { GhostClient } from "@/lib/auth/session";
import { fromError, type QueryResult } from "@/lib/result";
import {
  alertForAllowance,
  availableCents,
  type AllowanceSnapshot,
} from "./types";

function isMissingTable(message: string): boolean {
  return /project_ai_allowances|schema cache|does not exist/i.test(message);
}

/**
 * Load owner-scoped Ghost Allowance V1 snapshot for a project.
 * Missing schema or missing row → honest empty snapshot (0 available), not fabricated funds.
 */
export async function loadProjectAllowanceSnapshot(
  supabase: GhostClient,
  ownerId: string,
  projectId: string,
  nextEstimateCents = 0,
): Promise<QueryResult<AllowanceSnapshot & { provisioned: boolean }>> {
  const { data, error } = await supabase
    .from("project_ai_allowances")
    .select("project_id, owner_id, allowance_cents, reserved_cents, charged_cents, currency, updated_at")
    .eq("owner_id", ownerId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) {
    if (isMissingTable(error.message)) {
      return {
        status: "error",
        message: "Ghost Allowance schema is not available in this environment.",
      };
    }
    return fromError(error);
  }

  if (!data) {
    return {
      status: "ok",
      data: {
        projectId,
        ownerId,
        allowanceCents: 0,
        reservedCents: 0,
        chargedCents: 0,
        currency: "USD",
        updatedAt: new Date(0).toISOString(),
        availableCents: 0,
        alert: alertForAllowance(
          { allowanceCents: 0, reservedCents: 0, chargedCents: 0 },
          nextEstimateCents,
        ),
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

  if (row.owner_id !== ownerId) {
    return { status: "error", message: "Cross-owner allowance access denied." };
  }

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
      alert: alertForAllowance(base, nextEstimateCents),
      provisioned: true,
    },
  };
}
