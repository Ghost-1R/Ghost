/**
 * Deterministic CEO-facing presentation for dashboard signals.
 * Does not invent facts. Preserves evidence strings for deeper views.
 */

export type CeoSeverity = "RED" | "YELLOW" | "WAITING" | "UNKNOWN";

export type CeoCopy = {
  headline: string;
  explanation: string;
  nextAction: string;
  ctaLabel: string;
  evidence: string;
};

function cleanSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripTechnicalNoise(text: string): string {
  return cleanSpaces(
    text
      .replace(/[`'"]/g, "")
      .replace(/\b(app\/DB|enum|migration|RPC|SHA|uuid)\b/gi, "")
      .replace(/\s{2,}/g, " "),
  );
}

/** Stable issue family for deduplication (not unique row id). */
export function signalIdentityKey(input: {
  kind: string;
  projectId: string;
  title: string;
  detail?: string;
}): string {
  const title = cleanSpaces(input.title).toLowerCase();
  const detail = cleanSpaces(input.detail ?? "").toLowerCase();

  if (input.kind === "failed_deployment") {
    const dep = title.match(/\bdep-\d+\b/i)?.[0]?.toLowerCase() ?? title;
    return `failed_deployment:${dep}`;
  }
  if (input.kind === "failed_health") {
    return `failed_health:${input.projectId}:${title}`;
  }
  if (input.kind === "blocker") {
    if (/ready_for_delivery|order status/i.test(`${title} ${detail}`)) {
      return `blocker:${input.projectId}:delivery-status`;
    }
    return `blocker:${input.projectId}:${title.slice(0, 80)}`;
  }
  if (input.kind === "critical_defect" || input.kind === "failed_verification") {
    return `${input.kind}:${input.projectId}:${title.slice(0, 80)}`;
  }
  if (input.kind === "open_decision" || input.kind === "requires_decision") {
    return `${input.kind}:${input.projectId}:${title.slice(0, 80)}`;
  }
  if (input.kind === "presentation_review") {
    return `presentation_review:${input.projectId}`;
  }
  return `${input.kind}:${input.projectId}:${title.slice(0, 80)}`;
}

/**
 * Map recorded signal text → CEO headline / explanation / next / CTA.
 * Evidence stays the original detail/title.
 */
export function presentCeoSignal(input: {
  kind: string;
  projectName: string;
  title: string;
  detail: string;
}): CeoCopy {
  const blob = `${input.title} ${input.detail}`;
  const evidence = cleanSpaces(input.detail || input.title);

  if (/ready_for_delivery|order status|fulfillment/i.test(blob)) {
    return {
      headline: `${input.projectName} delivery status is out of sync`,
      explanation:
        'The website and database disagree about “Ready for Delivery.” This could cause incorrect order updates.',
      nextAction: "Reconcile the order status model",
      ctaLabel: "Review conflict →",
      evidence,
    };
  }

  if (/deploy timed out|deployment.*fail|DEP-\d+ failed/i.test(blob) || input.kind === "failed_deployment") {
    return {
      headline: `Production deployment failed`,
      explanation: `${input.projectName}: a recorded production deploy attempt did not succeed.`,
      nextAction: "Investigate the failed deployment",
      ctaLabel: "Investigate deployment →",
      evidence,
    };
  }

  if (input.kind === "failed_health" || /health check failed/i.test(blob)) {
    return {
      headline: `${input.projectName} production health check failed`,
      explanation: "A required production health check is recorded as failed.",
      nextAction: "Review production health evidence",
      ctaLabel: "Review evidence →",
      evidence,
    };
  }

  if (input.kind === "critical_defect" || /CRITICAL verification defect/i.test(blob)) {
    return {
      headline: `${input.projectName} has a critical verification defect`,
      explanation: "A blocking verification defect is still open.",
      nextAction: "Resolve the verification defect",
      ctaLabel: "Resolve blocker →",
      evidence,
    };
  }

  if (input.kind === "failed_verification" || /verification is FAILED|Verification failed/i.test(blob)) {
    return {
      headline: `${input.projectName} verification failed`,
      explanation: "A recorded verification check failed and still needs attention.",
      nextAction: "Review failed verification",
      ctaLabel: "Review evidence →",
      evidence,
    };
  }

  if (/tax mode/i.test(blob)) {
    return {
      headline: `Confirm ${input.projectName} tax mode`,
      explanation: "Production tax mode is still an open founder decision.",
      nextAction: "Choose the production tax mode",
      ctaLabel: "Make decision →",
      evidence,
    };
  }

  if (/doordash/i.test(blob)) {
    return {
      headline: `Confirm DoorDash state for ${input.projectName}`,
      explanation: "Whether DoorDash is live in production still needs a founder decision.",
      nextAction: "Confirm DoorDash production state",
      ctaLabel: "Make decision →",
      evidence,
    };
  }

  if (/paypal|square|webhook/i.test(blob)) {
    return {
      headline: `Decide leftover payment webhooks for ${input.projectName}`,
      explanation: "Old payment webhook remnants still need a founder decision.",
      nextAction: "Decide whether to retire remnant webhooks",
      ctaLabel: "Make decision →",
      evidence,
    };
  }

  if (input.kind === "presentation_review" || /presentation review/i.test(blob)) {
    return {
      headline: `Approve ${input.projectName} for presentation readiness`,
      explanation: "Founder review is required before presentation can be considered ready.",
      nextAction: "Review presentation readiness",
      ctaLabel: "Review →",
      evidence,
    };
  }

  if (input.kind === "open_decision" || input.kind === "requires_decision") {
    const headline = stripTechnicalNoise(input.title) || "Founder decision needed";
    return {
      headline,
      explanation: stripTechnicalNoise(input.detail) || "A recorded decision is waiting on you.",
      nextAction: "Make the decision",
      ctaLabel: "Make decision →",
      evidence,
    };
  }

  // Generic fallback — humanize without inventing facts.
  const headline = stripTechnicalNoise(input.title) || "Attention required";
  return {
    headline: headline.charAt(0).toUpperCase() + headline.slice(1),
    explanation: stripTechnicalNoise(input.detail) || "Recorded project signal needs founder attention.",
    nextAction: "Open the project and review the evidence",
    ctaLabel: "Open project →",
    evidence,
  };
}

export function presentProjectHealthReason(input: {
  status: "RED" | "YELLOW" | "GREEN" | "UNKNOWN";
  reason: string;
  projectName: string;
}): string {
  if (input.status === "UNKNOWN") return "Insufficient evidence to claim project health.";
  if (input.status === "GREEN") return "Required checks passed with recorded evidence.";
  if (/ready_for_delivery|Ready for Delivery|order status|fulfillment/i.test(input.reason)) {
    return "Delivery status model is inconsistent.";
  }
  if (/deploy timed out|DEP-\d+ failed|deployment/i.test(input.reason)) {
    return "A production deployment attempt failed.";
  }
  if (/founder decision/i.test(input.reason)) {
    return input.reason;
  }
  const cleaned = stripTechnicalNoise(input.reason);
  return cleaned.length > 140 ? `${cleaned.slice(0, 137)}…` : cleaned;
}

export function presentNextActionLine(next: string | null | undefined): string | null {
  if (!next?.trim()) return null;
  if (/ready_for_delivery|Reconcile the Ivoire|order status/i.test(next)) {
    return "Reconcile fulfillment status.";
  }
  if (/deploy|deployment readiness/i.test(next)) {
    return "Investigate failed deployment.";
  }
  const cleaned = stripTechnicalNoise(next);
  return cleaned.length > 100 ? `${cleaned.slice(0, 97)}…` : cleaned;
}
