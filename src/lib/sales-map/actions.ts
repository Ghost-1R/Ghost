"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { canViewMap, hasPermission, loadAccessContext } from "@/lib/access/permissions";
import { recordActivity } from "@/lib/activity/record";
import { createAiAssignment, createHumanAssignment } from "@/lib/assignments/actions";
import { sanitizeMapScope, type AssignmentResult, type MapScope } from "@/lib/assignments/types";
import { getSession } from "@/lib/auth/session";
import { isUuid, loose } from "@/lib/db/loose";
import { buildLabeledTestOrders, TEST_PROSPECTS } from "@/lib/sales-map/test-orders";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

type Result<T = object> = ({ ok: true; notice: string } & T) | { ok: false; error: string };

/** Owner-only: let a team member view this company's sales-map summaries. */
export async function grantMapAccess(input: {
  companyId: string;
  userId: string;
}): Promise<Result> {
  const session = await getSession();
  if (session.status !== "authenticated") return { ok: false, error: "Sign in required." };
  if (!isUuid(input.companyId) || !isUuid(input.userId)) {
    return { ok: false, error: "Choose a company and team member." };
  }
  const access = await loadAccessContext(session.supabase, session.user.id, session.user.email);
  if (!hasPermission(access, "map.grant", { companyId: input.companyId })) {
    return { ok: false, error: "Only the company owner can grant map access." };
  }

  const client = loose(session.supabase);
  const member = await client
    .from("company_memberships")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("user_id", input.userId)
    .is("revoked_at", null)
    .maybeSingle();
  if (!member.data?.id) {
    return { ok: false, error: "Map access can only be granted to an active team member of this company." };
  }

  const { error } = await client.from("company_map_grants").upsert(
    {
      company_id: input.companyId,
      user_id: input.userId,
      granted_by: session.user.id,
      can_view_summaries: true,
      revoked_at: null,
    },
    { onConflict: "company_id,user_id" },
  );
  if (error) return { ok: false, error: error.message };

  await recordActivity(session.supabase, {
    companyId: input.companyId,
    projectId: null,
    actorKind: "PERSON",
    action: "map.access_granted",
    summary: "Granted a team member access to the sales map summaries.",
    recordType: "company_map_grant",
    metadata: { userId: input.userId },
  });
  revalidatePath(`/companies/${input.companyId}/map`);
  return { ok: true, notice: "Map access granted (aggregate summaries only)." };
}

/**
 * Owner-only: upsert labeled TEST orders (first-time, returning, refund, pickup,
 * missing ZIP) plus two TEST prospects, and mark the sync source as test data.
 */
export async function seedTestOrders(input: { companyId: string }): Promise<Result<{ orders: number }>> {
  const session = await getSession();
  if (session.status !== "authenticated") return { ok: false, error: "Sign in required." };
  if (!isUuid(input.companyId)) return { ok: false, error: "Choose a company." };
  const access = await loadAccessContext(session.supabase, session.user.id, session.user.email);
  if (!hasPermission(access, "map.grant", { companyId: input.companyId })) {
    return { ok: false, error: "Only the company owner can seed test orders." };
  }

  const client = loose(session.supabase);
  const labeled = buildLabeledTestOrders(input.companyId);
  const orders = await client
    .from("company_orders")
    .upsert(
      labeled.map((entry) => entry.row),
      { onConflict: "company_id,external_order_id" },
    );
  if (orders.error) {
    return {
      ok: false,
      error: /company_orders|schema cache|does not exist/i.test(orders.error.message)
        ? "Sales map tables are not available on this database yet. Apply the companies/team/assignments migration."
        : orders.error.message,
    };
  }

  const existing = await client
    .from("company_prospects")
    .select("label")
    .eq("company_id", input.companyId)
    .like("label", "TEST prospect%");
  const have = new Set(((existing.data ?? []) as Array<{ label: string }>).map((row) => row.label));
  const missing = TEST_PROSPECTS.filter((prospect) => !have.has(prospect.label)).map((prospect) => ({
    company_id: input.companyId,
    label: prospect.label,
    zip: prospect.zip,
    state_code: prospect.state_code,
    notes: "Labeled test prospect — not a customer.",
  }));
  if (missing.length > 0) await client.from("company_prospects").insert(missing);

  const sync = await client.from("company_sales_sync").upsert(
    {
      company_id: input.companyId,
      source_label: "Labeled test orders",
      last_synced_at: new Date().toISOString(),
      history_complete: true,
      notes: "Seeded test orders (first-time, returning, refund, pickup, missing ZIP). Not a live store connection.",
    },
    { onConflict: "company_id" },
  );
  if (sync.error) return { ok: false, error: sync.error.message };

  await recordActivity(session.supabase, {
    companyId: input.companyId,
    projectId: null,
    actorKind: "PERSON",
    action: "map.test_orders_seeded",
    summary: `Seeded ${labeled.length} labeled test orders for the sales map.`,
    recordType: "company_orders",
    metadata: { count: labeled.length, isTest: true },
  });
  revalidatePath(`/companies/${input.companyId}/map`);
  return {
    ok: true,
    orders: labeled.length,
    notice: `Seeded ${labeled.length} labeled test orders (first-time, returning, refund, pickup, missing ZIP).`,
  };
}

