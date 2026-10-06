import { readFile } from "node:fs/promises";
import path from "node:path";
import type { GhostClient } from "@/lib/auth/session";
import { isSupportedVerified } from "@/lib/brain/verification";
import { loadFounderRules, loadMemoryProposals } from "@/lib/memory/queries";
import { loadLatestConversation } from "@/lib/conversation/queries";
import { loadBlockers, loadKnowledge, loadMilestones, loadNextActions, loadProjectDetail, loadVerification } from "@/lib/projects/queries";
import { classifyRequirementScope } from "./gate";
import { conversationSourceAvoidsDirectRules } from "./regression-probes";
import type { ProbeResult } from "./security-probe";

export type TracedRequirement = {
  title: string;
  content: string;
  implementationEvidence: string | null;
  verificationEvidence: string | null;
  scope: "current" | "future";
  requiredNow: boolean;
  failed?: boolean;
  blocked?: boolean;
};

function pair(implementation: string, verification: string): Pick<TracedRequirement, "implementationEvidence" | "verificationEvidence"> {
  return { implementationEvidence: implementation, verificationEvidence: verification };
}

export function deploymentRequirement(
  deployment: { provider?: unknown; vercelAllowed?: unknown },
  production: string,
): { ok: boolean; provider: string | null } {
  const named = typeof deployment.provider === "string" && deployment.provider.trim() ? deployment.provider.trim().toLowerCase() : null;
  const shapeOk = deployment.provider == null || named !== null;
  const ok =
    shapeOk &&
    deployment.vercelAllowed === false &&
    named !== "vercel" &&
    (named === null ? production === "NOT_DEPLOYED" : production === "DEPLOYED");
  return { ok, provider: named };
}

