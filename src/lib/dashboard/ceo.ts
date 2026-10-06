/**
 * CEO Command Center — deterministic derivation only.
 * No attention table. No fabricated metrics. Absence of failure ≠ GREEN.
 */

import type { TodayAction } from "@/lib/operations/today";
import { explainTodayPriority, prioritizeTodayActions } from "@/lib/operations/today";

export const HEALTH_STATUSES = ["RED", "YELLOW", "GREEN", "UNKNOWN"] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const ASK_PATHS = ["SECOND_ME", "CONSEQUENTIAL"] as const;
export type AskPath = (typeof ASK_PATHS)[number];

export type HealthResult = {
  status: HealthStatus;
  reason: string;
  sources: string[];
  nextAction: string | null;
};

export type CeoSignal = {
  id: string;
  projectId: string;
  projectName: string;
  kind:
    | "blocker"
    | "critical_defect"
    | "failed_health"
    | "failed_deployment"
    | "failed_verification"
    | "open_decision"
    | "requires_decision"
    | "presentation_review";
  severity: "critical" | "high" | "normal";
  title: string;
  detail: string;
  at: string | null;
  href: string;
  clientFacing: boolean;
};

export type Top3Action = {
  id: string;
  projectId: string;
  projectName: string;
  status: string;
  reason: string;
  nextAction: string;
  href: string;
};

export type WaitingItem = {
  id: string;
  what: string;
  projectId: string | null;
  projectName: string;
  reason: string;
  ageLabel: string | null;
  actionLabel: string;
  href: string;
};

export type WhoMightCallItem = {
  id: string;
  projectId: string;
  projectName: string;
  reason: string;
  href: string;
};

export type RedLight = {
  id: string;
  projectId: string;
  projectName: string;
  reason: string;
  evidence: string;
  nextAction: string;
  href: string;
};

export type ProjectHealthRow = {
  projectId: string;
  projectName: string;
  health: HealthResult;
  nextAction: string | null;
  href: string;
};

export type MoneyStatus = {
  state: "UNKNOWN";
  label: string;
  detail: string;
};

export type WhoMightCallSection = {
  connected: false;
  notice: string;
  exceptions: WhoMightCallItem[];
};

const CONSEQUENTIAL_VERBS =
  /\b(build|rebuild|implement|change|modify|update\s+production|deploy|redeploy|publish|release|ship|send|email|message\s+the\s+client|execute|run\s+the\s+pipeline|apply\s+migration|delete|destroy|rollback)\b/i;

const QUESTION_MARKERS =
  /^(how|what|why|which|who|when|where|do|does|did|is|are|can|could|should|will|would|tell me|explain|summarize|show me)\b|\?$/i;

/** Questions stay Second Me. Consequential verbs request the gated execution path. */
export function classifyFounderAsk(message: string): AskPath {
  const text = message.trim();
  if (!text) return "SECOND_ME";
  if (CONSEQUENTIAL_VERBS.test(text) && !isPureStatusQuestion(text)) {
    return "CONSEQUENTIAL";
  }
  return "SECOND_ME";
}

function isPureStatusQuestion(text: string): boolean {
  if (QUESTION_MARKERS.test(text.trim())) {
    // "How do I deploy?" is still a question about process — Second Me explains, does not execute.
    // "Deploy Ivoire to production" is consequential.
    if (/^(how|what|why|which|who|when|where)\b/i.test(text.trim())) return true;
    if (/\?\s*$/.test(text)) return true;
  }
  return false;
}

export function askPathGrounding(path: AskPath): string {
  if (path === "SECOND_ME") {
    return [
      "Ask path: SECOND_ME (question only).",
      "Answer immediately from Project Brain and recorded evidence.",
      "Do not start build, deploy, publish, send, or other execution workflows.",
      "Do not ask the founder for build/deploy approval unless they explicitly requested that action.",
    ].join(" ");
  }
  return [
    "Ask path: CONSEQUENTIAL (founder requested an action).",
    "Do not silently execute money, public posts, customer messages, production deploy, or destructive operations.",
    "Explain what is recorded, what is missing, and which Ghost operating-system step (decision, inspection, deploy) must happen next.",
    "Ghost conversation cannot mutate project lifecycle by itself.",
  ].join(" ");
}

