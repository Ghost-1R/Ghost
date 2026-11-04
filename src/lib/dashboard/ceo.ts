/**
 * CEO Command Center — deterministic derivation only.
 * No attention table. No fabricated metrics. Absence of failure ≠ GREEN.
 */

import {
  askPathFromIntent,
  classifyCompanionIntent,
  classifyFounderAsk as classifyFounderAskFromCompanion,
} from "@/lib/companion/intent";
import { companionIntentGrounding } from "@/lib/companion/grounding";
import { resolveProjectFocus } from "@/lib/companion/focus";
import {
  presentCeoSignal,
  presentNextActionLine,
  presentProjectHealthReason,
  signalIdentityKey,
} from "@/lib/dashboard/ceo-copy";
import type { TodayAction } from "@/lib/operations/today";
import { explainTodayPriority, prioritizeTodayActions } from "@/lib/operations/today";

export { classifyCompanionIntent, askPathFromIntent };

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
  status: HealthStatus | "WAITING";
  headline: string;
  explanation: string;
  nextAction: string;
  ctaLabel: string;
  evidence: string;
  href: string;
  identityKey: string;
  rankScore: number;
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

export type WhoMightCallSection = {
  /** External client-event bus is not connected in Phase 1. */
  externalConnected: false;
  notice: string;
  /** Derived exceptions from existing client-facing RED signals. */
  exceptions: WhoMightCallItem[];
  state: "UNKNOWN" | "EXCEPTIONS" | "CLEAR";
};

export type RedLight = {
  id: string;
  projectId: string;
  projectName: string;
  reason: string;
  evidence: string;
  href: string;
  ctaLabel: string;
};

export type MoneyStatus = {
  state: "UNKNOWN";
  label: string;
  detail: string;
};

/** Questions and discovery stay Second Me. Consequential actions use the gated path. */
export function classifyFounderAsk(message: string): AskPath {
  return classifyFounderAskFromCompanion(message);
}

export function askPathGrounding(path: AskPath, message = ""): string {
  if (!message) {
    if (path === "SECOND_ME") {
      return companionIntentGrounding("QUESTION", { kind: "none" });
    }
    return companionIntentGrounding("CONSEQUENTIAL_ACTION", { kind: "none" });
  }
  const intent = classifyCompanionIntent(message);
  const focus = resolveProjectFocus({ message, intent, projects: [], lockedProjectId: null });
  return companionIntentGrounding(intent, focus);
}

export function moneyStatusPhase1(): MoneyStatus {
  return {
    state: "UNKNOWN",
    label: "Money",
    detail: "Financial source not connected yet — Ghost will not invent figures.",
  };
}

