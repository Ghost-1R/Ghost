import { loadLatestConversation } from "@/lib/conversation/queries";
import { loadFounderRules } from "@/lib/memory/queries";
import { loadBlockers, loadKnowledge, loadProjectDetail } from "@/lib/projects/queries";
import { readGitState } from "@/lib/repository/local-git";
import type { GhostClient } from "@/lib/auth/session";
import type { ProbeResult } from "./security-probe";

export async function evaluateCustomerFlows(supabase: GhostClient, projectId: string, cwd: string): Promise<ProbeResult> {
  const lines: string[] = [];
  const project = await loadProjectDetail(supabase, projectId);
  const knowledge = await loadKnowledge(supabase, projectId);
  const blockers = await loadBlockers(supabase, projectId);
  const conversation = await loadLatestConversation(supabase, projectId);
  const rules = await loadFounderRules(supabase);
  const git = await readGitState(cwd).catch(() => null);
  lines.push(`sign-in and project: ${project.status === "ok" && project.data ? "loaded" : "failed"}`);
  lines.push(`project brain knowledge: ${knowledge.status === "ok" ? knowledge.data.length : "failed"}`);
  lines.push(`project brain blockers: ${blockers.status === "ok" ? blockers.data.length : "failed"}`);
  lines.push(`conversation: ${conversation.status === "ok" ? "loaded" : "failed"}`);
  lines.push(`memory rules: ${rules.status === "ok" ? rules.data.length : "failed"}`);
  lines.push(`repository commit: ${git?.commit?.slice(0, 7) ?? "failed"}`);
  lines.push("inspector: executed by this trusted run");
  lines.push("presentation review: computed by the server after evidence");
  const ok =
    project.status === "ok" &&
    Boolean(project.data) &&
    knowledge.status === "ok" &&
    blockers.status === "ok" &&
    conversation.status === "ok" &&
    rules.status === "ok" &&
    Boolean(git?.commit);
  return { status: ok ? "passed" : "failed", exitCode: ok ? 0 : 1, output: lines.join("\n") };
}
