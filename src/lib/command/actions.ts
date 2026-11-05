"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createAiAssignment } from "@/lib/assignments/actions";
import { getAccessContext, hasFounderSurface } from "@/lib/access/session-access";
import { recordActivity } from "@/lib/activity/record";
import { getSession } from "@/lib/auth/session";
import { isUuid, loose } from "@/lib/db/loose";
import { ACK_COOKIE, INBOX_READ_COOKIE, WORK_MODE_COOKIE } from "./cookies";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

async function requireFounder() {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { ok: false as const, error: "Sign in required." };
  }
  const access = await getAccessContext(session.supabase, session.user.id, session.user.email);
  if (!hasFounderSurface(access)) {
    return { ok: false as const, error: "Founder access required." };
  }
  return { ok: true as const, session, access };
}

/** Visual Work Mode only — not attendance or evidence. */
export async function setWorkMode(formData: FormData): Promise<void> {
  const mode = field(formData, "mode");
  const allowed = new Set(["desk", "home", "gym", "entertainment", "field"]);
  if (!allowed.has(mode)) return;
  const jar = await cookies();
  jar.set(WORK_MODE_COOKIE, mode, {
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
    sameSite: "lax",
  });
  revalidatePath("/command");
}

export async function markCommunicationsRead(formData: FormData): Promise<void> {
  const id = field(formData, "id");
  if (!id) return;
  const jar = await cookies();
  const existing = new Set(
    (jar.get(INBOX_READ_COOKIE)?.value ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
  existing.add(id.slice(0, 80));
  jar.set(INBOX_READ_COOKIE, [...existing].slice(-80).join(","), {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
  });
  revalidatePath("/communications");
  revalidatePath("/command");
}

export async function acknowledgeSentinelAlert(formData: FormData): Promise<void> {
  const auth = await requireFounder();
  if (!auth.ok) return;

  const alertId = field(formData, "alertId");
  const projectId = field(formData, "projectId");
  const companyId = field(formData, "companyId");
  const title = field(formData, "title") || "Alert";
  if (!alertId) return;

  const jar = await cookies();
  const existing = new Set(
    (jar.get(ACK_COOKIE)?.value ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
  existing.add(alertId.slice(0, 80));
  jar.set(ACK_COOKIE, [...existing].slice(-60).join(","), {
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
    sameSite: "lax",
  });

  if (isUuid(companyId) && isUuid(projectId)) {
    await recordActivity(auth.session.supabase, {
      companyId,
      projectId,
      actorKind: "PERSON",
      action: "sentinel.acknowledged",
      summary: `Acknowledged Sentinel alert: ${title.slice(0, 120)}`,
      recordType: "sentinel_alert",
      recordId: alertId.slice(0, 80),
      metadata: { alertId },
    });
  }

  revalidatePath("/command");
}

/**
 * Convert a qualified opportunity into a proposal research AI assignment (MOCK path).
 * Outreach stays draft/approval-gated — this never sends external mail.
 */
export async function convertOpportunityToProposalTask(formData: FormData): Promise<void> {
  const auth = await requireFounder();
  if (!auth.ok) return;

  const opportunityId = field(formData, "opportunityId");
  const projectId = field(formData, "projectId");
  if (!isUuid(opportunityId) || !isUuid(projectId)) return;

  const opp = await loose(auth.session.supabase)
    .from("ceo_opportunities")
    .select("id, company_id, title, value_cents, geography, fit_reason, status, owner_id")
    .eq("id", opportunityId)
    .eq("owner_id", auth.session.user.id)
    .maybeSingle();

  if (opp.error || !opp.data) return;

  const companyId = String(opp.data.company_id);
  if (!auth.access.ownedCompanyIds.includes(companyId)) return;

  const created = await createAiAssignment({
    projectId,
    companyId,
    title: `Proposal research: ${String(opp.data.title).slice(0, 120)}`,
    instructions: [
      "Research and draft a proposal outline for this opportunity.",
      `Geography: ${String(opp.data.geography || "unspecified")}`,
      `Fit notes: ${String(opp.data.fit_reason || "none recorded")}`,
      "Do not send outreach. Leave any customer communication as a draft for founder approval.",
      `Source opportunity id: ${opportunityId}`,
    ].join("\n"),
  });

  if (!created.ok) return;

  await loose(auth.session.supabase)
    .from("ceo_opportunities")
    .update({ status: "QUALIFIED", updated_at: new Date().toISOString() })
    .eq("id", opportunityId)
    .eq("owner_id", auth.session.user.id);

  await recordActivity(auth.session.supabase, {
    companyId,
    projectId,
    actorKind: "PERSON",
    action: "opportunity.proposal_task",
    summary: `Created proposal research task from opportunity “${String(opp.data.title)}”.`,
    recordType: "ceo_opportunity",
    recordId: opportunityId,
    metadata: { assignmentId: created.assignmentId },
  });

  revalidatePath("/command");
  revalidatePath(`/projects/${projectId}`);
}

/** Manual opportunity entry for Opportunity Radar. */
export async function createOpportunity(formData: FormData): Promise<void> {
  const auth = await requireFounder();
  if (!auth.ok) return;

  const companyId = field(formData, "companyId");
  const title = field(formData, "title");
  const geography = field(formData, "geography");
  const valueDollars = Number(field(formData, "valueDollars") || "0");
  const scoreRaw = field(formData, "score");
  const fitReason = field(formData, "fitReason");

  if (!isUuid(companyId) || !auth.access.ownedCompanyIds.includes(companyId)) return;
  if (title.length < 2 || title.length > 200) return;

  const valueCents = Math.max(0, Math.round(valueDollars * 100));
  const score =
    scoreRaw === "" ? null : Math.min(100, Math.max(0, Math.round(Number(scoreRaw) || 0)));

  await loose(auth.session.supabase).from("ceo_opportunities").insert({
    owner_id: auth.session.user.id,
    company_id: companyId,
    title,
    value_cents: valueCents,
    currency: "USD",
    score,
    geography: geography.slice(0, 120),
    status: "NEW",
    source: "manual",
    fit_reason: fitReason.slice(0, 2000),
  });

  revalidatePath("/command");
}

/** Manual finance row. Not payment processing. */
export async function createFinanceEntry(formData: FormData): Promise<void> {
  const auth = await requireFounder();
  if (!auth.ok) return;

  const companyId = field(formData, "companyId");
  const kind = field(formData, "kind").toUpperCase();
  const status = field(formData, "status").toUpperCase() || "CLEARED";
  const label = field(formData, "label") || "Manual entry";
  const amountDollars = Number(field(formData, "amountDollars") || "0");

  if (!isUuid(companyId) || !auth.access.ownedCompanyIds.includes(companyId)) return;
  if (!["CASH", "INVOICE", "EXPENSE", "REFUND"].includes(kind)) return;
  if (!["PENDING", "CLEARED", "VOID", "REFUNDED"].includes(status)) return;
  const amountCents = Math.round(amountDollars * 100);
  if (amountCents === 0) return;

  await loose(auth.session.supabase).from("ceo_finance_entries").insert({
    owner_id: auth.session.user.id,
    company_id: companyId,
    kind,
    amount_cents: amountCents,
    currency: "USD",
    status,
    label: label.slice(0, 200),
    source_ref: "manual-command",
    occurred_on: new Date().toISOString().slice(0, 10),
  });

  revalidatePath("/command");
  revalidatePath("/command/finance");
}
