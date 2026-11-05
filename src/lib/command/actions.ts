"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createAiAssignment } from "@/lib/assignments/actions";
import { getAccessContext, hasFounderSurface } from "@/lib/access/session-access";
import { recordActivity } from "@/lib/activity/record";
import { getSession } from "@/lib/auth/session";
import { isUuid, loose } from "@/lib/db/loose";
import { searchProspectsWithBrave, type ProspectSearchResult } from "./brave-search";
import { ACK_COOKIE, INBOX_READ_COOKIE, WORK_MODE_COOKIE } from "./cookies";
import {
  isMockSourceUrl,
  isOutreachService,
  isOutreachStage,
  nextOutreachStage,
  type OutreachAction,
  type OutreachStage,
} from "./outreach";

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

  const project = await loose(auth.session.supabase)
    .from("projects")
    .select("id, company_id")
    .eq("id", projectId)
    .maybeSingle();
  if (project.error || !project.data || String(project.data.company_id) !== companyId) {
    return;
  }

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

/** Brave Search (or labeled MOCK) for Opportunity Radar Find prospects. */
export async function searchProspects(formData: FormData): Promise<ProspectSearchResult> {
  const auth = await requireFounder();
  if (!auth.ok) {
    return {
      ok: false,
      mode: "error",
      setupMessage: auth.error,
      query: "",
      results: [],
    };
  }
  return searchProspectsWithBrave({
    businessType: field(formData, "businessType"),
    city: field(formData, "city"),
  });
}

export type SaveProspectResult =
  | { ok: true; notice: string; opportunityId: string }
  | { ok: false; error: string };

/**
 * Save a verified prospect under a company the founder owns.
 * Deduplicates by company_id + source_url. Does not send email.
 * MOCK source URLs are stored as is_mock and excluded from outreach.
 */
export async function saveProspect(formData: FormData): Promise<SaveProspectResult> {
  const auth = await requireFounder();
  if (!auth.ok) return { ok: false, error: auth.error };

  const companyId = field(formData, "companyId");
  const title = field(formData, "title");
  const geography = field(formData, "geography");
  const sourceUrl = field(formData, "sourceUrl");
  const contactEmail = field(formData, "contactEmail").toLowerCase();
  const fitReason = field(formData, "fitReason");
  const industry = field(formData, "industry").slice(0, 120);
  const market = (field(formData, "market") || geography).slice(0, 120);
  const serviceRaw = field(formData, "serviceInterest");
  const serviceInterest = isOutreachService(serviceRaw) ? serviceRaw : "";
  const mockLead = isMockSourceUrl(sourceUrl);

  if (!isUuid(companyId) || !auth.access.ownedCompanyIds.includes(companyId)) {
    return { ok: false, error: "Choose a company you own." };
  }
  if (title.length < 2 || title.length > 200) {
    return { ok: false, error: "Business name must be 2–200 characters." };
  }
  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl) || sourceUrl.length > 2000) {
    return { ok: false, error: "Source URL must be an http(s) link." };
  }
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return { ok: false, error: "Contact email looks invalid." };
  }

  const existing = await loose(auth.session.supabase)
    .from("ceo_opportunities")
    .select("id")
    .eq("company_id", companyId)
    .eq("source_url", sourceUrl)
    .maybeSingle();
  if (existing.data?.id) {
    return {
      ok: false,
      error: "This prospect is already saved for that company (same source URL).",
    };
  }

  const inserted = await loose(auth.session.supabase)
    .from("ceo_opportunities")
    .insert({
      owner_id: auth.session.user.id,
      company_id: companyId,
      title,
      value_cents: 0,
      currency: "USD",
      score: null,
      geography: geography.slice(0, 120),
      status: "PROSPECT",
      source: mockLead ? "brave_search_mock" : "brave_search",
      fit_reason: (fitReason || "Saved from Opportunity Radar prospect discovery.").slice(0, 2000),
      source_url: sourceUrl,
      contact_email: contactEmail.slice(0, 320),
      outreach_stage: "new",
      service_interest: serviceInterest,
      industry,
      market,
      is_mock: mockLead,
    })
    .select("id")
    .maybeSingle();

  if (inserted.error) {
    if (/ceo_opportunities_company_source_url|duplicate|unique/i.test(inserted.error.message)) {
      return {
        ok: false,
        error: "This prospect is already saved for that company (same source URL).",
      };
    }
    if (/source_url|contact_email|outreach_stage|is_mock|schema cache|does not exist/i.test(inserted.error.message)) {
      return {
        ok: false,
        error:
          "Prospect/outreach columns are missing. Apply ceo_opportunity_prospects and ceo_opportunity_outreach_pipeline migrations on the disposable database.",
      };
    }
    return { ok: false, error: inserted.error.message };
  }

  const opportunityId = String(inserted.data?.id ?? "");
  revalidatePath("/command");
  if (mockLead) {
    return {
      ok: true,
      opportunityId,
      notice: "MOCK prospect stored for reference only — it is hidden from the outreach pipeline.",
    };
  }
  return {
    ok: true,
    opportunityId,
    notice: contactEmail
      ? "Prospect saved to New leads. You can open an email draft after Move to review — Ghost will not send it."
      : "Prospect saved to New leads. Move to review when you are ready to verify a public email.",
  };
}

