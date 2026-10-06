import { orderingDependsEdges } from "@/lib/build-plan/workflow";
import { looksLikeSecretValue } from "@/lib/system-architecture/workflow";
import type {
  BuildExecutionBundle,
  BuildExecutionStatus,
  ExecutionBlocker,
  ImplementationEvidence,
  PackageExecutionStatus,
  UpstreamChange,
  WorkPackageExecution,
} from "./types";
import type { WorkPackageDependency } from "@/lib/build-plan/types";
import type { ProductFeature, ProductRequirement } from "@/lib/product-architect/types";

export { looksLikeSecretValue };

export const LEGAL_BUILD_EXECUTION_TRANSITIONS: Record<
  BuildExecutionStatus,
  readonly BuildExecutionStatus[]
> = {
  NOT_STARTED: ["EXECUTING"],
  EXECUTING: ["IMPLEMENTATION_REVIEW", "NOT_STARTED"],
  IMPLEMENTATION_REVIEW: ["EXECUTING", "IMPLEMENTED"],
  IMPLEMENTED: ["IMPLEMENTATION_REVIEW", "EXECUTING"],
};

export function canTransitionBuildExecution(from: BuildExecutionStatus, to: BuildExecutionStatus): boolean {
  return LEGAL_BUILD_EXECUTION_TRANSITIONS[from].includes(to);
}

export const LEGAL_PACKAGE_EXECUTION_TRANSITIONS: Record<
  PackageExecutionStatus,
  readonly PackageExecutionStatus[]
> = {
  QUEUED: ["READY", "BLOCKED"],
  READY: ["IN_PROGRESS", "BLOCKED", "QUEUED"],
  IN_PROGRESS: ["IMPLEMENTED", "BLOCKED", "READY"],
  BLOCKED: ["READY", "QUEUED", "IN_PROGRESS"],
  /** Reopen only with an explicit reason — rare. */
  IMPLEMENTED: ["IN_PROGRESS"],
};

export function canTransitionPackageExecution(
  from: PackageExecutionStatus,
  to: PackageExecutionStatus,
): boolean {
  return LEGAL_PACKAGE_EXECUTION_TRANSITIONS[from].includes(to);
}

export function rejectSecretEvidenceReference(reference: string): { ok: boolean; reason: string | null } {
  const value = reference.trim();
  if (!value) return { ok: false, reason: "Evidence reference is required." };
  if (looksLikeSecretValue(value)) {
    return {
      ok: false,
      reason: "That looks like a secret value. Store a reference (commit SHA, path, route name), never secret values.",
    };
  }
  return { ok: true, reason: null };
}

export type PackageReadinessInput = {
  packages: Array<{
    id: string;
    workPackageId: string;
    status: PackageExecutionStatus;
  }>;
  dependencies: Array<Pick<WorkPackageDependency, "fromPackageId" | "toPackageId" | "edgeKind">>;
  openBlockers: Array<Pick<ExecutionBlocker, "packageExecutionId" | "status">>;
  openUpstreamChanges: Array<Pick<UpstreamChange, "packageExecutionId" | "status">>;
  openDecisions?: number;
};

/**
 * A package is READY only if all DEPENDS_ON/BLOCKS predecessors are IMPLEMENTED,
 * there is no open blocker on itself, and no open upstream change blocking it.
 * openDecisions at the project level do not force packages out of READY by themselves
 * (they block the IMPLEMENTED execution gate instead).
 */
export function computePackageReadiness(
  input: PackageReadinessInput,
): Map<string, { ready: boolean; reasons: string[] }> {
  const byWorkPackage = new Map(input.packages.map((pkg) => [pkg.workPackageId, pkg]));
  const edges = orderingDependsEdges(input.dependencies);
  const openBlockerIds = new Set(
    input.openBlockers.filter((row) => row.status === "OPEN").map((row) => row.packageExecutionId),
  );
  const openUpstreamByPkg = new Set(
    input.openUpstreamChanges
      .filter((row) => row.status === "OPEN" && row.packageExecutionId)
      .map((row) => row.packageExecutionId as string),
  );

  const result = new Map<string, { ready: boolean; reasons: string[] }>();
  for (const pkg of input.packages) {
    const reasons: string[] = [];
    const prereqs = edges.filter((edge) => edge.dependentId === pkg.workPackageId);
    for (const edge of prereqs) {
      const predecessor = byWorkPackage.get(edge.prerequisiteId);
      if (!predecessor || predecessor.status !== "IMPLEMENTED") {
        reasons.push(`Predecessor work package ${edge.prerequisiteId.slice(0, 8)} is not IMPLEMENTED.`);
      }
    }
    if (openBlockerIds.has(pkg.id)) {
      reasons.push("Open execution blocker on this package.");
    }
    if (openUpstreamByPkg.has(pkg.id)) {
      reasons.push("Open upstream change blocks this package.");
    }
    result.set(pkg.id, { ready: reasons.length === 0, reasons });
  }
  return result;
}