/**
 * Assignment for a selected map area. Wraps createHumanAssignment / createAiAssignment and
 * stores the aggregate-only scope in work_assignments.map_scope. Caller must be able to view
 * the company's map.
 */
export async function createMapAreaAssignment(input: {
  kind: "HUMAN" | "AI";
  projectId: string;
  companyId: string;
  nextActionId?: string | null;
  title: string;
  instructions: string;
  dueAt?: string | null;
  assigneeUserId?: string;
  mapScope: MapScope;
}): Promise<AssignmentResult> {
  const session = await getSession();
  if (session.status !== "authenticated") return { ok: false, error: "Sign in required." };
  const access = await loadAccessContext(session.supabase, session.user.id, session.user.email);
  if (!canViewMap(access, input.companyId)) {
    return { ok: false, error: "You do not have access to this company's sales map." };
  }
  const mapScope = sanitizeMapScope(input.mapScope);
  if (!mapScope) return { ok: false, error: "Select a state, ZIP area, or radius first." };

  const common = {
    projectId: input.projectId,
    companyId: input.companyId,
    nextActionId: input.nextActionId ?? null,
    title: input.title,
    instructions: input.instructions,
    mapScope,
  };
  if (input.kind === "AI") return createAiAssignment(common);
  return createHumanAssignment({
    ...common,
    dueAt: input.dueAt ?? null,
    assigneeUserId: input.assigneeUserId ?? "",
  });
}

export async function submitGrantMapAccessForm(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await grantMapAccess({
    companyId: field(formData, "companyId"),
    userId: field(formData, "userId"),
  });
  return result.ok ? { error: null, notice: result.notice } : { error: result.error, notice: null };
}

export async function submitSeedTestOrdersForm(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await seedTestOrders({ companyId: field(formData, "companyId") });
  return result.ok ? { error: null, notice: result.notice } : { error: result.error, notice: null };
}

/** Form entry for AssignWorkPanel on the map page (requires mapScopeJson). */
export async function submitMapAreaAssignmentForm(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (field(formData, "previewConfirmed") !== "yes") {
    return { error: "Preview the assignment and confirm before submitting.", notice: null };
  }
  const session = await getSession();
  if (session.status !== "authenticated") return { error: "Sign in required.", notice: null };

  const projectId = field(formData, "projectId");
  if (!isUuid(projectId)) return { error: "Choose a project.", notice: null };
  const project = await loose(session.supabase)
    .from("projects")
    .select("company_id")
    .eq("id", projectId)
    .maybeSingle();
  const companyId = project.data?.company_id as string | undefined;
  if (!companyId) return { error: "Project was not found.", notice: null };

  let mapScope: MapScope | null = null;
  try {
    mapScope = sanitizeMapScope(JSON.parse(field(formData, "mapScopeJson") || "null"));
  } catch {
    mapScope = null;
  }
  if (!mapScope) return { error: "Select a state, ZIP area, or radius first.", notice: null };

  const result = await createMapAreaAssignment({
    kind: field(formData, "assignKind") === "AI" ? "AI" : "HUMAN",
    projectId,
    companyId,
    nextActionId: field(formData, "nextActionId") || null,
    title: field(formData, "title"),
    instructions: field(formData, "instructions"),
    dueAt: field(formData, "dueAt") || null,
    assigneeUserId: field(formData, "assigneeUserId"),
    mapScope,
  });
  return result.ok ? { error: null, notice: result.notice } : { error: result.error, notice: null };
}
