import type { LifecycleStage } from "@/lib/lifecycle/stages";

/** Educational Ghost operating pipeline shown on the dashboard. */
export const OS_PIPELINE_STAGES = [
  {
    id: "IDEA",
    label: "Idea",
    subtitle: "Define the opportunity",
    lifecycle: ["IDEA"] as const,
  },
  {
    id: "STRATEGY",
    label: "Strategy",
    subtitle: "Plan the direction",
    lifecycle: ["STRATEGY"] as const,
  },
  {
    id: "PRODUCT_DEFINITION",
    label: "Product Definition",
    subtitle: "Requirements & scope",
    lifecycle: ["DESIGN"] as const,
  },
  {
    id: "SYSTEM_ARCHITECTURE",
    label: "System Architecture",
    subtitle: "Design the system",
    lifecycle: [] as const,
  },
  {
    id: "BUILD_PLAN",
    label: "Build Plan",
    subtitle: "Packages & order",
    lifecycle: [] as const,
  },
  {
    id: "IMPLEMENTATION",
    label: "Implementation",
    subtitle: "Build the product",
    lifecycle: ["BUILD"] as const,
  },
  {
    id: "VERIFICATION",
    label: "Verification",
    subtitle: "Test & validate",
    lifecycle: ["TEST"] as const,
  },
  {
    id: "DEPLOYMENT",
    label: "Deployment",
    subtitle: "Release safely",
    lifecycle: ["DEPLOY"] as const,
  },
  {
    id: "PRODUCTION",
    label: "Production",
    subtitle: "Live + verified",
    lifecycle: ["LEARN", "COMPLETED"] as const,
  },
] as const;

export type OsPipelineStageId = (typeof OS_PIPELINE_STAGES)[number]["id"];

/**
 * Map authoritative lifecycle to one educational pipeline stage.
 * Returns only the current stage — never fabricates prior-stage completion.
 */
export function mapLifecycleToPipelineStage(lifecycle: LifecycleStage | string | null | undefined): OsPipelineStageId | null {
  switch (lifecycle) {
    case "IDEA":
      return "IDEA";
    case "STRATEGY":
      return "STRATEGY";
    case "DESIGN":
      return "PRODUCT_DEFINITION";
    case "BUILD":
      return "IMPLEMENTATION";
    case "TEST":
      return "VERIFICATION";
    case "DEPLOY":
      return "DEPLOYMENT";
    case "LEARN":
    case "COMPLETED":
      return "PRODUCTION";
    default:
      return null;
  }
}

export type DashboardMetric = {
  key: string;
  label: string;
  value: number;
};

/** Only grounded metrics — callers must omit anything they cannot prove. */
export function buildOperatingMetrics(input: {
  projectCount: number;
  openDecisionCount: number;
  openBlockerCount: number;
  verifiedItemCount: number | null;
  productionProjectCount: number | null;
}): DashboardMetric[] {
  const metrics: DashboardMetric[] = [
    { key: "projects", label: "Projects", value: input.projectCount },
    { key: "decisions", label: "Open Decisions", value: input.openDecisionCount },
    { key: "blockers", label: "Open Blockers", value: input.openBlockerCount },
  ];
  if (input.verifiedItemCount !== null) {
    metrics.splice(1, 0, { key: "verified", label: "Verified Items", value: input.verifiedItemCount });
  }
  if (input.productionProjectCount !== null) {
    metrics.push({ key: "production", label: "Production Projects", value: input.productionProjectCount });
  }
  return metrics;
}

/** Reject decorative fake completion percentages in dashboard UI text. */
export function containsFakeProgressPercent(text: string): boolean {
  return /\b\d{1,3}\s*%\s*(complete|done|progress|finished)?\b/i.test(text);
}

export function pickActiveProject<T extends { id: string }>(projects: readonly T[]): T | null {
  return projects[0] ?? null;
}

export function countOpenDecisionsForProject(
  decisions: readonly { projectId: string | null }[],
  projectId: string,
): number {
  return decisions.filter((decision) => decision.projectId === projectId).length;
}