/**
 * Pure derived status suggestions for QUEUED ↔ READY only.
 * Never invents IMPLEMENTED, never mutates IN_PROGRESS / BLOCKED / IMPLEMENTED.
 */
export function refreshDerivedPackageStatuses(
  packages: Array<{ id: string; workPackageId: string; status: PackageExecutionStatus }>,
  dependencies: Array<Pick<WorkPackageDependency, "fromPackageId" | "toPackageId" | "edgeKind">>,
  openBlockers: Array<Pick<ExecutionBlocker, "packageExecutionId" | "status">> = [],
  openUpstreamChanges: Array<Pick<UpstreamChange, "packageExecutionId" | "status">> = [],
): Map<string, PackageExecutionStatus> {
  const readiness = computePackageReadiness({
    packages,
    dependencies,
    openBlockers,
    openUpstreamChanges,
  });
  const suggested = new Map<string, PackageExecutionStatus>();
  for (const pkg of packages) {
    if (pkg.status !== "QUEUED" && pkg.status !== "READY") continue;
    const info = readiness.get(pkg.id);
    if (!info) continue;
    if (pkg.status === "QUEUED" && info.ready) {
      suggested.set(pkg.id, "READY");
    } else if (pkg.status === "READY" && !info.ready) {
      suggested.set(pkg.id, "QUEUED");
    }
  }
  return suggested;
}

/**
 * Execution waves for remaining (non-IMPLEMENTED) packages.
 * Prerequisites that are IMPLEMENTED are treated as satisfied.
 */
export function computeExecutionWavesFromPackages(
  packages: Array<{ id: string; workPackageId: string; humanId: string; status: PackageExecutionStatus }>,
  deps: Array<Pick<WorkPackageDependency, "fromPackageId" | "toPackageId" | "edgeKind">>,
): string[][] {
  const humanByWp = new Map(packages.map((row) => [row.workPackageId, row.humanId]));
  const statusByWp = new Map(packages.map((row) => [row.workPackageId, row.status]));
  const remaining = new Set(
    packages.filter((row) => row.status !== "IMPLEMENTED").map((row) => row.workPackageId),
  );
  const prerequisites = new Map<string, Set<string>>();
  for (const id of remaining) prerequisites.set(id, new Set());

  for (const edge of orderingDependsEdges(deps)) {
    if (!remaining.has(edge.dependentId)) continue;
    if (!prerequisites.has(edge.dependentId)) prerequisites.set(edge.dependentId, new Set());
    if (statusByWp.get(edge.prerequisiteId) === "IMPLEMENTED") continue;
    if (remaining.has(edge.prerequisiteId)) {
      prerequisites.get(edge.dependentId)!.add(edge.prerequisiteId);
    }
  }

  const waves: string[][] = [];
  const left = new Set(remaining);

  while (left.size > 0) {
    const waveIds = [...left]
      .filter((id) => [...(prerequisites.get(id) ?? [])].every((prereq) => !left.has(prereq)))
      .sort((a, b) => (humanByWp.get(a) ?? a).localeCompare(humanByWp.get(b) ?? b));

    if (waveIds.length === 0) {
      waves.push(
        [...left]
          .map((id) => humanByWp.get(id) ?? id)
          .sort((a, b) => a.localeCompare(b)),
      );
      break;
    }

    waves.push(waveIds.map((id) => humanByWp.get(id) ?? id));
    for (const id of waveIds) left.delete(id);
  }

  return waves;
}

export type CoverageRow = {
  id: string;
  humanId: string;
  title: string;
  packageExecutionStatuses: PackageExecutionStatus[];
  implemented: boolean;
};

