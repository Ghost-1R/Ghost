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
      const ok = deployment.provider == null && deployment.vercelAllowed === false && production === "NOT_DEPLOYED";
      traced.push({
        ...base,
        ...pair("DEC-006; .ghost/state.json deployment", ok ? "provider unset; vercelAllowed false; production NOT_DEPLOYED" : ""),
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