export function moneyStatusPhase1(): MoneyStatus {
  return {
    state: "UNKNOWN",
    label: "UNKNOWN",
    detail: "Financial source not connected.",
  };
}

export function whoMightCallSection(signals: readonly CeoSignal[]): WhoMightCallSection {
  const exceptions = signals
    .filter(
      (signal) =>
        signal.clientFacing &&
        signal.severity === "critical" &&
        (signal.kind === "blocker" ||
          signal.kind === "critical_defect" ||
          signal.kind === "failed_health" ||
          signal.kind === "failed_deployment" ||
          signal.kind === "failed_verification"),
    )
    .map((signal) => ({
      id: signal.id,
      projectId: signal.projectId,
      projectName: signal.projectName,
      reason: signal.title,
      href: signal.href,
    }));

  // Dedupe by project — one line per project that could need Badger.
  const byProject = new Map<string, WhoMightCallItem>();
  for (const item of exceptions) {
    if (!byProject.has(item.projectId)) byProject.set(item.projectId, item);
  }

  return {
    connected: false,
    notice: "No client exception signals connected yet.",
    exceptions: [...byProject.values()],
  };
}

/**
 * Project health from recorded signals only.
 * GREEN requires positive verified evidence — never from "no errors reported".
 */
export function deriveProjectHealth(input: {
  openBlockerCount: number;
  criticalSignals: readonly CeoSignal[];
  yellowSignals: readonly CeoSignal[];
  hasVerifiedEvidence: boolean;
  openDecisionCount: number;
  nextAction: string | null;
}): HealthResult {
  const critical = input.criticalSignals;
  if (critical.length > 0 || input.openBlockerCount > 0) {
    const lead = critical[0];
    const reason =
      lead?.detail ||
      (input.openBlockerCount > 0
        ? `${input.openBlockerCount} open shipping blocker${input.openBlockerCount === 1 ? "" : "s"}.`
        : "Critical failure recorded.");
    return {
      status: "RED",
      reason,
      sources: critical.map((s) => s.kind).slice(0, 4),
      nextAction: input.nextAction ?? lead?.title ?? "Resolve the shipping blocker.",
    };
  }

  if (input.yellowSignals.length > 0 || input.openDecisionCount > 0) {
    const lead = input.yellowSignals[0];
    const reason =
      lead?.detail ||
      (input.openDecisionCount > 0
        ? `${input.openDecisionCount} founder decision${input.openDecisionCount === 1 ? "" : "s"} waiting.`
        : "Important verification or founder action remains.");
    return {
      status: "YELLOW",
      reason,
      sources: [
        ...input.yellowSignals.map((s) => s.kind),
        ...(input.openDecisionCount > 0 ? (["open_decision"] as const) : []),
      ].slice(0, 4),
      nextAction: input.nextAction ?? lead?.title ?? "Clear the waiting decision or verification gap.",
    };
  }

  if (input.hasVerifiedEvidence) {
    return {
      status: "GREEN",
      reason: "Required relevant checks passed with recorded evidence.",
      sources: ["verification_records"],
      nextAction: input.nextAction,
    };
  }

  return {
    status: "UNKNOWN",
    reason: "Insufficient evidence to claim project health.",
    sources: [],
    nextAction: input.nextAction,
  };
}

export function healthGlyph(status: HealthStatus): string {
  switch (status) {
    case "RED":
      return "🔴";
    case "YELLOW":
      return "🟡";
    case "GREEN":
      return "🟢";
    case "UNKNOWN":
      return "⚪";
  }
}

