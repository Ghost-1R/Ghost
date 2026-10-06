import type { ProductArchitectureStatus, ProductFeature, ProductRequirement } from "@/lib/product-architect/types";
import type { SystemArchitectureStatus } from "@/lib/system-architecture/types";
import { isValidEnvVariableName, looksLikeSecretValue } from "@/lib/system-architecture/workflow";
import type {
  ArchitectureLinkKind,
  ArchitectureRecordRef,
  BuildPlanBundle,
  BuildPlanStatus,
  DependencyEdgeKind,
  WorkPackage,
  WorkPackageArchitectureLink,
  WorkPackageDependency,
  WorkPackageFeatureLink,
  WorkPackageRequirementLink,
  WorkPackageStatus,
  WorkPackageVerification,
} from "./types";
import { V8_MANUAL_ACTION_STATUSES, V8_WORK_PACKAGE_STATUSES } from "./types";

export { isValidEnvVariableName, looksLikeSecretValue };

export const LEGAL_BUILD_PLAN_TRANSITIONS: Record<BuildPlanStatus, readonly BuildPlanStatus[]> = {
  DRAFT: ["PLANNING", "REVIEW"],
  PLANNING: ["DRAFT", "REVIEW"],
  REVIEW: ["PLANNING", "APPROVED", "DRAFT"],
  APPROVED: ["REVIEW", "BUILD_PLAN_READY", "PLANNING"],
  BUILD_PLAN_READY: ["APPROVED", "REVIEW"],
};

export function canTransitionBuildPlan(from: BuildPlanStatus, to: BuildPlanStatus): boolean {
  return LEGAL_BUILD_PLAN_TRANSITIONS[from].includes(to);
}

export type BuildHumanIdPrefix = "WP" | "PHASE" | "MAN" | "BRISK";

