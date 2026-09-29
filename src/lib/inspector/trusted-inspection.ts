import { randomUUID } from "node:crypto";
import type { GhostClient } from "@/lib/auth/session";
import { appendEvidence, appendReview, presentationRoot } from "@/lib/presentation/ledger";
import { evaluateCustomerFlows } from "@/lib/presentation/customer-probe";
import { customerHandoff } from "@/lib/presentation/gate";
import { computePresentationReview } from "@/lib/presentation/records";
import { persistEvidence, persistReview } from "@/lib/presentation/remote";
import { evaluateRequirementTrace } from "@/lib/presentation/requirement-trace";
import { evaluateResponsiveSurfaces } from "@/lib/presentation/responsive-runtime";
import { evaluateConversationRegression, evaluateModelProviderRegression } from "@/lib/presentation/regression-probes";
import { evaluateSecurityBoundary } from "@/lib/presentation/security-probe";
import { hashWorkingTree } from "@/lib/presentation/tree";
import { loadBlockers } from "@/lib/projects/queries";
import { SAFE_CHECKS } from "./checks";
import { runSafeCheck } from "./runner";
import type { EvidenceCheckType, EvidenceRecord, EvidenceStatus } from "@/lib/presentation/types";

const EVIDENCE_CHECKS: Record<string, EvidenceCheckType> = {
  lint: "lint",
  typescript: "typecheck",
  test: "test",
  build: "build",
  "git-status": "git_state",
};

export type TrustedInspectionResult = {
  error: string | null;
  treeBefore: string;
  treeAfter: string;
  stable: boolean;
  reviewResult: string | null;
  remoteIds: string[];
  gaps: string[];
  handoff: string | null;
};

async function persistCheck(input: {
  ownerId: string;
  projectId: string;
  runId: string;
  checkType: EvidenceCheckType;
  commitSha: string;
  treeHash: string;
  command: string;
  exitCode: number | null;
  durationMs: number;
  output: string;
  status: EvidenceStatus;
  createdAt: string;
}): Promise<EvidenceRecord | null> {
  const draft = {
    writer: "runner" as const,
    ownerId: input.ownerId,
    projectId: input.projectId,
    runId: input.runId,
    checkType: input.checkType,
    commitSha: input.commitSha,
    treeHash: input.treeHash,
    command: input.command,
    exitCode: input.exitCode,
    durationMs: input.durationMs,
    output: input.output,
    environment: "local" as const,
    status: input.status,
    createdAt: input.createdAt,
  };
  const { prepareEvidence } = await import("@/lib/presentation/records");
  const prepared = prepareEvidence(draft);
  if (!prepared.ok) {
    return null;
  }
  const remote = await persistEvidence(prepared.value);
  if (remote.status !== "written") {
    return null;
  }
  const record: EvidenceRecord = { ...prepared.value, id: remote.id };
  await appendEvidence(presentationRoot(), "runner", { ...draft, output: input.output }).catch(() => null);
  return record;
}

