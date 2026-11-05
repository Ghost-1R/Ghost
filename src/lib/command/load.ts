import { cookies } from "next/headers";
import type { GhostClient } from "@/lib/auth/session";
import type { AccessContext } from "@/lib/access/permissions";
import { ASSIGNMENT_COLUMNS, ASSIGNMENT_STATUS_LABEL, mapAssignmentRow } from "@/lib/assignments/types";
import { loadFounderAuthorizations } from "@/lib/approvals/queries";
import { loadCeoSignals } from "@/lib/dashboard/ceo-queries";
import { rankTop3Actions, moneyStatusPhase1 } from "@/lib/dashboard/ceo";
import { loadCompaniesForUser } from "@/lib/companies/queries";
import { listAgentTasksForProject } from "@/lib/agent-runtime/queries";
import { loose } from "@/lib/db/loose";
import { isModelConfigured } from "@/lib/ai/provider";
import { isWithinShift } from "@/lib/underworld-shifts/schedule";
import { ACK_COOKIE, INBOX_READ_COOKIE, WORK_MODE_COOKIE } from "./cookies";
import type { CommandBoard, CommandAlert, CommandTaskColumn } from "./types";

function greetingFor(hour: number, name: string): string {
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return `${part}, ${name}. Your business ecosystem is ready.`;
}

function founderDisplayName(
  profileName: string | null | undefined,
  email: string | null | undefined,
): string {
  const configured = (process.env.GHOST_CEO_NAME ?? "").trim();
  if (configured) return configured;
  const profile = profileName?.trim() ?? "";
  // Prefer CEO JITTA for local verification owner aliases before raw profile labels.
  if (
    (email && /jittabadger|ghost-founder|pr9-owner/i.test(email)) ||
    /pr9-owner|ghost[-_]?founder|local[-_]?owner/i.test(profile)
  ) {
    return "CEO JITTA";
  }
  if (profile.length >= 2 && !profile.includes("@") && !/^ghost[-_]/i.test(profile)) {
    return profile;
  }
  return "CEO";
}

function severityFromSignal(kind: string, severity: string): CommandAlert["severity"] {
  if (severity === "critical" || kind === "failed_health" || kind === "blocker") return "critical";
  if (kind === "open_decision" || kind === "requires_decision") return "attention";
  return "info";
}

/**
 * Assemble the CEO Command board from existing Ghost records only.
 * Missing finance / opportunity tables degrade to honest blockers.
 */