export function nextHumanId(prefix: BuildHumanIdPrefix, existing: string[]): string {
  let max = 0;
  for (const id of existing) {
    const match = id.match(new RegExp(`^${prefix}-(\\d+)$`));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

export function isV8PackageStatus(status: WorkPackageStatus): boolean {
  return (V8_WORK_PACKAGE_STATUSES as readonly string[]).includes(status);
}

export function isV8ManualStatus(status: string): boolean {
  return (V8_MANUAL_ACTION_STATUSES as readonly string[]).includes(status);
}

/**
 * DEPENDS_ON: from→to means from depends on to.
 * BLOCKS: from blocks to means to depends on from (edge to→from).
 * CAN_RUN_WITH is non-ordering.
 */
export function orderingDependsEdges(
  deps: Array<Pick<WorkPackageDependency, "fromPackageId" | "toPackageId" | "edgeKind">>,
): Array<{ dependentId: string; prerequisiteId: string; edgeKind: DependencyEdgeKind }> {
  const edges: Array<{ dependentId: string; prerequisiteId: string; edgeKind: DependencyEdgeKind }> = [];
  for (const dep of deps) {
    if (dep.edgeKind === "CAN_RUN_WITH") continue;
    if (dep.edgeKind === "DEPENDS_ON") {
      edges.push({ dependentId: dep.fromPackageId, prerequisiteId: dep.toPackageId, edgeKind: "DEPENDS_ON" });
    } else {
      edges.push({ dependentId: dep.toPackageId, prerequisiteId: dep.fromPackageId, edgeKind: "BLOCKS" });
    }
  }
  return edges;
}

/** Returns a cycle path of human ids if any DEPENDS_ON/BLOCKS cycle exists. */
export function detectDependencyCycles(
  packages: Array<Pick<WorkPackage, "id" | "humanId">>,
  deps: Array<Pick<WorkPackageDependency, "fromPackageId" | "toPackageId" | "edgeKind">>,
): string[] | null {
  const humanById = new Map(packages.map((row) => [row.id, row.humanId]));
  const adj = new Map<string, string[]>();
  for (const pkg of packages) adj.set(pkg.id, []);

  for (const edge of orderingDependsEdges(deps)) {
    if (!adj.has(edge.dependentId)) adj.set(edge.dependentId, []);
    adj.get(edge.dependentId)!.push(edge.prerequisiteId);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const dfs = (node: string): string[] | null => {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      const cycle = start >= 0 ? stack.slice(start) : [node];
      cycle.push(node);
      return cycle.map((id) => humanById.get(id) ?? id);
    }
    if (visited.has(node)) return null;
    visiting.add(node);
    stack.push(node);
    for (const next of adj.get(node) ?? []) {
      const found = dfs(next);
      if (found) return found;
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  };

  for (const pkg of packages) {
    const found = dfs(pkg.id);
    if (found) return found;
  }
  return null;
}

/** Topological execution waves. Wave 1 = packages with no unmet DEPENDS_ON/BLOCKS deps. */
export function computeExecutionWaves(
  packages: Array<Pick<WorkPackage, "id" | "humanId">>,
  deps: Array<Pick<WorkPackageDependency, "fromPackageId" | "toPackageId" | "edgeKind">>,
): string[][] {
  const humanById = new Map(packages.map((row) => [row.id, row.humanId]));
  const prerequisites = new Map<string, Set<string>>();
  for (const pkg of packages) prerequisites.set(pkg.id, new Set());

  for (const edge of orderingDependsEdges(deps)) {
    if (!prerequisites.has(edge.dependentId)) prerequisites.set(edge.dependentId, new Set());
    prerequisites.get(edge.dependentId)!.add(edge.prerequisiteId);
  }

  const remaining = new Set(packages.map((pkg) => pkg.id));
  const waves: string[][] = [];

  while (remaining.size > 0) {
    const waveIds = [...remaining]
      .filter((id) => [...(prerequisites.get(id) ?? [])].every((prereq) => !remaining.has(prereq)))
      .sort((a, b) => (humanById.get(a) ?? a).localeCompare(humanById.get(b) ?? b));

    if (waveIds.length === 0) {
      waves.push(
        [...remaining]
          .map((id) => humanById.get(id) ?? id)
          .sort((a, b) => a.localeCompare(b)),
      );
      break;
    }

    waves.push(waveIds.map((id) => humanById.get(id) ?? id));
    for (const id of waveIds) remaining.delete(id);
  }

  return waves;
}

/** Longest dependency chain by package count (not time). */
export function computeCriticalPath(
  packages: Array<Pick<WorkPackage, "id" | "humanId">>,
  deps: Array<Pick<WorkPackageDependency, "fromPackageId" | "toPackageId" | "edgeKind">>,
): string[] {
  if (packages.length === 0) return [];

  const humanById = new Map(packages.map((row) => [row.id, row.humanId]));
  const dependents = new Map<string, string[]>();
  for (const pkg of packages) dependents.set(pkg.id, []);

  for (const edge of orderingDependsEdges(deps)) {
    if (!dependents.has(edge.prerequisiteId)) dependents.set(edge.prerequisiteId, []);
    dependents.get(edge.prerequisiteId)!.push(edge.dependentId);
  }

  let best: string[] = [];
  const memo = new Map<string, string[]>();

  const longestFrom = (node: string, path: string[]): string[] => {
    if (path.includes(node)) return path.map((id) => humanById.get(id) ?? id);
    const cached = memo.get(node);
    if (cached && path.length === 0) return cached;

    const nextPath = [...path, node];
    const children = dependents.get(node) ?? [];
    if (children.length === 0) {
      return nextPath.map((id) => humanById.get(id) ?? id);
    }

    let localBest: string[] = [];
    for (const child of children) {
      const candidate = longestFrom(child, nextPath);
      if (candidate.length > localBest.length) localBest = candidate;
    }
    if (path.length === 0) memo.set(node, localBest);
    return localBest;
  };

  for (const pkg of packages) {
    const candidate = longestFrom(pkg.id, []);
    if (candidate.length > best.length) best = candidate;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Coverage helpers
// ---------------------------------------------------------------------------

export function linkedRequirementIds(links: Array<Pick<WorkPackageRequirementLink, "requirementId">>): Set<string> {
  return new Set(links.map((link) => link.requirementId));
}

export function linkedFeatureIds(links: Array<Pick<WorkPackageFeatureLink, "featureId">>): Set<string> {
  return new Set(links.map((link) => link.featureId));
}

export function linkedArchitectureRefs(
  links: Array<Pick<WorkPackageArchitectureLink, "linkKind" | "recordRef">>,
): Set<string> {
  return new Set(links.map((link) => `${link.linkKind}:${link.recordRef}`));
}

export function uncoveredCriticalRequirements(
  requirements: Array<Pick<ProductRequirement, "id" | "humanId" | "title" | "priority" | "approvalStatus">>,
  links: Array<Pick<WorkPackageRequirementLink, "requirementId">>,
): Array<Pick<ProductRequirement, "id" | "humanId" | "title" | "priority">> {
  const linked = linkedRequirementIds(links);
  return requirements
    .filter(
      (row) =>
        row.approvalStatus === "ACCEPTED" &&
        (row.priority === "CRITICAL" || row.priority === "HIGH") &&
        !linked.has(row.id),
    )
    .map((row) => ({ id: row.id, humanId: row.humanId, title: row.title, priority: row.priority }));
}

export function uncoveredApprovedFeatures(
  features: Array<Pick<ProductFeature, "id" | "humanId" | "name" | "status">>,
  links: Array<Pick<WorkPackageFeatureLink, "featureId">>,
): Array<Pick<ProductFeature, "id" | "humanId" | "name">> {
  const linked = linkedFeatureIds(links);
  return features
    .filter((row) => (row.status === "APPROVED" || row.status === "BUILD_READY") && !linked.has(row.id))
    .map((row) => ({ id: row.id, humanId: row.humanId, name: row.name }));
}

const KEY_ARCH_KINDS = new Set<ArchitectureLinkKind>(["COMPONENT", "ENTITY", "INTERFACE"]);

export function uncoveredKeyArchitecture(
  records: ArchitectureRecordRef[],
  links: Array<Pick<WorkPackageArchitectureLink, "linkKind" | "recordRef">>,
): ArchitectureRecordRef[] {
  const linked = linkedArchitectureRefs(links);
  return records.filter(
    (row) =>
      KEY_ARCH_KINDS.has(row.kind) &&
      row.status === "APPROVED" &&
      !linked.has(`${row.kind}:${row.humanId}`) &&
      !linked.has(`${row.kind}:${row.name}`),
  );
}

export function packagesMissingVerification(
  packages: Array<Pick<WorkPackage, "id" | "humanId">>,
  verifications: Array<Pick<WorkPackageVerification, "workPackageId">>,
): Array<Pick<WorkPackage, "id" | "humanId">> {
  const covered = new Set(verifications.map((row) => row.workPackageId));
  return packages.filter((pkg) => !covered.has(pkg.id));
}

export function packageMentionsDeployment(pkg: Pick<WorkPackage, "title" | "objective" | "description" | "databaseImpact">): boolean {
  return /deploy|migration|production/i.test(
    [pkg.title, pkg.objective, pkg.description, pkg.databaseImpact].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export type BuildReadinessGap = {
  code: string;
  message: string;
};

export type BuildReadinessResult = {
  buildPlanReady: boolean;
  gaps: BuildReadinessGap[];
  reasons: string[];
};

export type BuildReadinessInput = {
  plan: {
    summary: string;
    deploymentSequence: string[];
    status: BuildPlanStatus;
  };
  phases: Array<{ id: string }>;
  packages: Array<Pick<WorkPackage, "id" | "humanId" | "title" | "objective" | "description" | "databaseImpact">>;
  dependencies: Array<Pick<WorkPackageDependency, "fromPackageId" | "toPackageId" | "edgeKind">>;
  verifications: Array<Pick<WorkPackageVerification, "workPackageId">>;
  requirementLinks: Array<Pick<WorkPackageRequirementLink, "requirementId">>;
  featureLinks: Array<Pick<WorkPackageFeatureLink, "featureId">>;
  architectureLinks: Array<Pick<WorkPackageArchitectureLink, "linkKind" | "recordRef">>;
  requirements: Array<Pick<ProductRequirement, "id" | "humanId" | "title" | "priority" | "approvalStatus">>;
  features: Array<Pick<ProductFeature, "id" | "humanId" | "name" | "status">>;
  architectureRecords: ArchitectureRecordRef[];
  openDecisions: number;
  systemStatus: SystemArchitectureStatus | null;
  productStatus?: ProductArchitectureStatus | null;
};

/** Deterministic readiness — never AI-decided. Build-plan-ready is not coded or deployed. */
export function computeBuildPlanReadiness(input: BuildReadinessInput): BuildReadinessResult {
  const gaps: BuildReadinessGap[] = [];

  if (!input.plan.summary.trim()) {
    gaps.push({ code: "SUMMARY", message: "Build plan summary is missing." });
  }
  if (input.phases.length === 0) {
    gaps.push({ code: "NO_PHASES", message: "At least one build phase is required." });
  }
  if (input.packages.length === 0) {
    gaps.push({ code: "NO_PACKAGES", message: "At least one work package is required." });
  }

  for (const pkg of packagesMissingVerification(input.packages, input.verifications)) {
    gaps.push({
      code: `VERIFY_${pkg.humanId}`,
      message: `${pkg.humanId} has no planned verification.`,
    });
  }

  for (const requirement of uncoveredCriticalRequirements(input.requirements, input.requirementLinks)) {
    gaps.push({
      code: `REQ_${requirement.humanId}`,
      message: `Accepted ${requirement.priority} requirement ${requirement.humanId} has no work package link.`,
    });
  }

  for (const feature of uncoveredApprovedFeatures(input.features, input.featureLinks)) {
    gaps.push({
      code: `FEAT_${feature.humanId}`,
      message: `Approved feature ${feature.humanId} has no work package link.`,
    });
  }

  for (const record of uncoveredKeyArchitecture(input.architectureRecords, input.architectureLinks)) {
    gaps.push({
      code: `ARCH_${record.humanId}`,
      message: `Approved ${record.kind.toLowerCase()} ${record.humanId} has no work package architecture link.`,
    });
  }

  const cycle = detectDependencyCycles(input.packages, input.dependencies);
  if (cycle) {
    gaps.push({
      code: "DEPENDENCY_CYCLE",
      message: `Dependency cycle detected: ${cycle.join(" → ")}.`,
    });
  }

  if (input.packages.some(packageMentionsDeployment) && input.plan.deploymentSequence.length === 0) {
    gaps.push({
      code: "DEPLOYMENT_SEQUENCE",
      message: "A work package mentions deploy, migration, or production, but deployment_sequence is empty.",
    });
  }

  if (input.openDecisions > 0) {
    gaps.push({
      code: "OPEN_DECISIONS",
      message: `Resolve ${input.openDecisions} open decision${input.openDecisions === 1 ? "" : "s"}.`,
    });
  }

  if (input.systemStatus !== "ARCHITECTURE_READY") {
    gaps.push({
      code: "SYSTEM_NOT_READY",
      message: `System Architecture is ${input.systemStatus ?? "missing"}; it must be ARCHITECTURE_READY.`,
    });
  }

  if (input.plan.status !== "APPROVED" && input.plan.status !== "BUILD_PLAN_READY") {
    gaps.push({
      code: "NOT_APPROVED",
      message: `Build plan status is ${input.plan.status}; founder approval is required before BUILD_PLAN_READY.`,
    });
  }

  const buildPlanReady = gaps.length === 0;
  return {
    buildPlanReady,
    gaps,
    reasons: buildPlanReady
      ? [
          "Summary, phases, and work packages present",
          "Packages have planned verification",
          "Critical requirements, approved features, and key architecture are linked",
          "No dependency cycles; deployment sequence recorded when needed",
          "Decisions resolved and System Architecture is ARCHITECTURE_READY",
          "Plan is ready to code against. Nothing is implemented or deployed.",
        ]
      : gaps.map((gap) => gap.message),
  };
}

export function evaluateBuildPlanBundle(bundle: BuildPlanBundle): {
  readiness: BuildReadinessResult;
  cycle: string[] | null;
  waves: string[][];
  criticalPath: string[];
  blockers: BuildReadinessGap[];
} {
  const readiness = computeBuildPlanReadiness({
    plan: bundle.plan,
    phases: bundle.phases,
    packages: bundle.packages,
    dependencies: bundle.dependencies,
    verifications: bundle.verifications,
    requirementLinks: bundle.requirementLinks,
    featureLinks: bundle.featureLinks,
    architectureLinks: bundle.architectureLinks,
    requirements: bundle.requirements,
    features: bundle.features,
    architectureRecords: bundle.architectureRecords,
    openDecisions: bundle.openDecisionCount,
    systemStatus: bundle.systemStatus,
    productStatus: bundle.productStatus,
  });
  const cycle = detectDependencyCycles(bundle.packages, bundle.dependencies);
  const waves = computeExecutionWaves(bundle.packages, bundle.dependencies);
  const criticalPath = computeCriticalPath(bundle.packages, bundle.dependencies);
  return { readiness, cycle, waves, criticalPath, blockers: readiness.gaps };
}

export function suggestBuildNextAction(input: {
  readiness: BuildReadinessResult;
  planStatus: BuildPlanStatus;
  summaryPresent: boolean;
  phaseCount: number;
  packageCount: number;
}): { title: string; description: string; sourceKind: string } | null {
  const sourceKind = "build_plan";
  if (input.planStatus === "DRAFT" && (!input.summaryPresent || input.phaseCount === 0 || input.packageCount === 0)) {
    return {
      title: "Define build plan phases and work packages",
      description: "Describe phases and work packages before marking the plan ready to code.",
      sourceKind,
    };
  }
  const decisionGap = input.readiness.gaps.find((gap) => gap.code === "OPEN_DECISIONS");
  if (decisionGap) {
    return { title: "Resolve build plan decision", description: decisionGap.message, sourceKind };
  }
  const cycleGap = input.readiness.gaps.find((gap) => gap.code === "DEPENDENCY_CYCLE");
  if (cycleGap) {
    return { title: "Break work package dependency cycle", description: cycleGap.message, sourceKind };
  }
  const coverageGap = input.readiness.gaps.find(
    (gap) => gap.code.startsWith("REQ_") || gap.code.startsWith("FEAT_") || gap.code.startsWith("ARCH_") || gap.code.startsWith("VERIFY_"),
  );
  if (coverageGap) {
    return { title: "Close build plan coverage gaps", description: coverageGap.message, sourceKind };
  }
  if (input.readiness.gaps.some((gap) => gap.code === "SYSTEM_NOT_READY")) {
    return {
      title: "Bring System Architecture to ARCHITECTURE_READY",
      description: "Build Plan can only be marked ready when System Architecture is ARCHITECTURE_READY.",
      sourceKind,
    };
  }
  if (input.planStatus === "APPROVED" && !input.readiness.buildPlanReady) {
    return {
      title: "Close remaining Build Plan gaps",
      description: input.readiness.reasons[0] ?? "Build plan is not ready yet.",
      sourceKind,
    };
  }
  if (input.readiness.buildPlanReady && input.planStatus !== "BUILD_PLAN_READY") {
    return {
      title: "Mark Build Plan BUILD_PLAN_READY",
      description: "Planning gaps are closed. Ready means planned for coding, not implemented or deployed.",
      sourceKind,
    };
  }
  return null;
}
