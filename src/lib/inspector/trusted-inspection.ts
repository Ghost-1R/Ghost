import { randomUUID } from "node:crypto";
import type { GhostClient } from "@/lib/auth/session";
import { appendEvidence, appendReview, presentationRoot } from "@/lib/presentation/ledger";
import { evaluateCustomerFlows } from "@/lib/presentation/customer-probe";
import { customerHandoff } from "@/lib/presentation/gate";
import { computePresentationReview } from "@/lib/presentation/records";
import { persistEvidence, persistReview } from "@/lib/presentation/remote";
import { evaluateRequirementTrace } from "@/lib/presentation/requirement-trace";
import { evaluateProductionHealth } from "@/lib/presentation/production-probe";
import { evaluateResponsiveSurfaces, sessionCookies } from "@/lib/presentation/responsive-runtime";
import { isExcludedRepositoryPath } from "@/lib/repository/exclude";
import { readGitState } from "@/lib/repository/local-git";
import {
  evaluateConversationRegression,
  evaluateIdeaLabRegression,
  evaluateModelProviderRegression,
  evaluateRepositoryRegression,
  evaluateSignupRegression,
} from "@/lib/presentation/regression-probes";
import { evaluateSecurityBoundary } from "@/lib/presentation/security-probe";
import { hashWorkingTree } from "@/lib/presentation/tree";
import { loadBlockers } from "@/lib/projects/queries";
import { SAFE_CHECKS } from "./checks";
import { runSafeCheck } from "./runner";
import { productionUrl, type InspectionTarget } from "./runtime";
import { commandWaves, PARALLEL_PROBES, type InspectionProgress } from "./schedule";
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
  environment: "local" | "production";
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
    environment: input.environment,
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
  target?: InspectionTarget;
  supabase: GhostClient;
  onProgress?: (event: InspectionProgress) => void;
}): Promise<TrustedInspectionResult> {
  const runStarted = Date.now();
  const emit = (event: Omit<InspectionProgress, "elapsedMs">) => {
    input.onProgress?.({ ...event, elapsedMs: Date.now() - runStarted });
  };
  const production = input.target === "production";
  const environment = production ? ("production" as const) : ("local" as const);
  const baseUrl = production ? productionUrl() : process.env.GHOST_RESPONSIVE_BASE_URL?.trim() || "http://127.0.0.1:3000";
  if (!baseUrl) {
    throw new Error("No production URL is configured for the runner.");
  }
  const founderEmail = process.env.GHOST_LOCAL_FOUNDER_EMAIL?.trim() ?? "";
  const founderPassword = process.env.GHOST_LOCAL_FOUNDER_PASSWORD?.trim() ?? "";
  emit({ stage: "PREPARING", check: null, status: "running", detail: production ? `Reading the working tree for ${baseUrl}` : "Reading the working tree" });
  const before = await hashWorkingTree(input.cwd);
  const runId = randomUUID();
  const records: EvidenceRecord[] = [];
  let ledger = Promise.resolve();
  const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
    const run = ledger.then(task, task);
    ledger = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  const evidenceIds = SAFE_CHECKS.map((check) => check.id).filter((id) => EVIDENCE_CHECKS[id]);

  async function runCommand(checkId: string) {
    const check = SAFE_CHECKS.find((item) => item.id === checkId);
    const checkType = check ? EVIDENCE_CHECKS[check.id] : undefined;
    if (!check || !checkType) {
      return;
    }
    emit({ stage: "RUNNING", check: check.name, status: "running", detail: check.name });
    const started = Date.now();
    const result = await runSafeCheck(check.id, {
      ownerId: input.ownerId,
      projectId: input.projectId,
      cwd: input.cwd,
    });
    if (!result) {
      return;
    }
    const status: EvidenceStatus | null =
      result.status === "VERIFIED" ? "passed" : result.status === "FAILED" ? "failed" : result.status === "BLOCKED" ? "blocked" : null;
    if (!status) {
      return;
    }
    emit({ stage: "COLLECTING_EVIDENCE", check: check.name, status, durationMs: Date.now() - started, detail: check.name });
    const record = await enqueue(() =>
      persistCheck({
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
        environment,
        createdAt: result.completedAt,
      }),
    );
    if (record) {
      records.push(record);
    }
  }

  for (const wave of commandWaves(evidenceIds)) {
    await Promise.all(wave.map((checkId) => runCommand(checkId)));
  }

  async function runProbe<T extends { status: EvidenceStatus; exitCode: number | null; output: string }>(
    checkType: EvidenceCheckType,
    command: string,
    run: () => Promise<T>,
  ): Promise<T> {
    emit({ stage: "VERIFYING", check: command, status: "running", detail: command });
    const started = Date.now();
    const result = await run();
    const record = await enqueue(() =>
      persistCheck({
        ownerId: input.ownerId,
        projectId: input.projectId,
        runId,
        checkType,
        commitSha: before.commitSha,
        treeHash: before.treeHash,
        command,
        exitCode: result.exitCode,
        durationMs: Math.max(0, Date.now() - started),
        output: result.output,
        status: result.status,
        environment,
        createdAt: new Date().toISOString(),
      }),
    );
    emit({ stage: "VERIFYING", check: command, status: result.status, durationMs: Date.now() - started, detail: command });
    if (record) {
      records.push(record);
    }
    return result;
  }

  const crossUserProbes = async () => {
    await runProbe("security", PARALLEL_PROBES[0], () => evaluateSecurityBoundary(input.cwd));
    await runProbe("regression", PARALLEL_PROBES[3], () => evaluateConversationRegression(input.supabase, input.projectId));
  };

  const productionProbe = async () => {
    if (!production) {
      return;
    }
    const git = await readGitState(input.cwd);
    const runnerClean = git.commit === before.commitSha && git.changedFiles.every((file) => isExcludedRepositoryPath(file));
    await runProbe("prod_health", PARALLEL_PROBES[6], () =>
      evaluateProductionHealth({
        baseUrl,
        runnerCommit: before.commitSha,
        runnerClean,
        projectId: input.projectId,
        cookieHeader: async () =>
          (await sessionCookies(baseUrl, founderEmail, founderPassword)).map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
        secrets: [
          process.env.SUPABASE_SERVICE_ROLE_KEY,
          process.env.GROQ_API_KEY,
          process.env.OPENAI_API_KEY,
          process.env.XAI_API_KEY,
          process.env.ANTHROPIC_API_KEY,
          founderPassword,
        ].filter((value): value is string => Boolean(value?.trim())),
      }),
    );
  };

  const [, , responsive, , requirements] = await Promise.all([
    crossUserProbes(),
    runProbe("customer_flows", PARALLEL_PROBES[1], () => evaluateCustomerFlows(input.supabase, input.projectId, input.cwd)),
    runProbe("responsive", PARALLEL_PROBES[2], () =>
      evaluateResponsiveSurfaces({
        baseUrl,
        projectId: input.projectId,
        email: founderEmail,
        password: founderPassword,
      }),
    ),
    runProbe("regression", PARALLEL_PROBES[4], () => evaluateModelProviderRegression()),
    runProbe("requirements", PARALLEL_PROBES[5], () => evaluateRequirementTrace(input.supabase, input.projectId, input.cwd)),
    productionProbe(),
    runProbe("regression", PARALLEL_PROBES[7], () => evaluateRepositoryRegression(input.cwd)),
    runProbe("regression", PARALLEL_PROBES[8], () => evaluateSignupRegression(input.supabase, input.projectId)),
    runProbe("regression", PARALLEL_PROBES[9], () => evaluateIdeaLabRegression(input.supabase)),
  ]);

  const after = await hashWorkingTree(input.cwd);
  const stable = before.commitSha === after.commitSha && before.treeHash === after.treeHash;
  if (!stable) {
    emit({ stage: "FAILED", check: null, status: "failed", detail: "The tree changed during inspection, so this evidence is not fresh." });
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
    environment,
    presentingProduction: production,
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
    deployment: production ? baseUrl : null,
    limitations: review.traceability.filter((row) => row.status === "FUTURE_SCOPE").map((row) => `Future scope: ${row.requirement}`),
    demo: ["Sign in and open the GHOST project."],
  });
  await appendReview(presentationRoot(), review);
  await persistReview(review);
  emit({
    stage: "COMPLETE",
    check: null,
    status: null,
    detail: `Presentation result: ${review.result}`,
  });
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
