"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth/session";
import { loadBlockers, loadKnowledge, loadProjectDetail } from "@/lib/projects/queries";
import { randomUUID } from "node:crypto";
import { appendOverride, appendReview, listEvidence, presentationRoot } from "./ledger";
import { classifyRequirementScope } from "./gate";
import { computePresentationReview, prepareOverride } from "./records";
import { persistOverride, persistReview } from "./remote";
import { hashWorkingTree } from "./tree";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function runPresentationReview(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const projectId = readField(formData, "projectId");
  if (!UUID_PATTERN.test(projectId)) {
    return { error: "That project is not visible.", notice: null };
  }
  const project = await loadProjectDetail(session.supabase, projectId);
  if (project.status !== "ok" || !project.data) {
    return { error: "That project is not visible.", notice: null };
  }
  const [knowledge, blockers, evidence, tree] = await Promise.all([
    loadKnowledge(session.supabase, projectId),
    loadBlockers(session.supabase, projectId),
    listEvidence(presentationRoot(), session.user.id),
    hashWorkingTree(process.cwd()),
  ]);
  if (knowledge.status !== "ok" || blockers.status !== "ok") {
    return { error: "Project records could not be read.", notice: null };
  }
  const requirements: Array<{ title: string; scope: "current" | "future"; requiredNow: boolean; failed?: boolean }> = knowledge.data
    .filter((item) => item.kind === "REQUIREMENT")
    .map((item) => ({
      title: item.title,
      scope: classifyRequirementScope(item.title, item.content),
      requiredNow: false,
    }));
  if (readField(formData, "disposable") === "fail") {
    requirements.push({ title: "Disposable presentation requirement", scope: "current", requiredNow: true, failed: true });
  }
  const review = computePresentationReview({
    ownerId: session.user.id,
    projectId,
    commitSha: tree.commitSha,
    treeHash: tree.treeHash,
    environment: "local",
    presentingProduction: false,
    evidence: evidence.filter((row) => row.projectId === projectId),
    requirements,
    resolvedBugs: blockers.data.filter((item) => item.status === "RESOLVED").map((item) => ({ title: item.title })),
    claimedResult: readField(formData, "claimedResult"),
  });
  await appendReview(presentationRoot(), review);
  await persistReview(review).catch(() => null);
  revalidatePath("/presentation");
  return { error: null, notice: `Presentation review recorded: ${review.result}.` };
}

export async function recordPresentationOverride(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const projectId = readField(formData, "projectId");
  if (!UUID_PATTERN.test(projectId)) {
    return { error: "That project is not visible.", notice: null };
  }
  const project = await loadProjectDetail(session.supabase, projectId);
  if (project.status !== "ok" || !project.data) {
    return { error: "That project is not visible.", notice: null };
  }
  const [evidence, tree] = await Promise.all([
    listEvidence(presentationRoot(), session.user.id),
    hashWorkingTree(process.cwd()),
  ]);
  const projectEvidence = evidence.filter((row) => row.projectId === projectId);
  const prepared = prepareOverride(
    {
      ownerId: session.user.id,
      projectId,
      reason: readField(formData, "reason"),
      founderId: session.user.id,
      createdAt: new Date().toISOString(),
      target: readField(formData, "target"),
      commitSha: tree.commitSha,
      affectedChecks: readField(formData, "affectedChecks")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    },
    projectEvidence,
  );
  if (!prepared.ok) {
    return { error: prepared.reason, notice: null };
  }
  if (prepared.value.evidence.length !== projectEvidence.length) {
    return { error: "An override cannot change evidence.", notice: null };
  }
  await appendOverride(presentationRoot(), { ...prepared.value.override, id: randomUUID() });
  await persistOverride(prepared.value.override).catch(() => null);
  revalidatePath("/presentation");
  return { error: null, notice: "Override recorded as a separate history row. Evidence was not changed." };
}
