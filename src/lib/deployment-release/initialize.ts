import type { GhostClient } from "@/lib/auth/session";
import { loadBuildExecution } from "@/lib/build-execution/queries";
import { loadBuildPlan } from "@/lib/build-plan/queries";
import { createNextAction } from "@/lib/operations/actions";
import { loadProductArchitecture } from "@/lib/product-architect/queries";
import { fromError, type QueryResult } from "@/lib/result";
import { loadSystemArchitecture } from "@/lib/system-architecture/queries";
import { loadVerificationProgram } from "@/lib/verification/queries";
import {
  createRelease,
  createReleaseMigration,
  createRollback,
  ensureDefaultEnvironments,
  loadLatestRelease,
  loadReleases,
  upsertConfigRequirement,
  type EnvironmentDefaults,
} from "./queries";
import type { Release } from "./types";

export const DEFAULT_DEPLOYMENT_SEQUENCE = ["preflight", "migrate", "deploy", "health", "production_verify"];

export const DEFAULT_ROLLBACK_STRATEGY =
  "Redeploy the last PRODUCTION_VERIFIED commit through the provider, then re-run health checks and confirm the live SHA. Migrations are forward-only; record any data repair as a manual action.";

export const DEFAULT_PRODUCTION_ENVIRONMENT: EnvironmentDefaults = {
  name: "Production",
  environmentType: "PRODUCTION",
  provider: "Render",
  applicationUrl: "https://ghost-nkk0.onrender.com",
  healthEndpoint: "/api/health",
  note: "Default production environment. Safe metadata only; no secret values.",
};