export async function evaluateRequirementTrace(supabase: GhostClient, projectId: string, cwd: string): Promise<ProbeResult & { requirements: TracedRequirement[] }> {
  const [project, knowledge, blockers, milestones, actions, verification, rules, proposals, conversation, proposalsOnly] = await Promise.all([
    loadProjectDetail(supabase, projectId),
    loadKnowledge(supabase, projectId),
    loadBlockers(supabase, projectId),
    loadMilestones(supabase, projectId),
    loadNextActions(supabase, projectId),
    loadVerification(supabase, projectId),
    loadFounderRules(supabase),
    loadMemoryProposals(supabase),
    loadLatestConversation(supabase, projectId),
    conversationSourceAvoidsDirectRules(cwd),
  ]);
  if (project.status !== "ok" || knowledge.status !== "ok" || !project.data) {
    return { status: "blocked", exitCode: 1, output: "Project Brain records could not be read.", requirements: [] };
  }
  const requirements = knowledge.data.filter((item) => item.kind === "REQUIREMENT");
  const statePath = path.join(cwd, ".ghost", "state.json");
  const guidePath = path.join(cwd, "GHOST.md");
  const stateText = await readFile(statePath, "utf8").catch(() => "");
  const guideText = await readFile(guidePath, "utf8").catch(() => "");
  let deployment: { provider?: unknown; vercelAllowed?: unknown } = {};
  let production = "";
  try {
    const parsed = JSON.parse(stateText) as { deployment?: { provider?: unknown; vercelAllowed?: unknown }; verification?: { production?: string } };
    deployment = parsed.deployment ?? {};
    production = parsed.verification?.production ?? "";
  } catch {
    deployment = {};
  }
  const traced: TracedRequirement[] = [];
  for (const requirement of requirements) {
    const scope = classifyRequirementScope(requirement.title, requirement.content);
    if (scope === "future") {
      traced.push({
        title: requirement.title,
        content: requirement.content,
        implementationEvidence: null,
        verificationEvidence: null,
        scope,
        requiredNow: false,
      });
      continue;
    }
    const base = { title: requirement.title, content: requirement.content, scope, requiredNow: false };
    if (requirement.title === "Project Brain") {
      const ok = Boolean(project.data.currentMilestone) && knowledge.data.length > 0 && blockers.status === "ok" && milestones.status === "ok" && actions.status === "ok" && conversation.status === "ok";
      traced.push({
        ...base,
        ...pair(
          `src/lib/projects/queries.ts; project_knowledge ${requirement.id}`,
          ok ? `live project ${project.data.id}; milestone ${project.data.currentMilestone}; knowledge ${knowledge.data.length}; blockers ${blockers.status === "ok" ? blockers.data.length : 0}; actions ${actions.status === "ok" ? actions.data.length : 0}; conversation ${conversation.status}` : "",
        ),
        failed: !ok,
      });
      continue;
    }
    if (requirement.title === "Founder Rules") {
      const active = rules.status === "ok" ? rules.data.filter((rule) => rule.status === "ACTIVE" && rule.approvedAt) : [];
      traced.push({
        ...base,
        ...pair("src/lib/memory/queries.ts loadFounderRules", active.length > 0 ? `live active approved rules ${active.length}; first ${active[0]?.id}` : ""),
        failed: active.length === 0,
      });
      continue;
    }
    if (requirement.title === "Project Knowledge") {
      const decisions = knowledge.data.filter((item) => item.kind === "DECISION").length;
      const constraints = knowledge.data.filter((item) => item.kind === "CONSTRAINT").length;
      const ok = requirements.length > 0 && decisions > 0 && constraints > 0;
      traced.push({
        ...base,
        ...pair(`project_knowledge ${requirement.id}`, ok ? `live requirements ${requirements.length}; decisions ${decisions}; constraints ${constraints}` : ""),
        failed: !ok,
      });
      continue;
    }
    if (requirement.title === "Portable project state") {
      const ok = guideText.includes("GHOST") && stateText.includes("schemaVersion");
      traced.push({
        ...base,
        ...pair("GHOST.md; .ghost/state.json", ok ? "both repository state files parsed" : ""),
        failed: !ok,
      });
      continue;
    }
    if (requirement.title === "Ground-truth verification") {
      const rows = verification.status === "ok" ? verification.data : [];
      const unsupported = rows.filter((row) => row.state === "VERIFIED" && !isSupportedVerified({ state: row.state, evidence: row.evidence, checkedAt: row.checkedAt }));
      const supported = rows.filter((row) => isSupportedVerified({ state: row.state, evidence: row.evidence, checkedAt: row.checkedAt }));
      const ok = verification.status === "ok" && unsupported.length === 0 && supported.length > 0;
      traced.push({
        ...base,
        ...pair("src/lib/brain/verification.ts isSupportedVerified", ok ? `live supported verified records ${supported.length}; unsupported ${unsupported.length}` : ""),
        failed: !ok,
      });
      continue;
    }
    if (requirement.title === "Memory proposals") {
      const pending = proposals.status === "ok" ? proposals.data.filter((item) => item.status === "PENDING") : [];
      const ok = proposals.status === "ok" && proposalsOnly && pending.length > 0;
      traced.push({
        ...base,
        ...pair("src/lib/conversation/actions.ts memory_proposals", ok ? `live pending proposals ${pending.length}; first ${pending[0]?.id}` : ""),
        failed: !ok,
      });
      continue;
    }
    if (requirement.title === "Milestones, blockers, and next actions") {
      const ok = milestones.status === "ok" && blockers.status === "ok" && actions.status === "ok" && milestones.data.length > 0 && blockers.data.length > 0 && actions.data.length > 0;
      traced.push({
        ...base,
        ...pair(
          "src/lib/projects/queries.ts loadMilestones loadBlockers loadNextActions",
          ok ? `live milestones ${milestones.data.length}; blockers ${blockers.data.length}; next actions ${actions.data.length}` : "",
        ),
        failed: !ok,
      });
      continue;
    }
    if (requirement.title === "Provider-independent deployment") {
      const { ok, provider } = deploymentRequirement(deployment, production);
      traced.push({
        ...base,
        ...pair("DEC-006; .ghost/state.json deployment", ok ? `provider ${provider ?? "unset"}; vercelAllowed false; production ${production}` : ""),
        failed: !ok,
      });
      continue;
    }
    if (requirement.title === "Idea Lab operating loop") {
      const [ideas, strategies, ideaSource, promoteSource] = await Promise.all([
        supabase.from("ideas").select("id").limit(1),
        supabase.from("idea_strategies").select("id").limit(1),
        readFile(path.join(cwd, "src/lib/ideas/workflow.ts"), "utf8").catch(() => ""),
        readFile(path.join(cwd, "src/lib/ideas/promote.ts"), "utf8").catch(() => ""),
      ]);
      const tablesOk = !ideas.error && !strategies.error;
      const codeOk =
        ideaSource.includes("canTransitionIdea") &&
        ideaSource.includes("computeIdeaReadiness") &&
        promoteSource.includes("promoted_project_id");
      const ok = tablesOk && codeOk;
      traced.push({
        ...base,
        ...pair(
          "src/lib/ideas/workflow.ts; src/lib/ideas/promote.ts; ideas; idea_strategies",
          ok
            ? `live ideas table ${ideas.error ? "error" : "ok"}; strategies table ${strategies.error ? "error" : "ok"}; promote path present`
            : "",
        ),
        failed: !ok,
      });
      continue;
    }
    if (requirement.title === "Product Architect operating loop") {
      const [architectures, features, architectSource, readinessSource] = await Promise.all([
        supabase.from("product_architectures").select("id").limit(1),
        supabase.from("product_features").select("id").limit(1),
        readFile(path.join(cwd, "src/lib/product-architect/truth.ts"), "utf8").catch(() => ""),
        readFile(path.join(cwd, "src/lib/product-architect/workflow.ts"), "utf8").catch(() => ""),
      ]);
      const tablesOk = !architectures.error && !features.error;
      const codeOk =
        architectSource.includes("isRequirementAuthoritative") &&
        readinessSource.includes("computeProductReadiness") &&
        readinessSource.includes("BUILD_READY");
      const ok = tablesOk && codeOk;
      traced.push({
        ...base,
        ...pair(
          "src/lib/product-architect; product_architectures; product_features",
          ok
            ? `live product tables ${architectures.error || features.error ? "error" : "ok"}; readiness and truth modules present`
            : "",
        ),
        failed: !ok,
      });
      continue;
    }
    if (requirement.title === "System Architecture operating loop") {
      const [systems, entities, truthSource, workflowSource] = await Promise.all([
        supabase.from("system_architectures").select("id").limit(1),
        supabase.from("system_entities").select("id").limit(1),
        readFile(path.join(cwd, "src/lib/system-architecture/truth.ts"), "utf8").catch(() => ""),
        readFile(path.join(cwd, "src/lib/system-architecture/workflow.ts"), "utf8").catch(() => ""),
      ]);
      const tablesOk = !systems.error && !entities.error;
      const codeOk =
        truthSource.includes("isArchitectureImplemented") &&
        workflowSource.includes("computeSystemReadiness") &&
        workflowSource.includes("validateSchemaDefects") &&
        workflowSource.includes("ARCHITECTURE_READY");
      const ok = tablesOk && codeOk;
      traced.push({
        ...base,
        ...pair(
          "src/lib/system-architecture; system_architectures; system_entities",
          ok
            ? `live system tables ${systems.error || entities.error ? "error" : "ok"}; readiness, schema validation, and truth modules present`
            : "",
        ),
        failed: !ok,
      });
      continue;
    }
    if (requirement.title === "Build Plan operating loop") {
      const [plans, packages, truthSource, workflowSource] = await Promise.all([
        supabase.from("build_plans").select("id").limit(1),
        supabase.from("work_packages").select("id").limit(1),
        readFile(path.join(cwd, "src/lib/build-plan/truth.ts"), "utf8").catch(() => ""),
        readFile(path.join(cwd, "src/lib/build-plan/workflow.ts"), "utf8").catch(() => ""),
      ]);
      const tablesOk = !plans.error && !packages.error;
      const codeOk =
        truthSource.includes("isPackageImplemented") &&
        workflowSource.includes("computeBuildPlanReadiness") &&
        workflowSource.includes("detectDependencyCycles") &&
        workflowSource.includes("BUILD_PLAN_READY");
      const ok = tablesOk && codeOk;
      traced.push({
        ...base,
        ...pair(
          "src/lib/build-plan; build_plans; work_packages",
          ok
            ? `live build plan tables ${plans.error || packages.error ? "error" : "ok"}; readiness, dependency, and truth modules present`
            : "",
        ),
        failed: !ok,
      });
      continue;
    }
    if (requirement.title === "Build Execution operating loop") {
      const [executions, packageExecutions, truthSource, workflowSource] = await Promise.all([
        supabase.from("build_executions").select("id").limit(1),
        supabase.from("work_package_executions").select("id").limit(1),
        readFile(path.join(cwd, "src/lib/build-execution/truth.ts"), "utf8").catch(() => ""),
        readFile(path.join(cwd, "src/lib/build-execution/workflow.ts"), "utf8").catch(() => ""),
      ]);
      const tablesOk = !executions.error && !packageExecutions.error;
      const codeOk =
        truthSource.includes("isExecutionImplemented") &&
        truthSource.includes("isVerified") &&
        workflowSource.includes("computeExecutionCompletion") &&
        workflowSource.includes("refreshDerivedPackageStatuses");
      const ok = tablesOk && codeOk;
      traced.push({
        ...base,
        ...pair(
          "src/lib/build-execution; build_executions; work_package_executions",
          ok
            ? `live build execution tables ${executions.error || packageExecutions.error ? "error" : "ok"}; readiness, completion, and truth modules present`
            : "",
        ),
        failed: !ok,
      });
      continue;
    }
    if (requirement.title === "Verification operating loop") {
      const [programs, cases, truthSource, workflowSource] = await Promise.all([
        supabase.from("verification_programs").select("id").limit(1),
        supabase.from("verification_cases").select("id").limit(1),
        readFile(path.join(cwd, "src/lib/verification/truth.ts"), "utf8").catch(() => ""),
        readFile(path.join(cwd, "src/lib/verification/workflow.ts"), "utf8").catch(() => ""),
      ]);
      const tablesOk = !programs.error && !cases.error;
      const codeOk =
        truthSource.includes("isProgramVerified") &&
        truthSource.includes("isDeployed") &&
        workflowSource.includes("computeVerificationCompletion") &&
        workflowSource.includes("isBlockingDefect");
      const ok = tablesOk && codeOk;
      traced.push({
        ...base,
        ...pair(
          "src/lib/verification; verification_programs; verification_cases",
          ok
            ? `live verification tables ${programs.error || cases.error ? "error" : "ok"}; completion and truth modules present`
            : "",
        ),
        failed: !ok,
      });
      continue;
    }
    traced.push({ ...base, implementationEvidence: null, verificationEvidence: null });
  }
  const lines = traced.map((item) => {
    const state = item.scope === "future" ? "FUTURE_SCOPE" : item.failed ? "FAIL" : item.implementationEvidence && item.verificationEvidence ? "VERIFIED" : "NOT_VERIFIED";
    return `${item.title}: ${state}`;
  });
  const failed = traced.some((item) => item.scope !== "future" && (item.failed || !item.implementationEvidence || !item.verificationEvidence));
  return { status: failed ? "failed" : "passed", exitCode: failed ? 1 : 0, output: lines.join("\n"), requirements: traced };
}