export async function loadCommandBoard(
  supabase: GhostClient,
  input: {
    userId: string;
    email: string | null;
    access: AccessContext;
    companyId?: string | null;
    displayName?: string | null;
    now?: Date;
  },
): Promise<CommandBoard> {
  const now = input.now ?? new Date();
  const checkedAt = now.toISOString();
  const founderName = founderDisplayName(input.displayName, input.email);
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/New_York",
    }).format(now),
  );

  const companiesResult = await loadCompaniesForUser(supabase, input.userId);
  const allCompanies = companiesResult.status === "ok" ? companiesResult.data : [];
  const companyFilterId =
    input.companyId && allCompanies.some((c) => c.id === input.companyId)
      ? input.companyId
      : null;
  const visibleCompanies = companyFilterId
    ? allCompanies.filter((c) => c.id === companyFilterId)
    : allCompanies;

  const companyIds = visibleCompanies.map((c) => c.id);
  const ownedIds = input.access.ownedCompanyIds;
  const scopedCompanyIds = companyIds.length
    ? companyIds.filter((id) => ownedIds.includes(id) || allCompanies.some((c) => c.id === id))
    : ownedIds;

  const projectsQuery = scopedCompanyIds.length
    ? await supabase
        .from("projects")
        .select("id, name, company_id, status")
        .in("company_id", scopedCompanyIds)
        .order("name")
    : { data: [] as Array<{ id: string; name: string; company_id: string; status: string }>, error: null };

  const projects = projectsQuery.data ?? [];
  const projectIds = projects.map((p) => p.id);

  const [assignments, authorizations, ceoSignals, memberships] = await Promise.all([
    projectIds.length
      ? loose(supabase)
          .from("work_assignments")
          .select(ASSIGNMENT_COLUMNS)
          .in("project_id", projectIds)
          .order("updated_at", { ascending: false })
          .limit(80)
      : Promise.resolve({ data: [], error: null }),
    loadFounderAuthorizations(supabase, input.userId),
    loadCeoSignals(
      supabase,
      projects.map((p) => ({ id: p.id, name: p.name })),
    ),
    scopedCompanyIds.length
      ? supabase
          .from("company_memberships")
          .select("id, company_id, user_id, revoked_at")
          .in("company_id", scopedCompanyIds)
          .is("revoked_at", null)
      : Promise.resolve({ data: [] as Array<{ id: string; company_id: string; user_id: string; revoked_at: string | null }>, error: null }),
  ]);
  const pendingAuth =
    authorizations.status === "ok"
      ? authorizations.data.filter(
          (auth) => auth.effectiveStatus === "PENDING" || auth.status === "PENDING",
        )
      : [];

  const assignmentRows = (assignments.data ?? []).map(mapAssignmentRow);
  const humanWorkers = new Set(
    (memberships.data ?? [])
      .map((row) => row.user_id)
      .filter(Boolean),
  );
  // Founder counts as workforce presence for owned companies.
  if (scopedCompanyIds.length) humanWorkers.add(input.userId);

  const agentTaskLists = await Promise.all(
    projectIds.slice(0, 12).map((id) => listAgentTasksForProject(supabase, input.userId, id, { limit: 20 })),
  );
  const agentTasks = agentTaskLists.flatMap((result) =>
    result.status === "ok" ? result.data : [],
  );
  const aiExecuting = agentTasks.filter((task) =>
    ["CLAIMED", "RUNNING", "CHECKPOINT"].includes(task.status),
  ).length;
  const aiRegistered = agentTasks.length;
  const withinShift = isWithinShift(now);
  const jar = await cookies();
  const workModeRaw = jar.get(WORK_MODE_COOKIE)?.value ?? "home";
  const workModes = ["desk", "home", "gym", "entertainment", "field"] as const;
  const workMode: CommandBoard["workMode"] = workModes.includes(
    workModeRaw as (typeof workModes)[number],
  )
    ? (workModeRaw as CommandBoard["workMode"])
    : "home";
  const ackIds = new Set(
    (jar.get(ACK_COOKIE)?.value ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
  const readIds = new Set(
    (jar.get(INBOX_READ_COOKIE)?.value ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );

  // Optional opportunity / finance tables (Phase 6 migrations). Missing → honest blockers.
  const opportunitiesQuery = await loose(supabase)
    .from("ceo_opportunities")
    .select("id, company_id, title, value_cents, currency, score, geography, status, source, updated_at")
    .in("company_id", scopedCompanyIds.length ? scopedCompanyIds : ["00000000-0000-0000-0000-000000000000"])
    .order("updated_at", { ascending: false })
    .limit(12);
  const financeQuery = await loose(supabase)
    .from("ceo_finance_entries")
    .select("id, company_id, kind, amount_cents, currency, status, occurred_on")
    .in("company_id", scopedCompanyIds.length ? scopedCompanyIds : ["00000000-0000-0000-0000-000000000000"])
    .limit(200);

  const opportunitiesMissing = Boolean(
    opportunitiesQuery.error && /ceo_opportunities|does not exist|schema cache/i.test(opportunitiesQuery.error.message),
  );
  const financeMissing = Boolean(
    financeQuery.error && /ceo_finance_entries|does not exist|schema cache/i.test(financeQuery.error.message),
  );

  const openAssignments = assignmentRows.filter(
    (row) => !["COMPLETED", "CANCELLED"].includes(row.status),
  );

  const taskBoard: CommandTaskColumn[] = [
    {
      id: "todo",
      label: "To Do",
      items: assignmentRows
        .filter((row) => row.status === "ASSIGNED")
        .slice(0, 6)
        .map((row) => ({
          id: row.id,
          title: row.title,
          meta: ASSIGNMENT_STATUS_LABEL[row.status],
          href: `/projects/${row.projectId}#assignment-${row.id}`,
        })),
    },
    {
      id: "progress",
      label: "In Progress",
      items: assignmentRows
        .filter((row) => row.status === "IN_PROGRESS")
        .slice(0, 6)
        .map((row) => {
          const task = agentTasks.find((item) => item.id === row.agentTaskId);
          const progress =
            task && task.checkpointSequence > 0
              ? Math.min(95, task.checkpointSequence * 20)
              : 35;
          return {
            id: row.id,
            title: row.title,
            meta: task ? `Run ${task.status.toLowerCase()}` : "In progress",
            href: task
              ? `/projects/${row.projectId}/workspace?task=${task.id}`
              : `/projects/${row.projectId}#assignment-${row.id}`,
            progress,
          };
        }),
    },
    {
      id: "review",
      label: "Review",
      items: assignmentRows
        .filter((row) => row.status === "SUBMITTED" || row.status === "IN_REVIEW")
        .slice(0, 6)
        .map((row) => ({
          id: row.id,
          title: row.title,
          meta: ASSIGNMENT_STATUS_LABEL[row.status],
          href: `/projects/${row.projectId}#assignment-${row.id}`,
        })),
    },
    {
      id: "done",
      label: "Completed",
      items: assignmentRows
        .filter((row) => row.status === "COMPLETED")
        .slice(0, 6)
        .map((row) => ({
          id: row.id,
          title: row.title,
          meta: "Verified",
          href: `/projects/${row.projectId}#assignment-${row.id}`,
        })),
    },
    {
      id: "blocked",
      label: "Blocked",
      items: agentTasks
        .filter((task) => task.status === "BLOCKED")
        .slice(0, 6)
        .map((task) => ({
          id: task.id,
          title: task.blockReason || "Blocked agent task",
          meta: "Needs attention",
          href: `/projects/${task.projectId}/workspace?task=${task.id}`,
        })),
    },
  ];

  const signals = ceoSignals.status === "ok" ? ceoSignals.data.signals : [];
  const top3 = rankTop3Actions({
    signals,
    today: [],
    decisions: [],
  });

  const projectCompany = new Map(projects.map((project) => [project.id, project.company_id]));
  const alerts: CommandAlert[] = [
    ...signals.slice(0, 8).map((signal) => ({
      id: signal.id,
      severity: severityFromSignal(signal.kind, signal.severity),
      title: signal.title,
      detail: signal.detail,
      at: signal.at,
      href: signal.href,
      companyName: signal.projectName,
      projectId: signal.projectId,
      companyId: projectCompany.get(signal.projectId) ?? null,
    })),
    ...pendingAuth.slice(0, 4).map((auth) => ({
      id: `auth-${auth.id}`,
      severity: "attention" as const,
      title: `Approval needed · ${auth.actionType}`,
      detail: auth.reason || "Founder authorization pending.",
      at: auth.requestedAt,
      href: "/approvals",
      projectId: auth.projectId ?? null,
      companyId: auth.projectId ? projectCompany.get(auth.projectId) ?? null : null,
    })),
  ].filter((alert) => !ackIds.has(alert.id));

  const money = moneyStatusPhase1();
  let cashCents = 0;
  let invoicedCents = 0;
  let expenseCents = 0;
  if (!financeMissing) {
    for (const row of financeQuery.data ?? []) {
      const amount = Number(row.amount_cents) || 0;
      const kind = String(row.kind);
      const status = String(row.status);
      if (kind === "CASH" && status === "CLEARED") cashCents += amount;
      if (kind === "INVOICE" && status !== "VOID") invoicedCents += amount;
      if (kind === "EXPENSE" && status !== "VOID") expenseCents += amount;
      if (kind === "REFUND" && status === "CLEARED") cashCents -= amount;
    }
  }

  const formatMoney = (cents: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(cents / 100);

  const modelOk = isModelConfigured();
  const dbOk = !projectsQuery.error;
  const systemState =
    !dbOk ? "disconnected" : !modelOk || signals.some((s) => s.severity === "critical") ? "degraded" : "healthy";

  const firstCompany = visibleCompanies[0];
  const underworldHref = firstCompany
    ? `/underworld?project=${projects.find((p) => p.company_id === firstCompany.id)?.id ?? projects[0]?.id ?? ""}`
    : "/underworld";

  return {
    greeting: greetingFor(hour, founderName),
    founderName,
    checkedAt,
    systemHealth: {
      id: "system",
      label:
        systemState === "healthy"
          ? "System Operational"
          : systemState === "degraded"
            ? "System Degraded"
            : "System Disconnected",
      state: systemState,
      detail: !dbOk
        ? "Project records could not be loaded from Supabase."
        : !modelOk
          ? "Ask Ghost model provider is not configured (local keys / quotas)."
          : `Checked Ghost records at ${checkedAt.slice(11, 19)} UTC.`,
      checkedAt,
      href: "/settings",
    },
    connections: [
      {
        id: "supabase",
        label: "Supabase",
        state: dbOk ? "healthy" : "disconnected",
        detail: dbOk ? "Local/disposable records reachable." : "Database query failed.",
        checkedAt,
      },
      {
        id: "model",
        label: "Ask Ghost provider",
        state: modelOk ? "healthy" : "disconnected",
        detail: modelOk
          ? "Provider keys present for Second Me answers."
          : "Configure provider secrets before LIVE Ask Ghost.",
        checkedAt,
        href: "/settings",
      },
      {
        id: "finance",
        label: "Finance ledger",
        state: financeMissing ? "disconnected" : "healthy",
        detail: financeMissing
          ? "ceo_finance_entries not applied — totals unavailable."
          : "Company-scoped finance entries loaded.",
        checkedAt,
        href: "/command/finance",
      },
      {
        id: "radar",
        label: "Opportunity Radar",
        state: opportunitiesMissing ? "disconnected" : "healthy",
        detail: opportunitiesMissing
          ? "ceo_opportunities not applied — manual/import paths pending migration."
          : "Opportunity records loaded.",
        checkedAt,
        href: "/command#radar",
      },
      {
        id: "shifts",
        label: "Underworld shift jobs",
        state: "healthy",
        detail:
          "Durable shift claim/checkpoint lives behind GHOST_UNDERWORLD_SHIFTS=1 (service role). LIVE remains refused.",
        checkedAt,
        href: "/underworld",
      },
    ],
    kpis: [
      {
        id: "companies",
        label: "Companies",
        value: String(visibleCompanies.length),
        detail: "Owned or member companies in scope",
        tone: "neutral",
        href: "/companies",
        trendLabel: null,
      },
      {
        id: "human",
        label: "Human Workers",
        value: String(humanWorkers.size),
        detail: "Active memberships + founder",
        tone: "neutral",
        href: "/team",
        trendLabel: null,
      },
      {
        id: "ai",
        label: "AI Workers",
        value: String(aiRegistered),
        detail: `${aiExecuting} executing · ${withinShift ? "default shift window open" : "outside default shift"}`,
        tone: aiExecuting > 0 ? "good" : "neutral",
        href: projects[0] ? `/projects/${projects[0].id}/workspace` : "/projects",
        trendLabel: null,
      },
      {
        id: "tasks",
        label: "Open Tasks",
        value: String(openAssignments.length),
        detail: "Assignments not completed or cancelled",
        tone: openAssignments.length > 20 ? "warn" : "neutral",
        href: "/team/my-work",
        trendLabel: null,
      },
      {
        id: "revenue",
        label: "Month-to-Date Cash",
        value: financeMissing ? "—" : formatMoney(cashCents),
        detail: financeMissing ? money.detail : "Cleared cash entries only (not unpaid invoices)",
        tone: financeMissing ? "warn" : "gold",
        href: firstCompany ? `/companies/${firstCompany.id}/map` : "/companies",
        trendLabel: null,
      },
    ],
    companies: visibleCompanies.map((company) => {
      const companyProjects = projects.filter((p) => p.company_id === company.id);
      const openTasks = assignmentRows.filter(
        (row) =>
          companyProjects.some((p) => p.id === row.projectId) &&
          !["COMPLETED", "CANCELLED"].includes(row.status),
      ).length;
      const critical = signals.filter(
        (s) =>
          companyProjects.some((p) => p.id === s.projectId) && s.severity === "critical",
      ).length;
      return {
        id: company.id,
        name: company.name,
        slug: company.slug,
        projectCount: company.projectCount || companyProjects.length,
        openTasks,
        memberCount: company.memberCount,
        healthLabel: critical > 0 ? "Needs attention" : openTasks > 0 ? "Active" : "Steady",
        healthTone: critical > 0 ? "critical" : openTasks > 0 ? "warn" : "good",
        href: `/companies/${company.id}`,
      };
    }),
    alerts: alerts.slice(0, 10),
    taskBoard,
    myTasks: [
      ...top3.slice(0, 3).map((item) => ({
        id: item.id,
        title: item.headline,
        priority: item.status === "RED" ? "High" : "Normal",
        href: item.href,
        done: false,
      })),
      ...assignmentRows
        .filter((row) => row.assigneeUserId === input.userId)
        .slice(0, 3)
        .map((row) => ({
          id: `mine-${row.id}`,
          title: row.title,
          priority: row.status === "IN_REVIEW" ? "Review" : "Normal",
          href: `/projects/${row.projectId}#assignment-${row.id}`,
          done: row.status === "COMPLETED",
        })),
    ].slice(0, 5),
    workforce: {
      human: humanWorkers.size,
      aiRegistered,
      aiOnShift: withinShift ? Math.min(aiRegistered, Math.max(aiExecuting, withinShift ? 1 : 0)) : 0,
      aiExecuting,
      detail:
        "Registered AI workers = saved agent tasks in scope. On shift uses the default Mon–Fri 9–5 ET window. Executing = claimed/running/checkpoint.",
    },
    shifts: {
      withinDefaultWindow: withinShift,
      timezone: "America/New_York",
      aiActive: aiExecuting,
      nextHandoverLabel: withinShift ? "5:00 PM ET" : "Next weekday 9:00 AM ET",
      href: "/underworld",
    },
    opportunities: opportunitiesMissing
      ? []
      : (opportunitiesQuery.data ?? []).map((row) => ({
          id: row.id as string,
          title: String(row.title),
          valueLabel: formatMoney(Number(row.value_cents) || 0),
          score: typeof row.score === "number" ? row.score : null,
          geography: String(row.geography || "—"),
          status: String(row.status),
          source: String(row.source || "manual"),
          href: `/command?company=${row.company_id}#radar`,
        })),
    opportunityBlocker: opportunitiesMissing
      ? "Opportunity Radar needs the ceo_opportunities migration. Manual entry and import will unlock after apply on the disposable DB."
      : null,
    finance: {
      cashCollectedLabel: financeMissing ? "Not connected" : formatMoney(cashCents),
      invoicedLabel: financeMissing ? "Not connected" : formatMoney(invoicedCents),
      profitLabel: financeMissing ? "Not connected" : formatMoney(cashCents - expenseCents),
      detail: financeMissing
        ? `${money.label}. ${money.detail}`
        : "Profit here = cleared cash − expenses. Unpaid invoices are not cash collected.",
      connected: !financeMissing,
      href: companyFilterId
        ? `/command/finance?company=${companyFilterId}`
        : "/command/finance",
    },
    decisionsPending: pendingAuth.slice(0, 5).map((auth) => ({
      id: auth.id,
      title: `${auth.actionType} · ${auth.environmentLabel}`,
      href: "/approvals",
    })),
    activeProjects: projects.filter((p) => /ACTIVE|BUILD|PLAN/i.test(p.status)).length || projects.length,
    companyFilterId,
    underworldHref: underworldHref.replace(/\?project=$/, ""),
    briefing: top3.map((item) => ({
      id: item.id,
      title: item.headline,
      next: item.nextAction,
      href: item.href,
    })),
    workMode,
    inboxUnread: Math.max(0, alerts.length - readIds.size),
    projectsForConvert: projects.slice(0, 24).map((project) => ({
      id: project.id,
      name: project.name,
      companyId: project.company_id,
    })),
  };
}
