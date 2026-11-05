"use server";

import { revalidatePath } from "next/cache";
import { getAccessContext, hasFounderSurface } from "@/lib/access/session-access";
import { getSession } from "@/lib/auth/session";
import { loose } from "@/lib/db/loose";
import { leadWorkerServiceClient, leadWorkersEnvEnabled } from "./db";
import { runLeadWorkerTick } from "./tick";

async function requireFounderOwnerOfConfig() {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { ok: false as const, error: "Sign in required." };
  }
  const access = await getAccessContext(session.supabase, session.user.id, session.user.email);
  if (!hasFounderSurface(access)) {
    return { ok: false as const, error: "Founder access required." };
  }
  const config = await loose(session.supabase)
    .from("ceo_lead_worker_config")
    .select("id, company_id, enabled, paused")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (config.error) {
    return { ok: false as const, error: config.error.message };
  }
  if (!config.data) {
    return { ok: false as const, error: "Lead worker config missing." };
  }
  const companyId = String(config.data.company_id ?? "");
  if (!companyId || !access.ownedCompanyIds.includes(companyId)) {
    return { ok: false as const, error: "You must own Badger United to control lead workers." };
  }
  return { ok: true as const, session, access, configId: String(config.data.id), companyId };
}

export type LeadWorkerControlResult = { ok: true; notice: string } | { ok: false; error: string };

export async function setLeadWorkerScheduler(formData: FormData): Promise<LeadWorkerControlResult> {
  const auth = await requireFounderOwnerOfConfig();
  if (!auth.ok) return { ok: false, error: auth.error };
  const enabled = String(formData.get("enabled") ?? "") === "1";
  const updated = await loose(auth.session.supabase)
    .from("ceo_lead_worker_config")
    .update({
      enabled,
      paused: enabled ? false : true,
      last_blocker: enabled ? "" : "Scheduler disabled by founder.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", auth.configId)
    .select("id")
    .maybeSingle();
  if (updated.error) return { ok: false, error: updated.error.message };
  revalidatePath("/command");
  return {
    ok: true,
    notice: enabled
      ? leadWorkersEnvEnabled()
        ? "Scheduler enabled. Keep the lead-worker process running for unattended ticks."
        : "DB enabled. Also set GHOST_LEAD_WORKERS_ENABLED=1 and run the worker/cron for unattended ticks."
      : "Scheduler disabled.",
  };
}

export async function pauseLeadWorkers(): Promise<LeadWorkerControlResult> {
  const auth = await requireFounderOwnerOfConfig();
  if (!auth.ok) return { ok: false, error: auth.error };
  const updated = await loose(auth.session.supabase)
    .from("ceo_lead_worker_config")
    .update({
      paused: true,
      last_blocker: "Scheduler paused by founder.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", auth.configId);
  if (updated.error) return { ok: false, error: updated.error.message };
  revalidatePath("/command");
  return { ok: true, notice: "Lead workers paused." };
}

export async function resumeLeadWorkers(): Promise<LeadWorkerControlResult> {
  const auth = await requireFounderOwnerOfConfig();
  if (!auth.ok) return { ok: false, error: auth.error };
  const updated = await loose(auth.session.supabase)
    .from("ceo_lead_worker_config")
    .update({
      paused: false,
      enabled: true,
      last_blocker: "",
      updated_at: new Date().toISOString(),
    })
    .eq("id", auth.configId);
  if (updated.error) return { ok: false, error: updated.error.message };
  revalidatePath("/command");
  return {
    ok: true,
    notice: leadWorkersEnvEnabled()
      ? "Lead workers resumed."
      : "Resumed in DB. Set GHOST_LEAD_WORKERS_ENABLED=1 for the background loop/cron.",
  };
}

export async function runLeadWorkersNow(): Promise<LeadWorkerControlResult> {
  const auth = await requireFounderOwnerOfConfig();
  if (!auth.ok) return { ok: false, error: auth.error };

  // Ensure enabled for a manual run; still respects Brave key, quota, and single-active lease.
  await loose(auth.session.supabase)
    .from("ceo_lead_worker_config")
    .update({ enabled: true, paused: false, updated_at: new Date().toISOString() })
    .eq("id", auth.configId);

  try {
    const admin = leadWorkerServiceClient();
    const result = await runLeadWorkerTick(admin, {
      trigger: "manual",
      forceEnvBypass: true,
      founderName: auth.session.user.email?.split("@")[0] || "Ghost",
    });
    revalidatePath("/command");
    if (!result.ok && result.status !== "duplicate") {
      return { ok: false, error: result.message };
    }
    return { ok: true, notice: result.message };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Lead worker run failed.",
    };
  }
}