export function whoMightCallSection(signals: readonly CeoSignal[]): WhoMightCallSection {
  const notice = "External client signals aren't connected yet.";
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
    .map((signal) => {
      const copy = presentCeoSignal(signal);
      return {
        id: signal.id,
        projectId: signal.projectId,
        projectName: signal.projectName,
        reason: copy.headline,
        href: signal.href,
        identityKey: signalIdentityKey(signal),
        rankScore: founderRankScore(signal),
      };
    });

  const byIssue = new Map<string, (typeof exceptions)[number]>();
  for (const item of exceptions) {
    const prior = byIssue.get(item.identityKey);
    if (!prior || item.rankScore < prior.rankScore) byIssue.set(item.identityKey, item);
  }
  const list = [...byIssue.values()].map((item) => ({
    id: item.id,
    projectId: item.projectId,
    projectName: item.projectName,
    reason: item.reason,
    href: item.href,
  }));

  return {
    externalConnected: false,
    notice,
    exceptions: list,
    state: list.length > 0 ? "EXCEPTIONS" : "UNKNOWN",
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
  projectName?: string;
}): HealthResult {
  const critical = input.criticalSignals;
  if (critical.length > 0 || input.openBlockerCount > 0) {
    const lead = critical[0];
    const copy = lead
      ? presentCeoSignal(lead)
      : {
          explanation:
            input.openBlockerCount > 0
              ? `${input.openBlockerCount} open shipping blocker${input.openBlockerCount === 1 ? "" : "s"}.`
              : "Critical failure recorded.",
          nextAction: "Resolve the shipping blocker",
        };
    return {
      status: "RED",
      reason: presentProjectHealthReason({
        status: "RED",
        reason: copy.explanation,
        projectName: input.projectName ?? "",
      }),
      sources: critical.map((s) => s.kind).slice(0, 4),
      nextAction: presentNextActionLine(input.nextAction ?? copy.nextAction),
    };
  }

  if (input.yellowSignals.length > 0 || input.openDecisionCount > 0) {
    const lead = input.yellowSignals[0];
    const reason =
      (lead ? presentCeoSignal(lead).explanation : null) ||
      (input.openDecisionCount > 0
        ? `${input.openDecisionCount} founder decision${input.openDecisionCount === 1 ? "" : "s"} waiting.`
        : "Important verification or founder action remains.");
    return {
      status: "YELLOW",
      reason: presentProjectHealthReason({
        status: "YELLOW",
        reason,
        projectName: input.projectName ?? "",
      }),
      sources: [
        ...input.yellowSignals.map((s) => s.kind),
        ...(input.openDecisionCount > 0 ? (["open_decision"] as const) : []),
      ].slice(0, 4),
      nextAction: presentNextActionLine(
        input.nextAction ?? (lead ? presentCeoSignal(lead).nextAction : "Clear the waiting decision."),
      ),
    };
  }

  if (input.hasVerifiedEvidence) {
    return {
      status: "GREEN",
      reason: presentProjectHealthReason({
        status: "GREEN",
        reason: "Required relevant checks passed with recorded evidence.",
        projectName: input.projectName ?? "",
      }),
      sources: ["verification_records"],
      nextAction: presentNextActionLine(input.nextAction),
    };
  }

  return {
    status: "UNKNOWN",
    reason: presentProjectHealthReason({
      status: "UNKNOWN",
      reason: "Insufficient evidence to claim project health.",
      projectName: input.projectName ?? "",
    }),
    sources: [],
    nextAction: presentNextActionLine(input.nextAction),
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

export function healthLabel(status: HealthStatus): string {
  switch (status) {
    case "RED":
      return "Needs attention";
    case "YELLOW":
      return "Watch closely";
    case "GREEN":
      return "On track";
    case "UNKNOWN":
      return "Needs evidence";
  }
}

/** Founder importance — lower is more urgent. */
export function founderRankScore(input: {
  kind: string;
  severity: "critical" | "high" | "normal";
  clientFacing: boolean;
  title: string;
  detail: string;
}): number {
  const blob = `${input.title} ${input.detail}`;
  if (/security|isolation|rls|auth/i.test(blob)) return 1;
  if (/outage|down|unreachable/i.test(blob) || input.kind === "failed_health") return 2;
  if (/payment|stripe|charge|checkout/i.test(blob)) return 3;
  if (input.clientFacing && input.severity === "critical") return 4;
  if (input.kind === "blocker" && input.severity === "critical") return 5;
  if (input.kind === "failed_verification" || input.kind === "critical_defect") return 6;
  if (input.kind === "failed_deployment") return 7;
  if (input.kind === "open_decision" || input.kind === "requires_decision" || input.kind === "presentation_review") {
    return 8;
  }
  if (input.severity === "high") return 9;
  return 10;
}

type Candidate = Top3Action;

function toSignalCandidate(signal: CeoSignal): Candidate {
  const copy = presentCeoSignal(signal);
  const identityKey = signalIdentityKey(signal);
  return {
    id: `sig-${signal.id}`,
    projectId: signal.projectId,
    projectName: signal.projectName,
    status: signal.severity === "critical" ? "RED" : "YELLOW",
    headline: copy.headline,
    explanation: copy.explanation,
    nextAction: copy.nextAction,
    ctaLabel: copy.ctaLabel,
    evidence: copy.evidence,
    href: signal.href,
    identityKey,
    rankScore: founderRankScore(signal),
  };
}

/** Prefer client-facing / named product projects over schema probes when collapsing. */
function preferCandidate(a: Candidate, b: Candidate): Candidate {
  const probe = (name: string) => /probe|acceptance|schema/i.test(name);
  if (probe(a.projectName) !== probe(b.projectName)) {
    return probe(a.projectName) ? b : a;
  }
  if (a.rankScore !== b.rankScore) return a.rankScore < b.rankScore ? a : b;
  return a.projectName.localeCompare(b.projectName) <= 0 ? a : b;
}

export function dedupeCeoCandidates(candidates: readonly Candidate[]): Candidate[] {
  const best = new Map<string, Candidate>();
  for (const item of candidates) {
    const prior = best.get(item.identityKey);
    best.set(item.identityKey, prior ? preferCandidate(prior, item) : item);
  }
  return [...best.values()];
}

/** Top 3 founder actions — dedupe first, then rank, max three. */
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
  const candidates: Candidate[] = [];

  for (const signal of input.signals) {
    candidates.push(toSignalCandidate(signal));
  }

  for (const decision of input.decisions) {
    const copy = presentCeoSignal({
      kind: "open_decision",
      projectName: decision.projectName,
      title: decision.title,
      detail: decision.question,
    });
    candidates.push({
      id: `dec-${decision.id}`,
      projectId: decision.projectId ?? "none",
      projectName: decision.projectName,
      status: "WAITING",
      headline: copy.headline,
      explanation: copy.explanation,
      nextAction: copy.nextAction,
      ctaLabel: "Make decision →",
      evidence: copy.evidence,
      href: decision.projectId ? `/projects/${decision.projectId}` : "/dashboard#waiting-on-me",
      identityKey: signalIdentityKey({
        kind: "open_decision",
        projectId: decision.projectId ?? "none",
        title: decision.title,
        detail: decision.question,
      }),
      rankScore: 8,
    });
  }

  for (const action of prioritizeTodayActions(input.today)) {
    if (action.requiresDecision) continue; // covered via decisions / waiting
    const copy = presentCeoSignal({
      kind: "requires_decision",
      projectName: action.projectName,
      title: action.title,
      detail: explainTodayPriority(action),
    });
    candidates.push({
      id: `act-${action.id}`,
      projectId: action.projectId,
      projectName: action.projectName,
      status: action.status === "BLOCKED" ? "RED" : "YELLOW",
      headline: copy.headline,
      explanation: copy.explanation,
      nextAction: copy.nextAction,
      ctaLabel: action.status === "BLOCKED" ? "Resolve blocker →" : "Open project →",
      evidence: copy.evidence,
      href: `/projects/${action.projectId}`,
      identityKey: signalIdentityKey({
        kind: "requires_decision",
        projectId: action.projectId,
        title: action.title,
      }),
      rankScore: action.status === "BLOCKED" ? 5 : action.priority === "HIGH" ? 9 : 10,
    });
  }

  const distinct = dedupeCeoCandidates(candidates);
  distinct.sort((left, right) => {
    if (left.rankScore !== right.rankScore) return left.rankScore - right.rankScore;
    return left.headline.localeCompare(right.headline);
  });
  return distinct.slice(0, 3);
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
    const copy = presentCeoSignal({
      kind: "open_decision",
      projectName: decision.projectName,
      title: decision.title,
      detail: decision.question,
    });
    items.push({
      id: `dec-${decision.id}`,
      what: copy.headline,
      projectId: decision.projectId,
      projectName: decision.projectName,
      reason: copy.explanation,
      ageLabel: ageLabel(decision.createdAt, now),
      actionLabel: "Make decision →",
      href: decision.projectId ? `/projects/${decision.projectId}` : "/dashboard#waiting-on-me",
    });
  }

  for (const action of input.requiresDecisionActions) {
    const copy = presentCeoSignal({
      kind: "requires_decision",
      projectName: action.projectName,
      title: action.title,
      detail: "This next action requires a founder decision before it can proceed.",
    });
    items.push({
      id: `req-${action.id}`,
      what: copy.headline,
      projectId: action.projectId,
      projectName: action.projectName,
      reason: copy.explanation,
      ageLabel: null,
      actionLabel: "Review →",
      href: `/projects/${action.projectId}`,
    });
  }

  // One presentation review line per project — avoid NOT_READY spam.
  const seenPresentation = new Set<string>();
  for (const review of input.presentationReviews) {
    if (review.result === "READY") continue;
    if (seenPresentation.has(review.projectId)) continue;
    seenPresentation.add(review.projectId);
    const copy = presentCeoSignal({
      kind: "presentation_review",
      projectName: review.projectName,
      title: `Presentation review: ${review.result}`,
      detail: "Founder review of presentation readiness is outstanding.",
    });
    items.push({
      id: `pres-${review.id}`,
      what: copy.headline,
      projectId: review.projectId,
      projectName: review.projectName,
      reason: copy.explanation,
      ageLabel: ageLabel(review.createdAt, now),
      actionLabel: "Review →",
      href: "/presentation",
    });
  }

  return items;
}