export function computeImplementationCoverage(input: {
  requirements: Array<Pick<ProductRequirement, "id" | "humanId" | "title">>;
  features: Array<Pick<ProductFeature, "id" | "humanId" | "name">>;
  requirementLinks: Array<{ workPackageId: string; requirementId: string }>;
  featureLinks: Array<{ workPackageId: string; featureId: string }>;
  packageExecutions: Array<Pick<WorkPackageExecution, "workPackageId" | "status">>;
}): { requirements: CoverageRow[]; features: CoverageRow[] } {
  const statusByWp = new Map(input.packageExecutions.map((row) => [row.workPackageId, row.status]));

  const requirements: CoverageRow[] = input.requirements.map((req) => {
    const linkedPackages = input.requirementLinks
      .filter((link) => link.requirementId === req.id)
      .map((link) => statusByWp.get(link.workPackageId))
      .filter((status): status is PackageExecutionStatus => Boolean(status));
    return {
      id: req.id,
      humanId: req.humanId,
      title: req.title,
      packageExecutionStatuses: linkedPackages,
      implemented: linkedPackages.length > 0 && linkedPackages.every((status) => status === "IMPLEMENTED"),
    };
  });

  const features: CoverageRow[] = input.features.map((feat) => {
    const linkedPackages = input.featureLinks
      .filter((link) => link.featureId === feat.id)
      .map((link) => statusByWp.get(link.workPackageId))
      .filter((status): status is PackageExecutionStatus => Boolean(status));
    return {
      id: feat.id,
      humanId: feat.humanId,
      title: feat.name,
      packageExecutionStatuses: linkedPackages,
      implemented: linkedPackages.length > 0 && linkedPackages.every((status) => status === "IMPLEMENTED"),
    };
  });

  return { requirements, features };
}

export type ExecutionCompletionGap = {
  code: string;
  message: string;
};

export type ExecutionCompletionResult = {
  implementationComplete: boolean;
  gaps: ExecutionCompletionGap[];
  reasons: string[];
};

export type ExecutionCompletionInput = {
  executionStatus: BuildExecutionStatus;
  planStatus: string | null;
  packageExecutions: Array<Pick<WorkPackageExecution, "id" | "workPackageId" | "status">>;
  evidence: Array<Pick<ImplementationEvidence, "packageExecutionId">>;
  openBlockers: Array<Pick<ExecutionBlocker, "status">>;
  openUpstreamChanges: Array<Pick<UpstreamChange, "status">>;
  openDecisions: number;
};

/** Gaps for the IMPLEMENTED execution gate. Implementation ≠ verification ≠ deployment. */
export function computeExecutionCompletion(input: ExecutionCompletionInput): ExecutionCompletionResult {
  const gaps: ExecutionCompletionGap[] = [];

  if (input.planStatus !== "BUILD_PLAN_READY") {
    gaps.push({
      code: "PLAN_NOT_READY",
      message: `Build Plan is ${input.planStatus ?? "missing"}; it must remain BUILD_PLAN_READY.`,
    });
  }

  if (input.packageExecutions.length === 0) {
    gaps.push({ code: "NO_PACKAGES", message: "No work package executions are recorded." });
  }

  for (const pkg of input.packageExecutions) {
    if (pkg.status !== "IMPLEMENTED") {
      gaps.push({
        code: `PKG_${pkg.workPackageId.slice(0, 8)}`,
        message: `Package execution ${pkg.workPackageId.slice(0, 8)} is ${pkg.status}, not IMPLEMENTED.`,
      });
    }
  }

  const evidenceByPkg = new Set(input.evidence.map((row) => row.packageExecutionId));
  for (const pkg of input.packageExecutions) {
    if (pkg.status === "IMPLEMENTED" && !evidenceByPkg.has(pkg.id)) {
      gaps.push({
        code: `EVIDENCE_${pkg.id.slice(0, 8)}`,
        message: `Implemented package ${pkg.workPackageId.slice(0, 8)} has no implementation evidence.`,
      });
    }
  }

  const openBlockers = input.openBlockers.filter((row) => row.status === "OPEN").length;
  if (openBlockers > 0) {
    gaps.push({
      code: "OPEN_BLOCKERS",
      message: `${openBlockers} open execution blocker${openBlockers === 1 ? "" : "s"} remain.`,
    });
  }

  const openUpstream = input.openUpstreamChanges.filter((row) => row.status === "OPEN").length;
  if (openUpstream > 0) {
    gaps.push({
      code: "OPEN_UPSTREAM",
      message: `${openUpstream} open upstream change${openUpstream === 1 ? "" : "s"} remain.`,
    });
  }

  if (input.openDecisions > 0) {
    gaps.push({
      code: "OPEN_DECISIONS",
      message: `Resolve ${input.openDecisions} open decision${input.openDecisions === 1 ? "" : "s"}.`,
    });
  }

  if (input.executionStatus !== "IMPLEMENTATION_REVIEW" && input.executionStatus !== "IMPLEMENTED") {
    gaps.push({
      code: "NOT_IN_REVIEW",
      message: `Execution status is ${input.executionStatus}; move to IMPLEMENTATION_REVIEW before IMPLEMENTED.`,
    });
  }

  const implementationComplete = gaps.length === 0;
  return {
    implementationComplete,
    gaps,
    reasons: implementationComplete
      ? [
          "Build Plan remains BUILD_PLAN_READY",
          "All package executions are IMPLEMENTED with evidence",
          "No open blockers or upstream changes",
          "Open decisions resolved",
          "IMPLEMENTED means evidence-backed implementation only — not verified or deployed",
        ]
      : gaps.map((gap) => gap.message),
  };
}