export type OutreachUpdateResult =
  | { ok: true; notice: string; stage: OutreachStage }
  | { ok: false; error: string };

/**
 * Advance or update an outreach lead. Opening an email draft is client-only and
 * must never call this with mark_sent — Mark as sent is the founder's confirmation.
 */
export async function updateOutreachLead(formData: FormData): Promise<OutreachUpdateResult> {
  const auth = await requireFounder();
  if (!auth.ok) return { ok: false, error: auth.error };

  const opportunityId = field(formData, "opportunityId");
  const actionRaw = field(formData, "action") as OutreachAction;
  const allowedActions: OutreachAction[] = [
    "move_to_review",
    "close",
    "save_email",
    "mark_sent",
    "mark_replied",
    "mark_won",
    "save_details",
  ];
  if (!isUuid(opportunityId) || !allowedActions.includes(actionRaw)) {
    return { ok: false, error: "Invalid outreach update." };
  }

  const existing = await loose(auth.session.supabase)
    .from("ceo_opportunities")
    .select(
      "id, company_id, owner_id, outreach_stage, contact_email, source_url, is_mock, service_interest, industry, market, fit_reason, follow_up_on, sent_at, outreach_draft, outreach_subject",
    )
    .eq("id", opportunityId)
    .maybeSingle();

  if (existing.error) {
    return { ok: false, error: existing.error.message };
  }
  if (!existing.data) {
    return { ok: false, error: "Lead not found." };
  }

  const row = existing.data as Record<string, unknown>;
  const companyId = String(row.company_id);
  if (!auth.access.ownedCompanyIds.includes(companyId)) {
    return { ok: false, error: "You can only update leads for companies you own." };
  }

  const isMock = Boolean(row.is_mock) || isMockSourceUrl(String(row.source_url ?? ""));
  if (isMock) {
    return { ok: false, error: "MOCK leads are excluded from outreach actions." };
  }

  const currentStage = isOutreachStage(String(row.outreach_stage ?? "new"))
    ? (String(row.outreach_stage) as OutreachStage)
    : "new";
  const nextStage = nextOutreachStage(currentStage, actionRaw);
  if (!nextStage) {
    return { ok: false, error: `Cannot ${actionRaw.replaceAll("_", " ")} from ${currentStage}.` };
  }

  const patch: Record<string, unknown> = {
    outreach_stage: nextStage,
    updated_at: new Date().toISOString(),
  };

  if (actionRaw === "save_email" || actionRaw === "save_details" || actionRaw === "mark_sent") {
    const email = field(formData, "contactEmail").toLowerCase();
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { ok: false, error: "Contact email looks invalid." };
      }
      patch.contact_email = email.slice(0, 320);
    } else if (actionRaw === "save_email") {
      return { ok: false, error: "Enter a verified business email first." };
    } else if (actionRaw === "mark_sent" && !String(row.contact_email ?? "").trim()) {
      return { ok: false, error: "Save a verified business email before marking sent." };
    }
  }

  if (actionRaw === "save_details" || actionRaw === "move_to_review") {
    const fitReason = field(formData, "fitReason");
    if (fitReason) patch.fit_reason = fitReason.slice(0, 2000);
    const industry = field(formData, "industry");
    if (industry || actionRaw === "save_details") patch.industry = industry.slice(0, 120);
    const market = field(formData, "market");
    if (market || actionRaw === "save_details") patch.market = market.slice(0, 120);
    const serviceRaw = field(formData, "serviceInterest");
    if (serviceRaw === "" || isOutreachService(serviceRaw)) {
      patch.service_interest = serviceRaw;
    }
  }

  const draftBody = field(formData, "outreachDraft");
  const draftSubject = field(formData, "outreachSubject");
  if (draftBody) patch.outreach_draft = draftBody.slice(0, 4000);
  if (draftSubject) patch.outreach_subject = draftSubject.slice(0, 300);

  if (actionRaw === "mark_sent") {
    // Manual confirmation only (mailto path). Outreach worker moves to sent after provider acceptance.
    if (currentStage === "queued" || currentStage === "sending") {
      return {
        ok: false,
        error: "This lead is in the Outreach send queue — wait for provider acceptance or cancel from Needs attention.",
      };
    }
    const followUpOn = field(formData, "followUpOn");
    patch.sent_at = new Date().toISOString();
    if (followUpOn) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(followUpOn)) {
        return { ok: false, error: "Follow-up date must be YYYY-MM-DD." };
      }
      patch.follow_up_on = followUpOn;
    }
  }

  const updated = await loose(auth.session.supabase)
    .from("ceo_opportunities")
    .update(patch)
    .eq("id", opportunityId)
    .eq("company_id", companyId)
    .select("id, outreach_stage")
    .maybeSingle();

  if (updated.error) {
    if (/outreach_stage|is_mock|follow_up_on|sent_at|outreach_subject|schema cache|does not exist/i.test(updated.error.message)) {
      return {
        ok: false,
        error:
          "Outreach columns are missing. Apply migrations through 20261105160000_ceo_outreach_worker.sql.",
      };
    }
    return { ok: false, error: updated.error.message };
  }
  if (!updated.data) {
    return { ok: false, error: "Update denied — check company ownership." };
  }

  // Editing recipient/subject/body after Approve & queue requires fresh approval.
  if (actionRaw === "save_email" || actionRaw === "save_details") {
    const { invalidateOutreachApprovalIfChanged } = await import("@/lib/outreach-worker/actions");
    await invalidateOutreachApprovalIfChanged({
      supabase: auth.session.supabase,
      opportunityId,
      companyId,
      recipientEmail: String(patch.contact_email ?? row.contact_email ?? ""),
      subject: String(patch.outreach_subject ?? row.outreach_subject ?? ""),
      body: String(patch.outreach_draft ?? row.outreach_draft ?? ""),
    });
  }

  revalidatePath("/command");
  const notices: Record<OutreachAction, string> = {
    move_to_review: "Moved to Waiting for approval.",
    close: "Lead closed.",
    save_email: "Business email saved. Opening a draft will not mark this as sent.",
    mark_sent: "Marked as sent (manual). Ghost did not send via Outreach worker.",
    mark_replied: "Moved to Replied.",
    mark_won: "Marked as won.",
    save_details: "Lead details saved.",
  };
  return { ok: true, notice: notices[actionRaw], stage: nextStage };
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

  const industry = field(formData, "industry").slice(0, 120);
  const market = (field(formData, "market") || geography).slice(0, 120);
  const serviceRaw = field(formData, "serviceInterest");
  const serviceInterest = isOutreachService(serviceRaw) ? serviceRaw : "";

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
    outreach_stage: "new",
    service_interest: serviceInterest,
    industry,
    market,
    is_mock: false,
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