/** Compact RED list — CEO headlines, not full Top 3 cards. */
export function buildRedLights(signals: readonly CeoSignal[]): RedLight[] {
  const candidates = signals
    .filter(
      (signal) =>
        signal.severity === "critical" &&
        (signal.kind === "blocker" ||
          signal.kind === "critical_defect" ||
          signal.kind === "failed_health" ||
          signal.kind === "failed_deployment" ||
          signal.kind === "failed_verification"),
    )
    .map((signal) => {
      const copy = presentCeoSignal(signal);
      return {
        id: signal.id,
        projectId: signal.projectId,
        projectName: signal.projectName,
        reason: copy.headline,
        evidence: copy.evidence,
        href: signal.href,
        ctaLabel: "View evidence →",
        identityKey: signalIdentityKey(signal),
        rankScore: founderRankScore(signal),
      };
    });

  const best = new Map<string, (typeof candidates)[number]>();
  for (const item of candidates) {
    const prior = best.get(item.identityKey);
    if (!prior || item.rankScore < prior.rankScore) best.set(item.identityKey, item);
  }

  return [...best.values()]
    .sort((a, b) => a.rankScore - b.rankScore || a.reason.localeCompare(b.reason))
    .map((item) => ({
      id: item.id,
      projectId: item.projectId,
      projectName: item.projectName,
      reason: item.reason,
      evidence: item.evidence,
      href: item.href,
      ctaLabel: item.ctaLabel,
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
  return /Cleaning Business|"Ghost"\s*as\s*project/i.test(source);
}