export const DEFAULT_CONFIG_REQUIREMENTS: Array<{ variableName: string; isSecret: boolean }> = [
  { variableName: "GROQ_API_KEY", isSecret: true },
  { variableName: "NEXT_PUBLIC_SUPABASE_URL", isSecret: false },
  { variableName: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", isSecret: false },
];

export function parseLineList(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
}

/**
 * Initialize a Release from a VERIFIED Verification Program.
 * Does not invent deployment evidence. VERIFIED ≠ DEPLOYED ≠ PRODUCTION_VERIFIED.
 */
export async function initializeReleaseFromProject(
  supabase: GhostClient,
  input: {
    projectId: string;
    sourceBranch?: string;
    sourceCommitSha: string;
    migrationPaths?: string[];
    environmentDefaults?: EnvironmentDefaults[];
    seedNextAction?: boolean;
  },
): Promise<QueryResult<Release>> {
  const sourceCommitSha = input.sourceCommitSha.trim();
  if (!sourceCommitSha) {
    return { status: "error", message: "A source commit SHA is required to create a release." };
  }

  const program = await loadVerificationProgram(supabase, input.projectId);
  if (program.status === "error") return program;
  if (!program.data) {
    return { status: "error", message: "Initialize Verification first. A release needs a VERIFIED program." };
  }
  if (program.data.status !== "VERIFIED") {
    return {
      status: "error",
      message: `Verification is ${program.data.status}. It must be VERIFIED before a release can be created.`,
    };
  }

  const latest = await loadLatestRelease(supabase, input.projectId);
  if (latest.status === "error") return latest;
  if (
    latest.data &&
    latest.data.status === "DRAFT" &&
    latest.data.sourceCommitSha.trim().toLowerCase() === sourceCommitSha.toLowerCase()
  ) {
    return { status: "ok", data: latest.data };
  }

  const [execution, plan, product, system] = await Promise.all([
    loadBuildExecution(supabase, input.projectId),
    loadBuildPlan(supabase, input.projectId),
    loadProductArchitecture(supabase, input.projectId),
    loadSystemArchitecture(supabase, input.projectId),
  ]);
  if (execution.status === "error") return execution;
  if (plan.status === "error") return plan;
  if (product.status === "error") return product;
  if (system.status === "error") return system;
  if (!execution.data) return { status: "error", message: "Build Execution is missing. A release needs execution provenance." };
  if (!plan.data) return { status: "error", message: "Build Plan is missing. A release needs plan provenance." };
  if (!product.data) return { status: "error", message: "Product Architecture is missing. A release needs product provenance." };
  if (!system.data) return { status: "error", message: "System Architecture is missing. A release needs system provenance." };

  const environments = await ensureDefaultEnvironments(
    supabase,
    input.projectId,
    input.environmentDefaults ?? [DEFAULT_PRODUCTION_ENVIRONMENT],
  );
  if (environments.status === "error") return environments;
  const environment =
    environments.data.find((row) => row.environmentType === "PRODUCTION" && row.isActive) ?? environments.data[0] ?? null;

  const releases = await loadReleases(supabase, input.projectId);
  if (releases.status === "error") return releases;
  const priorVerified = releases.data.find((row) => row.status === "PRODUCTION_VERIFIED") ?? null;

  const created = await createRelease(supabase, {
    projectId: input.projectId,
    verificationProgramId: program.data.id,
    buildExecutionId: execution.data.id,
    buildPlanId: plan.data.id,
    productArchitectureId: product.data.id,
    systemArchitectureId: system.data.id,
    environmentId: environment?.id ?? null,
    summary: program.data.summary || execution.data.summary,
    sourceBranch: input.sourceBranch,
    sourceCommitSha,
    deploymentSequence: DEFAULT_DEPLOYMENT_SEQUENCE,
    rollbackStrategy: DEFAULT_ROLLBACK_STRATEGY,
    rollbackTargetReleaseId: priorVerified?.id ?? null,
    rollbackTargetCommitSha: priorVerified?.sourceCommitSha ?? "",
  });
  if (created.status === "error") return created;

  for (const config of DEFAULT_CONFIG_REQUIREMENTS) {
    const seeded = await upsertConfigRequirement(supabase, {
      releaseId: created.data.id,
      projectId: input.projectId,
      environmentId: environment?.id ?? null,
      variableName: config.variableName,
      isRequired: true,
      isSecret: config.isSecret,
      presence: "UNKNOWN",
      note: "Presence not yet confirmed. Ghost never stores the value.",
    });
    if (seeded.status === "error") return seeded;
  }

  for (const migrationPath of input.migrationPaths ?? []) {
    const seeded = await createReleaseMigration(supabase, {
      releaseId: created.data.id,
      projectId: input.projectId,
      environmentId: environment?.id ?? null,
      migrationPath,
      isRequired: true,
      status: "PENDING",
    });
    if (seeded.status === "error") return seeded;
  }

  if (priorVerified) {
    const stub = await createRollback(supabase, {
      releaseId: created.data.id,
      projectId: input.projectId,
      targetReleaseId: priorVerified.id,
      targetCommitSha: priorVerified.sourceCommitSha,
      status: "AVAILABLE",
      reason: `Prior PRODUCTION_VERIFIED release ${priorVerified.humanId}. Availability is a record, not a performed rollback.`,
    });
    if (stub.status === "error") return stub;
  }

  const knowledge = await supabase.from("project_knowledge").insert({
    project_id: input.projectId,
    kind: "FACT",
    title: "Release initialized",
    content: [
      `Release ${created.data.humanId} (${created.data.id}) created as DRAFT`,
      `Source commit: ${sourceCommitSha}${input.sourceBranch ? ` on ${input.sourceBranch}` : ""}`,
      `Verification provenance: ${program.data.id} (${program.data.status})`,
      `Build execution provenance: ${execution.data.id} (${execution.data.status})`,
      `Build plan provenance: ${plan.data.id} (${plan.data.status})`,
      `Product architecture provenance: ${product.data.id} (${product.data.status})`,
      `System architecture provenance: ${system.data.id} (${system.data.status})`,
      `Seeded ${DEFAULT_CONFIG_REQUIREMENTS.length} configuration presence requirement(s) as UNKNOWN and ${input.migrationPaths?.length ?? 0} migration(s) as PENDING.`,
      "No deployment evidence was invented. VERIFIED ≠ DEPLOYED ≠ PRODUCTION_VERIFIED.",
    ].join("\n"),
    source: `releases:${created.data.id}`,
  });
  if (knowledge.error) return fromError(knowledge.error);

  if (input.seedNextAction !== false) {
    await createNextAction(supabase, {
      projectId: input.projectId,
      title: "Complete deployment readiness gaps",
      description:
        "Confirm configuration presence, migrations, manual actions, and the rollback plan. DEPLOYMENT_READY is not deployed.",
      provenance: "FOUNDER_APPROVED_ACTION",
      sourceKind: "deployment",
      sourceRef: created.data.id,
      priority: "HIGH",
    });
  }

  return created;
}