export async function executeTrustedInspection(input: {
  ownerId: string;
  projectId: string;
  cwd: string;
  supabase: GhostClient;
}): Promise<TrustedInspectionResult> {
  const before = await hashWorkingTree(input.cwd);
  const runId = randomUUID();
  const records: EvidenceRecord[] = [];
  for (const check of SAFE_CHECKS) {
    const checkType = EVIDENCE_CHECKS[check.id];
    if (!checkType) {
      continue;
    }
    const started = Date.now();
    const result = await runSafeCheck(check.id, {
      ownerId: input.ownerId,
      projectId: input.projectId,
      cwd: input.cwd,
    });
    if (!result) {
      continue;
    }
    const status: EvidenceStatus | null =
      result.status === "VERIFIED" ? "passed" : result.status === "FAILED" ? "failed" : result.status === "BLOCKED" ? "blocked" : null;
    if (!status) {
      continue;
    }
    const record = await persistCheck({
      ownerId: input.ownerId,
      projectId: input.projectId,
      runId,
      checkType,
      commitSha: before.commitSha,
      treeHash: before.treeHash,
      command: (check.command ?? [check.id]).join(" "),
      exitCode: result.exitCode,
      durationMs: Math.max(0, Date.now() - started),
      output: `${result.stdout}\n${result.stderr}\n${result.summary}`,
      status,
      createdAt: result.completedAt,
    });
    if (record) {
      records.push(record);
    }
  }

  const security = await evaluateSecurityBoundary(input.cwd);
  const flows = await evaluateCustomerFlows(input.supabase, input.projectId, input.cwd);
  const responsive = await evaluateResponsiveSurfaces({
    baseUrl: process.env.GHOST_RESPONSIVE_BASE_URL?.trim() || "http://127.0.0.1:3000",
    projectId: input.projectId,
    email: process.env.GHOST_LOCAL_FOUNDER_EMAIL?.trim() ?? "",
    password: process.env.GHOST_LOCAL_FOUNDER_PASSWORD?.trim() ?? "",
  });
  const conversationRegression = await evaluateConversationRegression(input.supabase, input.projectId);
  const providerRegression = await evaluateModelProviderRegression();
  const requirements = await evaluateRequirementTrace(input.supabase, input.projectId, input.cwd);
  for (const probe of [
    { checkType: "security" as const, command: "security-boundary", ...security },
    { checkType: "customer_flows" as const, command: "customer-flows", ...flows },
    { checkType: "responsive" as const, command: "responsive-viewports", ...responsive },
    { checkType: "regression" as const, command: "conversation-migration-regression", ...conversationRegression },
    { checkType: "regression" as const, command: "model-provider-regression", ...providerRegression },
    { checkType: "requirements" as const, command: "requirement-trace", status: requirements.status, exitCode: requirements.exitCode, output: requirements.output },
  ]) {
    const record = await persistCheck({
      ownerId: input.ownerId,
      projectId: input.projectId,
      runId,
      checkType: probe.checkType,
      commitSha: before.commitSha,
      treeHash: before.treeHash,
      command: probe.command,
      exitCode: probe.exitCode,
      durationMs: 1,
      output: probe.output,
      status: probe.status,
      createdAt: new Date().toISOString(),
    });
    if (record) {
      records.push(record);
    }
  }

  const after = await hashWorkingTree(input.cwd);
  const stable = before.commitSha === after.commitSha && before.treeHash === after.treeHash;
  if (!stable) {
    return {
      error: "The tree changed during inspection, so this evidence is not fresh.",
      treeBefore: before.treeHash,
      treeAfter: after.treeHash,
      stable: false,
      reviewResult: null,
      remoteIds: records.map((record) => record.id),
      gaps: [],
      handoff: null,
    };
  }

  const blockers = await loadBlockers(input.supabase, input.projectId);
  const review = computePresentationReview({
    ownerId: input.ownerId,
    projectId: input.projectId,
    commitSha: before.commitSha,
    treeHash: before.treeHash,
    environment: "local",
    presentingProduction: false,
    evidence: records,
    requirements: requirements.requirements,
    resolvedBugs: blockers.status === "ok" ? blockers.data.filter((item) => item.status === "RESOLVED").map((item) => ({ title: item.title })) : [],
    claimedResult: "READY",
  });
  const handoff = customerHandoff({
    result: review.result,
    current: true,
    built: review.traceability.filter((row) => row.status === "PASS").map((row) => row.requirement),
    completedRequirements: review.traceability.filter((row) => row.status === "PASS").map((row) => row.requirement),
    flows: ["sign-in", "project brain", "conversation", "memory", "inspector", "presentation"],
    responsive: responsive.status === "passed" ? ["mobile", "tablet", "desktop"] : [],
    deployment: null,
    limitations: review.traceability.filter((row) => row.status === "FUTURE_SCOPE").map((row) => `Future scope: ${row.requirement}`),
    demo: ["Sign in and open the GHOST project."],
  });
  await appendReview(presentationRoot(), review);
  await persistReview(review);
  return {
    error: null,
    treeBefore: before.treeHash,
    treeAfter: after.treeHash,
    stable: true,
    reviewResult: review.result,
    remoteIds: review.evidenceIds,
    gaps: review.gaps,
    handoff,
  };
}
