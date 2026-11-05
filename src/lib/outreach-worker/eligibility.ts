import type { SupabaseClient } from "@supabase/supabase-js";
import { loose } from "@/lib/db/loose";
import { normalizeEmail } from "./compliance";

export const OUTREACH_ELIGIBILITY_KINDS = ["opt_in", "documented_request"] as const;
export type OutreachEligibilityKind = (typeof OUTREACH_ELIGIBILITY_KINDS)[number];

export const OUTREACH_ELIGIBILITY_SCOPES = [
  "commercial_introduction",
  "service_website",
  "service_app",
  "service_ads",
  "service_wholesale",
  "follow_up",
] as const;
export type OutreachEligibilityScope = (typeof OUTREACH_ELIGIBILITY_SCOPES)[number];

export type EligibilityRecord = {
  id: string;
  kind: OutreachEligibilityKind;
  source: string;
  scope: OutreachEligibilityScope;
  recordedAt: string;
  recipientEmail: string;
  notes: string;
};

export type EligibilityCheck =
  | {
      ok: true;
      record: EligibilityRecord;
      requiredScope: OutreachEligibilityScope;
    }
  | {
      ok: false;
      reason: string;
      label: "Needs permission";
      requiredScope: OutreachEligibilityScope;
    };

export function isEligibilityKind(value: string): value is OutreachEligibilityKind {
  return (OUTREACH_ELIGIBILITY_KINDS as readonly string[]).includes(value);
}

export function isEligibilityScope(value: string): value is OutreachEligibilityScope {
  return (OUTREACH_ELIGIBILITY_SCOPES as readonly string[]).includes(value);
}

/** Exact scope required for the email about to be queued/sent. */
export function requiredEmailScope(input: {
  isFollowUp: boolean;
  serviceInterest?: string;
}): OutreachEligibilityScope {
  if (input.isFollowUp) return "follow_up";
  const service = (input.serviceInterest ?? "").trim();
  if (service === "website") return "service_website";
  if (service === "app") return "service_app";
  if (service === "ads") return "service_ads";
  if (service === "wholesale") return "service_wholesale";
  return "commercial_introduction";
}

export function scopeLabel(scope: OutreachEligibilityScope): string {
  switch (scope) {
    case "commercial_introduction":
      return "commercial introduction";
    case "service_website":
      return "website service outreach";
    case "service_app":
      return "app service outreach";
    case "service_ads":
      return "ads service outreach";
    case "service_wholesale":
      return "wholesale service outreach";
    case "follow_up":
      return "follow-up email";
  }
}

function asRecord(row: Record<string, unknown>): EligibilityRecord | null {
  const kind = String(row.kind ?? "");
  const scope = String(row.scope ?? "");
  if (!isEligibilityKind(kind) || !isEligibilityScope(scope)) return null;
  if (row.revoked_at) return null;
  return {
    id: String(row.id),
    kind,
    source: String(row.source ?? ""),
    scope,
    recordedAt: String(row.recorded_at ?? ""),
    recipientEmail: normalizeEmail(String(row.recipient_email ?? "")),
    notes: String(row.notes ?? ""),
  };
}

/**
 * Active eligibility must match recipient + exact email scope.
 * Founder approval is not a substitute for opt-in / documented request.
 */
export async function checkRecipientEligibility(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    opportunityId: string;
    recipientEmail: string;
    isFollowUp: boolean;
    serviceInterest?: string;
  },
): Promise<EligibilityCheck> {
  const requiredScope = requiredEmailScope({
    isFollowUp: input.isFollowUp,
    serviceInterest: input.serviceInterest,
  });
  const email = normalizeEmail(input.recipientEmail);
  if (!email) {
    return {
      ok: false,
      reason: "Recipient email required before permission can be evaluated.",
      label: "Needs permission",
      requiredScope,
    };
  }

  const query = await loose(supabase)
    .from("ceo_outreach_eligibility")
    .select("id, kind, source, scope, recorded_at, recipient_email, notes, revoked_at")
    .eq("company_id", input.companyId)
    .eq("opportunity_id", input.opportunityId)
    .eq("recipient_email", email)
    .eq("scope", requiredScope)
    .is("revoked_at", null)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (query.error) {
    if (/does not exist|schema cache/i.test(query.error.message)) {
      return {
        ok: false,
        reason:
          "Eligibility table missing — apply migration 20261105170000_ceo_outreach_eligibility.sql.",
        label: "Needs permission",
        requiredScope,
      };
    }
    return {
      ok: false,
      reason: query.error.message,
      label: "Needs permission",
      requiredScope,
    };
  }

  const record = query.data ? asRecord(query.data as Record<string, unknown>) : null;
  if (!record) {
    return {
      ok: false,
      reason: `Needs permission — record an opt-in or documented request covering ${scopeLabel(requiredScope)}. A public email address alone is not enough.`,
      label: "Needs permission",
      requiredScope,
    };
  }

  return { ok: true, record, requiredScope };
}

export async function loadLatestEligibilityForOpportunity(
  supabase: SupabaseClient,
  opportunityId: string,
): Promise<EligibilityRecord | null> {
  const query = await loose(supabase)
    .from("ceo_outreach_eligibility")
    .select("id, kind, source, scope, recorded_at, recipient_email, notes, revoked_at")
    .eq("opportunity_id", opportunityId)
    .is("revoked_at", null)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (query.error || !query.data) return null;
  return asRecord(query.data as Record<string, unknown>);
}

export async function loadEligibilityByOpportunityIds(
  supabase: SupabaseClient,
  opportunityIds: string[],
): Promise<Map<string, EligibilityRecord[]>> {
  const map = new Map<string, EligibilityRecord[]>();
  if (opportunityIds.length === 0) return map;
  const query = await loose(supabase)
    .from("ceo_outreach_eligibility")
    .select("id, kind, source, scope, recorded_at, recipient_email, notes, revoked_at, opportunity_id")
    .in("opportunity_id", opportunityIds)
    .is("revoked_at", null)
    .order("recorded_at", { ascending: false });
  for (const raw of query.data ?? []) {
    const row = raw as Record<string, unknown>;
    const record = asRecord(row);
    if (!record) continue;
    const oppId = String(row.opportunity_id);
    const list = map.get(oppId) ?? [];
    list.push(record);
    map.set(oppId, list);
  }
  return map;
}

/** UI helper: public email on file but no active eligibility for the likely send scope. */
export function needsPermissionLabel(input: {
  contactEmail: string;
  eligibility: EligibilityRecord[];
  serviceInterest?: string;
  isFollowUp?: boolean;
}): boolean {
  if (!input.contactEmail.trim()) return false;
  const required = requiredEmailScope({
    isFollowUp: Boolean(input.isFollowUp),
    serviceInterest: input.serviceInterest,
  });
  return !input.eligibility.some((row) => row.scope === required && !row.notes.includes("__revoked__"));
}