/** Top 3 founder actions — max three, deterministic, from real state. */
export function rankTop3Actions(input: {
  today: readonly TodayAction[];
  signals: readonly CeoSignal[];
  decisions: readonly {
    id: string;
    projectId: string | null;
    projectName: string;
    title: string;
    question: string;
    createdAt: string;
  }[];
}): Top3Action[] {
  const ranked: Top3Action[] = [];
  const seen = new Set<string>();

  const push = (item: Top3Action) => {
    if (ranked.length >= 3) return;
    const key = `${item.projectId}:${item.nextAction}`;
    if (seen.has(key)) return;
    seen.add(key);
    ranked.push(item);
  };

  // 1) Critical / RED signals first
  for (const signal of input.signals.filter((s) => s.severity === "critical")) {
    push({
      id: `sig-${signal.id}`,
      projectId: signal.projectId,
      projectName: signal.projectName,
      status: "RED",
      reason: signal.detail || signal.title,
      nextAction: signal.title,
      href: signal.href,
    });
  }

  // 2) Open founder decisions
  for (const decision of input.decisions) {
    push({
      id: `dec-${decision.id}`,
      projectId: decision.projectId ?? "none",
      projectName: decision.projectName,
      status: "WAITING",
      reason: decision.question,
      nextAction: `Decide: ${decision.title}`,
      href: decision.projectId ? `/projects/${decision.projectId}` : "/dashboard#waiting-on-me",
    });
  }

  // 3) Prioritized today actions (already sorted)
  for (const action of prioritizeTodayActions(input.today)) {
    push({
      id: `act-${action.id}`,
      projectId: action.projectId,
      projectName: action.projectName,
      status: action.status,
      reason: explainTodayPriority(action),
      nextAction: action.title,
      href: `/projects/${action.projectId}`,
    });
  }

  return ranked.slice(0, 3);
}

export function buildWaitingOnMe(input: {
  decisions: readonly {
    id: string;
    projectId: string | null;
    projectName: string;
    title: string;
    question: string;
    createdAt: string;
  }[];
  requiresDecisionActions: readonly TodayAction[];
  presentationReviews: readonly {
    id: string;
    projectId: string;
    projectName: string;
    result: string;
    createdAt: string;
  }[];
  now?: Date;
}): WaitingItem[] {
  const now = input.now ?? new Date();
  const items: WaitingItem[] = [];

  for (const decision of input.decisions) {
    items.push({
      id: `dec-${decision.id}`,
      what: decision.title,
      projectId: decision.projectId,
      projectName: decision.projectName,
      reason: decision.question,
      ageLabel: ageLabel(decision.createdAt, now),
      actionLabel: "Decide",
      href: decision.projectId ? `/projects/${decision.projectId}` : "/dashboard#waiting-on-me",
    });
  }

  for (const action of input.requiresDecisionActions) {
    items.push({
      id: `req-${action.id}`,
      what: action.title,
      projectId: action.projectId,
      projectName: action.projectName,
      reason: "This next action requires a founder decision before it can proceed.",
      ageLabel: null,
      actionLabel: "Review",
      href: `/projects/${action.projectId}`,
    });
  }

  for (const review of input.presentationReviews) {
    if (review.result === "READY") continue;
    items.push({
      id: `pres-${review.id}`,
      what: `Presentation review: ${review.result}`,
      projectId: review.projectId,
      projectName: review.projectName,
      reason: "Founder review of presentation readiness is outstanding.",
      ageLabel: ageLabel(review.createdAt, now),
      actionLabel: "Review",
      href: "/presentation",
    });
  }

  return items;
}

export function buildRedLights(signals: readonly CeoSignal[]): RedLight[] {
  return signals
    .filter(
      (signal) =>
        signal.severity === "critical" &&
        (signal.kind === "blocker" ||
          signal.kind === "critical_defect" ||
          signal.kind === "failed_health" ||
          signal.kind === "failed_deployment" ||
          signal.kind === "failed_verification"),
    )
    .map((signal) => ({
      id: signal.id,
      projectId: signal.projectId,
      projectName: signal.projectName,
      reason: signal.title,
      evidence: signal.detail,
      nextAction: `Address: ${signal.title}`,
      href: signal.href,
    }));
}

export function ageLabel(iso: string, now: Date): string | null {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const hours = Math.max(0, Math.floor((now.getTime() - then) / 3_600_000));
  if (hours < 1) return "under 1h";
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** Guard: page source must not hardcode business names as CEO content. */
export function containsHardcodedCeoProjects(source: string): boolean {
  return /Ivoire Shop|Cleaning Business|"Ghost"\s*as\s*project/i.test(source);
}