export function evaluateExecutionBundle(bundle: BuildExecutionBundle): {
  completion: ExecutionCompletionResult;
  readiness: Map<string, { ready: boolean; reasons: string[] }>;
  waves: string[][];
  coverage: ReturnType<typeof computeImplementationCoverage>;
  blockers: ExecutionCompletionGap[];
} {
  const openBlockers = bundle.blockers.filter((row) => row.status === "OPEN");
  const openUpstream = bundle.upstreamChanges.filter((row) => row.status === "OPEN");
  const readiness = computePackageReadiness({
    packages: bundle.packageExecutions,
    dependencies: bundle.dependencies,
    openBlockers,
    openUpstreamChanges: openUpstream,
    openDecisions: bundle.openDecisionCount,
  });
  const humanByWp = new Map(bundle.packages.map((row) => [row.id, row.humanId]));
  const waves = computeExecutionWavesFromPackages(
    bundle.packageExecutions.map((row) => ({
      id: row.id,
      workPackageId: row.workPackageId,
      humanId: humanByWp.get(row.workPackageId) ?? row.workPackageId.slice(0, 8),
      status: row.status,
    })),
    bundle.dependencies,
  );
  const coverage = computeImplementationCoverage({
    requirements: bundle.requirements,
    features: bundle.features,
    requirementLinks: bundle.requirementLinks,
    featureLinks: bundle.featureLinks,
    packageExecutions: bundle.packageExecutions,
  });
  const completion = computeExecutionCompletion({
    executionStatus: bundle.execution.status,
    planStatus: bundle.planStatus,
    packageExecutions: bundle.packageExecutions,
    evidence: bundle.evidence,
    openBlockers: bundle.blockers,
    openUpstreamChanges: bundle.upstreamChanges,
    openDecisions: bundle.openDecisionCount,
  });
  return { completion, readiness, waves, coverage, blockers: completion.gaps };
}

export function suggestExecutionNextAction(input: {
  completion: ExecutionCompletionResult;
  executionStatus: BuildExecutionStatus;
  packageExecutions: Array<Pick<WorkPackageExecution, "status">>;
}): { title: string; description: string; sourceKind: string } | null {
  const sourceKind = "build_execution";
  const inProgress = input.packageExecutions.filter((row) => row.status === "IN_PROGRESS").length;
  const ready = input.packageExecutions.filter((row) => row.status === "READY").length;
  const blocked = input.packageExecutions.filter((row) => row.status === "BLOCKED").length;

  if (blocked > 0) {
    return {
      title: "Resolve execution blocker",
      description: `${blocked} work package${blocked === 1 ? " is" : "s are"} BLOCKED.`,
      sourceKind,
    };
  }
  const decisionGap = input.completion.gaps.find((gap) => gap.code === "OPEN_DECISIONS");
  if (decisionGap) {
    return { title: "Resolve build execution decision", description: decisionGap.message, sourceKind };
  }
  const upstreamGap = input.completion.gaps.find((gap) => gap.code === "OPEN_UPSTREAM");
  if (upstreamGap) {
    return { title: "Resolve upstream change", description: upstreamGap.message, sourceKind };
  }
  if (inProgress === 0 && ready > 0) {
    return {
      title: "Begin next ready work package",
      description: `${ready} package${ready === 1 ? " is" : "s are"} READY to start.`,
      sourceKind,
    };
  }
  if (inProgress > 0) {
    return {
      title: "Record implementation evidence",
      description: "Add evidence before marking the in-progress package IMPLEMENTED.",
      sourceKind,
    };
  }
  if (
    input.completion.implementationComplete === false &&
    input.packageExecutions.every((row) => row.status === "IMPLEMENTED") &&
    input.executionStatus === "EXECUTING"
  ) {
    return {
      title: "Move execution to IMPLEMENTATION_REVIEW",
      description: "Packages are implemented with evidence. Review before marking IMPLEMENTED.",
      sourceKind,
    };
  }
  if (input.completion.implementationComplete && input.executionStatus === "IMPLEMENTATION_REVIEW") {
    return {
      title: "Mark Build Execution IMPLEMENTED",
      description: "Completion gaps are closed. IMPLEMENTED is not verified or deployed.",
      sourceKind,
    };
  }
  if (input.executionStatus === "NOT_STARTED" && ready > 0) {
    return {
      title: "Begin next ready work package",
      description: "Start the first READY package to move execution into EXECUTING.",
      sourceKind,
    };
  }
  return null;
}
