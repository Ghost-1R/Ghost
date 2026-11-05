/**
 * V11 Deployment/Release acceptance against live Ghost Supabase.
 * VERIFIED → Release → DEPLOYMENT_READY → DEPLOYED → PRODUCTION_VERIFIED.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { GhostClient } from "@/lib/auth/session";
import { initializeBuildExecutionFromProject } from "@/lib/build-execution/initialize";
import {
  addEvidence,
  createBlocker,
  loadBuildExecution,
  loadBuildExecutionBundle,
  loadPackageExecutions,
  recomputeAndApplyPackageReadiness,
  recordBuildExecutionTransition,
  resolveBlocker,
  updatePackageExecution,
} from "@/lib/build-execution/queries";
import { evaluateExecutionBundle } from "@/lib/build-execution/workflow";
import {
  createBuildPhase,
  createVerification,
  createWorkPackage,
  createWorkPackageDependency,
  linkFeature,
  linkRequirement,
  loadBuildPlan,
  recordBuildPlanTransition,
  updateBuildPlanOverview,
} from "@/lib/build-plan/queries";
import { initializeBuildPlanFromProject } from "@/lib/build-plan/initialize";
import { collectReleaseItems } from "@/lib/deployment-release/context";
import { initializeReleaseFromProject } from "@/lib/deployment-release/initialize";
import {
  addDeploymentEvidence,
  createDeployment,
  createHealthCheck,
  loadReleaseBundle,
  loadReleases,
  recordReleaseTransition,
  updateConfigPresence,
  updateDeployment,
  updateHealthCheck,
  updateReleaseMigration,
  updateReleaseOverview,
} from "@/lib/deployment-release/queries";
import { answerDeploymentTruthQuestion } from "@/lib/deployment-release/truth";
import { evaluateReleaseBundle, shasMatch, suggestReleaseNextAction } from "@/lib/deployment-release/workflow";
import { initializeProductArchitectFromProject } from "@/lib/product-architect/initialize";
import {
  createProductFeature,
  createProductFlow,
  createProductRequirement,
  loadProductArchitecture,
  loadProductFeatures,
  loadProductQuestions,
  loadProductRequirements,
  recordProductArchitectureTransition,
  updateProductDefinition,
  updateProductFeature,
  updateProductQuestion,
  updateProductRequirement,
} from "@/lib/product-architect/queries";
import { computeProductReadiness } from "@/lib/product-architect/workflow";
import { initializeSystemArchitectureFromProject } from "@/lib/system-architecture/initialize";
import {
  createSystemComponent,
  createSystemEntity,
  createSystemEntityField,
  createSystemInterface,
  loadSystemArchitecture,
  recordSystemArchitectureTransition,
  updateSystemArchitectureOverview,
  updateSystemComponent,
  updateSystemEntity,
  updateSystemInterface,
  upsertRequirementCoverage,
} from "@/lib/system-architecture/queries";
import { initializeVerificationFromProject } from "@/lib/verification/initialize";
import {
  addVerificationEvidence,
  loadVerificationCases,
  loadVerificationProgram,
  recordVerificationProgramTransition,
  updateVerificationCase,
} from "@/lib/verification/queries";

const env: Record<string, string> = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i <= 0 || line.startsWith("#")) continue;
  env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const service = env.SUPABASE_SERVICE_ROLE_KEY;
const email = env.GHOST_LOCAL_FOUNDER_EMAIL;
const password = env.GHOST_LOCAL_FOUNDER_PASSWORD;

const raw = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const sb = raw as unknown as GhostClient;
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

function fail(step: string, err: unknown): never {
  const message =
    err && typeof err === "object" && "message" in err ? String((err as { message: string }).message) : String(err);
  console.error(JSON.stringify({ step, error: message }, null, 2));
  process.exit(1);
}

function assert(step: string, cond: unknown, detail?: unknown) {
  if (!cond) {
    fail(step, detail && typeof detail === "object" ? JSON.stringify(detail) : detail ?? "assertion failed");
  }
}

const { data: auth, error: authErr } = await raw.auth.signInWithPassword({ email, password });
if (authErr) fail("auth", authErr);
const uid = auth.user.id;

async function seedToBuildPlanReady(projectId: string, ideaId: string, strategyId: string) {
  const init = await initializeProductArchitectFromProject(sb, { projectId, ideaId, strategyId, seedNextAction: false });
  if (init.status === "error") fail("product_init", init.message);
  const productArchitectureId = init.data.id;

  await updateProductDefinition(sb, productArchitectureId, {
    what: "Receipt MVP for V11 deployment",
    why: "Need VERIFIED before release",
    who: "Freelancers",
    outcome: "Evidence-backed production verification",
    nonGoals: ["Bank sync"],
    assumptions: ["Web"],
    risks: ["Scope"],
    constraints: ["Web"],
  });
  await recordProductArchitectureTransition(sb, productArchitectureId, "DEFINING", "V9 defining.");

  const req = await createProductRequirement(sb, {
    architectureId: productArchitectureId,
    projectId,
    title: "Persist receipt metadata",
    description: "Owner-scoped receipts",
    reqType: "FUNCTIONAL",
    priority: "HIGH",
    acceptanceCriteria: [],
  });
  if (req.status === "error") fail("req", req.message);
  const accepted = await updateProductRequirement(sb, req.data.id, {
    approvalStatus: "ACCEPTED",
    acceptanceCriteria: ["owner_id present"],
  });
  if (accepted.status === "error") fail("req_accept", accepted.message);

  const feature = await createProductFeature(sb, {
    architectureId: productArchitectureId,
    projectId,
    name: "Receipt storage",
    purpose: "Persist",
    priority: "HIGH",
    requirementIds: [accepted.data.id],
  });
  if (feature.status === "error") fail("feature", feature.message);
  const featureApproved = await updateProductFeature(sb, feature.data.id, {
    status: "APPROVED",
    acceptanceCriteria: ["List loads"],
    requirementIds: [accepted.data.id],
  });
  if (featureApproved.status === "error") fail("feature_approve", featureApproved.message);

  await createProductFlow(sb, {
    architectureId: productArchitectureId,
    projectId,
    name: "Upload",
    actor: "User",
    startingCondition: "Signed in",
    steps: ["Upload", "Store"],
    expectedOutcome: "Stored",
    edgeCases: [],
    featureId: featureApproved.data.id,
  });

  const seededQuestions = await loadProductQuestions(sb, productArchitectureId);
  if (seededQuestions.status === "ok") {
    for (const row of seededQuestions.data) {
      if (row.status === "OPEN" || row.status === "ESCALATED") {
        await updateProductQuestion(sb, row.id, { status: "RESOLVED", resolution: "Closed for V11." });
      }
    }
  }

  await recordProductArchitectureTransition(sb, productArchitectureId, "REVIEW", "Review.");
  await recordProductArchitectureTransition(sb, productArchitectureId, "APPROVED", "Approved.");
  const arch = await loadProductArchitecture(sb, projectId);
  const requirements = await loadProductRequirements(sb, productArchitectureId);
  const features = await loadProductFeatures(sb, productArchitectureId);
  if (arch.status !== "ok" || !arch.data || requirements.status !== "ok" || features.status !== "ok") {
    fail("product_reload", { arch, requirements, features });
  }
  assert(
    "product_ready",
    computeProductReadiness({
      architecture: arch.data,
      requirements: requirements.data,
      features: features.data,
      openQuestions: [],
      openCriticalDecisions: 0,
    }).buildReady,
  );
  await recordProductArchitectureTransition(sb, productArchitectureId, "BUILD_READY", "BUILD_READY.");

  const sysInit = await initializeSystemArchitectureFromProject(sb, { projectId, seedNextAction: false });
  if (sysInit.status === "error") fail("system_init", sysInit.message);
  const systemArchitectureId = sysInit.data.id;
  await updateSystemArchitectureOverview(sb, systemArchitectureId, {
    summary: "Next.js + Supabase receipts",
    authSummary: "Supabase Auth",
    authorizationSummary: "RLS owner_id",
    runtimeTopology: ["Browser → Next.js → Supabase"],
  });
  await recordSystemArchitectureTransition(sb, systemArchitectureId, "DESIGNING", "Designing.");

  const comp = await createSystemComponent(sb, {
    architectureId: systemArchitectureId,
    projectId,
    name: "Web App",
    purpose: "UI",
    componentType: "WEB_APPLICATION",
    requirementIds: [accepted.data.id],
  });
  if (comp.status === "error") fail("comp", comp.message);
  await updateSystemComponent(sb, comp.data.id, { status: "APPROVED", requirementIds: [accepted.data.id] });

  const entity = await createSystemEntity(sb, {
    architectureId: systemArchitectureId,
    projectId,
    name: "receipts",
    purpose: "Receipts",
    ownershipField: "owner_id",
    rlsExpectation: "owner_id = auth.uid()",
    sensitiveClass: "PII",
  });
  if (entity.status === "error") fail("entity", entity.message);
  await createSystemEntityField(sb, {
    entityId: entity.data.id,
    architectureId: systemArchitectureId,
    projectId,
    name: "id",
    dataType: "uuid",
    isPk: true,
    nullable: false,
  });
  await createSystemEntityField(sb, {
    entityId: entity.data.id,
    architectureId: systemArchitectureId,
    projectId,
    name: "owner_id",
    dataType: "uuid",
    nullable: false,
  });
  await updateSystemEntity(sb, entity.data.id, { status: "APPROVED" });

  const iface = await createSystemInterface(sb, {
    architectureId: systemArchitectureId,
    projectId,
    name: "Create receipt",
    purpose: "Insert",
    caller: "Web",
    receiver: "DB",
    operation: "insert",
    authRequired: true,
    requirementIds: [accepted.data.id],
  });
  if (iface.status === "error") fail("iface", iface.message);
  await updateSystemInterface(sb, iface.data.id, { status: "APPROVED", requirementIds: [accepted.data.id] });
  await upsertRequirementCoverage(sb, {
    architectureId: systemArchitectureId,
    projectId,
    requirementId: accepted.data.id,
    coverage: "COVERED",
    supportingRefs: [comp.data.humanId],
  });
  await recordSystemArchitectureTransition(sb, systemArchitectureId, "REVIEW", "Review.");
  await recordSystemArchitectureTransition(sb, systemArchitectureId, "APPROVED", "Approved.");
  await recordSystemArchitectureTransition(sb, systemArchitectureId, "ARCHITECTURE_READY", "Ready.");

  const planInit = await initializeBuildPlanFromProject(sb, { projectId, seedNextAction: false });
  if (planInit.status === "error") fail("plan_init", planInit.message);
  const planId = planInit.data.id;
  await updateBuildPlanOverview(sb, planId, {
    summary: "Implement receipts schema then API.",
    deploymentSequence: ["preflight", "migrate", "deploy", "health"],
    rollbackSummary: "Previous deploy",
  });
  await recordBuildPlanTransition(sb, planId, "PLANNING", "Planning.");

  const phase = await createBuildPhase(sb, { planId, projectId, name: "FOUNDATION", objective: "DB then API" });
  if (phase.status === "error") fail("phase", phase.message);

  const wp1 = await createWorkPackage(sb, {
    planId,
    projectId,
    phaseId: phase.data.id,
    title: "Receipts migration",
    objective: "Schema + RLS",
    priority: "CRITICAL",
    status: "READY",
    databaseImpact: "Create receipts table",
    definitionOfDone: ["Migration exists"],
    acceptanceCriteria: ["PK + owner_id"],
  });
  if (wp1.status === "error") fail("wp1", wp1.message);

  const wp2 = await createWorkPackage(sb, {
    planId,
    projectId,
    phaseId: phase.data.id,
    title: "Create receipt action",
    objective: "Server action",
    priority: "HIGH",
    status: "PLANNED",
    definitionOfDone: ["Action exists"],
    acceptanceCriteria: ["Insert for owner"],
  });
  if (wp2.status === "error") fail("wp2", wp2.message);

  await createWorkPackageDependency(sb, {
    planId,
    projectId,
    fromPackageId: wp2.data.id,
    toPackageId: wp1.data.id,
    edgeKind: "DEPENDS_ON",
  });
  await linkRequirement(sb, wp1.data.id, accepted.data.id);
  await linkFeature(sb, wp2.data.id, featureApproved.data.id);
  await createVerification(sb, {
    workPackageId: wp1.data.id,
    planId,
    projectId,
    kind: "RLS",
    description: "Owner isolation probe",
    observableSignal: "probe exit 0",
  });
  await createVerification(sb, {
    workPackageId: wp2.data.id,
    planId,
    projectId,
    kind: "INTEGRATION",
    description: "Create receipt returns id",
    observableSignal: "test pass",
  });

  // Link architecture for readiness - load components/entities from system
  const { linkArchitecture } = await import("@/lib/build-plan/queries");
  await linkArchitecture(sb, {
    workPackageId: wp1.data.id,
    planId,
    projectId,
    linkKind: "ENTITY",
    recordRef: entity.data.humanId,
  });
  await linkArchitecture(sb, {
    workPackageId: wp1.data.id,
    planId,
    projectId,
    linkKind: "COMPONENT",
    recordRef: comp.data.humanId,
  });
  await linkArchitecture(sb, {
    workPackageId: wp2.data.id,
    planId,
    projectId,
    linkKind: "INTERFACE",
    recordRef: iface.data.humanId,
  });

  await recordBuildPlanTransition(sb, planId, "REVIEW", "Review.");
  await recordBuildPlanTransition(sb, planId, "APPROVED", "Approved.");
  await recordBuildPlanTransition(sb, planId, "BUILD_PLAN_READY", "Build plan ready.");

  const plan = await loadBuildPlan(sb, projectId);
  assert("plan_ready", plan.status === "ok" && plan.data?.status === "BUILD_PLAN_READY", plan);
  const system = await loadSystemArchitecture(sb, projectId);
  assert("system_ready", system.status === "ok" && system.data?.status === "ARCHITECTURE_READY", system);

  return {
    productArchitectureId,
    systemArchitectureId,
    planId,
    requirementId: accepted.data.id,
    featureId: featureApproved.data.id,
    wp1Id: wp1.data.id,
    wp2Id: wp2.data.id,
    wp1Human: wp1.data.humanId,
    wp2Human: wp2.data.humanId,
  };
}

const idea = await raw
  .from("ideas")
  .insert({
    owner_id: uid,
    title: "V11 Deployment acceptance",
    raw_idea: "Deploy after VERIFIED",
    summary: "Receipt MVP deployment gate",
    problem: "Verification without deployment truth",
    target_user: "Freelancers",
    proposed_solution: "Release system",
    value_proposition: "Evidence-backed production verification",
    assumptions: [],
    risks: [],
    opportunities: [],
    constraints_json: [],
    open_questions: [],
    status: "APPROVED",
    readiness: "DECISION_READY",
    note: "V11 acceptance",
  })
  .select("id")
  .single();
if (idea.error) fail("idea", idea.error);
const ideaId = idea.data.id;

const strategy = await raw
  .from("idea_strategies")
  .insert({
    idea_id: ideaId,
    problem: "Need deployment truth",
    target_customer: "Freelancers",
    value_proposition: "Receipts",
    core_offer: "Capture",
    mvp: "Upload",
    not_building: "Bank",
    non_goals: [],
    assumptions: [],
    risks: [],
    constraints_json: [],
    open_decisions: [],
    approved_at: new Date().toISOString(),
  })
  .select("id")
  .single();
if (strategy.error) fail("strategy", strategy.error);
const strategyId = strategy.data.id;

const company = await raw.from("companies").select("id").eq("owner_id", uid).order("created_at").limit(1).maybeSingle();
let companyId = company.data?.id as string | undefined;
if (!companyId) {
  const created = await raw
    .from("companies")
    .insert({ owner_id: uid, name: "Workspace", slug: `ws-${uid.slice(0, 8)}`, description: "ws" })
    .select("id")
    .single();
  if (created.error) fail("company", created.error);
  companyId = created.data.id;
}

const project = await raw
  .from("projects")
  .insert({
    company_id: companyId,
    name: "V11 Deployment acceptance",
    slug: `v11-dep-${Date.now().toString(36)}`,
    description: "V11 operating loop",
    status: "PLANNING",
    lifecycle_stage: "STRATEGY",
    current_milestone: "Release → PRODUCTION_VERIFIED",
  })
  .select("id")
  .single();
if (project.error) fail("project", project.error);
const projectId = project.data.id;
await raw.from("ideas").update({ promoted_project_id: projectId, status: "PROMOTED" }).eq("id", ideaId);

const seeded = await seedToBuildPlanReady(projectId, ideaId, strategyId);

const execInit = await initializeBuildExecutionFromProject(sb, { projectId, seedNextAction: false });
if (execInit.status === "error") fail("exec_init", execInit.message);
const executionId = execInit.data.id;

let packages = await loadPackageExecutions(sb, executionId);
if (packages.status === "error") fail("packages", packages.message);
assert("seeded_two", packages.data.length === 2, packages.data);

const byWp = new Map(packages.data.map((row) => [row.workPackageId, row]));
const pe1 = byWp.get(seeded.wp1Id)!;

await recordBuildExecutionTransition(sb, executionId, "EXECUTING", "Started first package.");
const started1 = await updatePackageExecution(sb, pe1.id, {
  status: "IN_PROGRESS",
  startedAt: new Date().toISOString(),
  startedBy: uid,
  implementationNotes: "Writing receipts migration design notes",
});
if (started1.status === "error") fail("start_wp1", started1.message);

const blocker = await createBlocker(sb, {
  packageExecutionId: pe1.id,
  executionId,
  projectId,
  description: "Need owner_id column confirmation before finishing migration notes",
});
if (blocker.status === "error") fail("blocker", blocker.message);
await updatePackageExecution(sb, pe1.id, { status: "BLOCKED" });
await resolveBlocker(sb, blocker.data.id, "Confirmed owner_id = auth.uid() in architecture.");
await updatePackageExecution(sb, pe1.id, { status: "IN_PROGRESS" });

const evidence1 = await addEvidence(sb, {
  packageExecutionId: pe1.id,
  executionId,
  projectId,
  kind: "MIGRATION",
  reference: "supabase/migrations/receipts_owner_rls.sql",
  summary: "Designed migration file path recorded as evidence reference",
});
if (evidence1.status === "error") fail("evidence1", evidence1.message);
const implemented1 = await updatePackageExecution(sb, pe1.id, {
  status: "IMPLEMENTED",
  completedAt: new Date().toISOString(),
  completedBy: uid,
});
if (implemented1.status === "error") fail("impl1", implemented1.message);

await recomputeAndApplyPackageReadiness(sb, execInit.data);
packages = await loadPackageExecutions(sb, executionId);
if (packages.status === "error") fail("packages2", packages.message);
const pe2After = packages.data.find((row) => row.workPackageId === seeded.wp2Id)!;

await updatePackageExecution(sb, pe2After.id, {
  status: "IN_PROGRESS",
  startedAt: new Date().toISOString(),
  startedBy: uid,
});
const evidence2 = await addEvidence(sb, {
  packageExecutionId: pe2After.id,
  executionId,
  projectId,
  kind: "API_ROUTE",
  reference: "src/app/actions/create-receipt.ts",
  summary: "Server action path recorded",
});
if (evidence2.status === "error") fail("evidence2", evidence2.message);
const implemented2 = await updatePackageExecution(sb, pe2After.id, {
  status: "IMPLEMENTED",
  completedAt: new Date().toISOString(),
  completedBy: uid,
});
if (implemented2.status === "error") fail("impl2", implemented2.message);

await recordBuildExecutionTransition(sb, executionId, "IMPLEMENTATION_REVIEW", "All packages implemented with evidence.");
let execution = (await loadBuildExecution(sb, projectId)).data!;
const execBundle = await loadBuildExecutionBundle(sb, execution);
if (execBundle.status === "error") fail("bundle_pre", execBundle.message);
assert("completion_clear", evaluateExecutionBundle(execBundle.data).completion.implementationComplete);

const toImplemented = await recordBuildExecutionTransition(
  sb,
  executionId,
  "IMPLEMENTED",
  "Deterministic completion gate cleared. Not verified. Not deployed.",
);
if (toImplemented.status === "error") fail("to_implemented", toImplemented.message);
execution = (await loadBuildExecution(sb, projectId)).data!;
assert("status_implemented", execution.status === "IMPLEMENTED", execution.status);

// Fast path to VERIFIED (both cases pass with evidence)
const verInit = await initializeVerificationFromProject(sb, { projectId, seedNextAction: false });
if (verInit.status === "error") fail("ver_init", verInit.message);
const programId = verInit.data.id;
const cases = await loadVerificationCases(sb, programId);
if (cases.status === "error") fail("cases", cases.message);
assert("seeded_cases", cases.data.length === 2, cases.data);

await recordVerificationProgramTransition(sb, programId, "TESTING", "V11 seed testing.");
for (const row of cases.data) {
  await updateVerificationCase(sb, row.id, { status: "RUNNING", startedAt: new Date().toISOString() });
  const ev = await addVerificationEvidence(sb, {
    caseId: row.id,
    programId,
    projectId,
    kind: "AUTOMATED_RESULT",
    reference: `v11-seed-${row.humanId}`,
    summary: "Seed pass for V11 release fixture",
  });
  if (ev.status === "error") fail(`ver_ev_${row.humanId}`, ev.message);
  const passed = await updateVerificationCase(
    sb,
    row.id,
    { status: "PASSED", actualResult: "pass", completedAt: new Date().toISOString() },
    { evidenceCount: 1 },
  );
  if (passed.status === "error") fail(`pass_${row.humanId}`, passed.message);
}
await recordVerificationProgramTransition(sb, programId, "VERIFICATION_REVIEW", "Cases passed.");
await recordVerificationProgramTransition(sb, programId, "VERIFIED", "VERIFIED ≠ DEPLOYED.");
const program = (await loadVerificationProgram(sb, projectId)).data!;
assert("status_verified", program.status === "VERIFIED", program.status);

const RELEASE_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const WRONG_SHA = "cccccccccccccccccccccccccccccccccccccccc";

// Refuse release before VERIFIED already satisfied; create release
const relInit = await initializeReleaseFromProject(sb, {
  projectId,
  sourceBranch: "ghost-experience",
  sourceCommitSha: RELEASE_SHA,
  migrationPaths: ["supabase/migrations/20261006070000_deployment.sql"],
  seedNextAction: true,
});
if (relInit.status === "error") fail("rel_init", relInit.message);
const releaseId = relInit.data.id;
assert("release_draft", relInit.data.status === "DRAFT", relInit.data);
assert("release_sha", relInit.data.sourceCommitSha === RELEASE_SHA, relInit.data);

let release = relInit.data;
let rBundle = await loadReleaseBundle(sb, release);
if (rBundle.status === "error") fail("rbundle_draft", rBundle.message);
let evaluated = evaluateReleaseBundle(rBundle.data);
assert("not_ready_gaps", !evaluated.readiness.ready, evaluated.readiness.gaps);
assert(
  "gap_config",
  evaluated.readiness.gaps.some((g) => g.code.startsWith("CONFIG_")),
  evaluated.readiness.gaps,
);
assert(
  "gap_migration",
  evaluated.readiness.gaps.some((g) => g.code.startsWith("MIGRATION_")),
  evaluated.readiness.gaps,
);

// Clear readiness gaps
const envId = release.environmentId ?? rBundle.data.environments.find((e) => e.environmentType === "PRODUCTION")?.id;
assert("has_env", Boolean(envId), rBundle.data.environments);
if (!release.environmentId && envId) {
  const linked = await updateReleaseOverview(sb, releaseId, { environmentId: envId });
  if (linked.status === "error") fail("link_env", linked.message);
  release = linked.data;
}

for (const cfg of rBundle.data.configRequirements) {
  const set = await updateConfigPresence(sb, cfg.id, {
    presence: "PRESENT",
    note: "Presence verified without storing values.",
  });
  if (set.status === "error") fail(`cfg_${cfg.variableName}`, set.message);
}
for (const mig of rBundle.data.migrations) {
  const set = await updateReleaseMigration(sb, mig.id, {
    status: "APPLIED",
    evidenceRef: "supabase-sql-editor:applied",
  });
  if (set.status === "error") fail(`mig_${mig.migrationPath}`, set.message);
}

release = (await loadReleases(sb, projectId)).data!.find((r) => r.id === releaseId)!;
rBundle = await loadReleaseBundle(sb, release);
if (rBundle.status === "error") fail("rbundle_ready", rBundle.message);
evaluated = evaluateReleaseBundle(rBundle.data);
assert("ready_now", evaluated.readiness.ready, evaluated.readiness.gaps);

const toReady = await recordReleaseTransition(sb, releaseId, "DEPLOYMENT_READY", "Readiness gaps cleared.");
if (toReady.status === "error") fail("to_ready", toReady.message);

// Failed deployment attempt — wrong live SHA path later; first prove fail keeps history
const failedDep = await createDeployment(sb, {
  releaseId,
  projectId,
  environmentId: envId!,
  expectedCommitSha: RELEASE_SHA,
  provider: "Render",
  deploymentUrl: "https://ghost-nkk0.onrender.com",
});
if (failedDep.status === "error") fail("fail_dep_create", failedDep.message);
await updateDeployment(sb, failedDep.data.id, {
  status: "IN_PROGRESS",
  startedAt: new Date().toISOString(),
});
const failAttempt = await updateDeployment(sb, failedDep.data.id, {
  status: "FAILED",
  failureReason: "Provider deploy timed out",
  completedAt: new Date().toISOString(),
});
if (failAttempt.status === "error") fail("fail_dep", failAttempt.message);

await recordReleaseTransition(sb, releaseId, "DEPLOYING", "Retry after failed attempt.");
const dep = await createDeployment(sb, {
  releaseId,
  projectId,
  environmentId: envId!,
  expectedCommitSha: RELEASE_SHA,
  provider: "Render",
  providerDeploymentId: "dep-v11-fixture",
  deploymentUrl: "https://ghost-nkk0.onrender.com",
});
if (dep.status === "error") fail("dep_create", dep.message);
await updateDeployment(sb, dep.data.id, { status: "IN_PROGRESS", startedAt: new Date().toISOString() });

const wrongLive = await updateDeployment(sb, dep.data.id, { liveCommitSha: WRONG_SHA });
if (wrongLive.status === "error") fail("wrong_live", wrongLive.message);
assert("sha_mismatch", !shasMatch(RELEASE_SHA, WRONG_SHA));

const evidence = await addDeploymentEvidence(sb, {
  deploymentId: dep.data.id,
  releaseId,
  projectId,
  kind: "PROVIDER_STATUS",
  reference: "render:dep-v11-fixture",
  summary: "Provider reported live",
});
if (evidence.status === "error") fail("dep_evidence", evidence.message);

const succeedMismatch = await updateDeployment(
  sb,
  dep.data.id,
  { status: "SUCCEEDED", completedAt: new Date().toISOString() },
  { evidenceCount: 1 },
);
if (succeedMismatch.status === "error") fail("succeed_mismatch_ok_status", succeedMismatch.message);

release = (await loadReleases(sb, projectId)).data!.find((r) => r.id === releaseId)!;
rBundle = await loadReleaseBundle(sb, { ...release, status: "DEPLOYING" });
if (rBundle.status === "error") fail("rbundle_mismatch", rBundle.message);
const prodGapsMismatch = evaluateReleaseBundle({
  ...rBundle.data,
  deployments: rBundle.data.deployments.map((d) =>
    d.id === dep.data.id ? { ...d, status: "SUCCEEDED", liveCommitSha: WRONG_SHA } : d,
  ),
}).production;
assert("not_prod_verified_mismatch", !prodGapsMismatch.productionVerified, prodGapsMismatch.gaps);
assert(
  "sha_gap",
  prodGapsMismatch.gaps.some((g) => g.code === "SHA_MISMATCH"),
  prodGapsMismatch.gaps,
);

// Correct live SHA and complete happy path
await updateDeployment(sb, dep.data.id, { liveCommitSha: RELEASE_SHA });
await addDeploymentEvidence(sb, {
  deploymentId: dep.data.id,
  releaseId,
  projectId,
  kind: "LIVE_SHA",
  reference: `health:${RELEASE_SHA}`,
  summary: "Live /api/health commit matches expected release SHA",
});
const health = await createHealthCheck(sb, {
  deploymentId: dep.data.id,
  releaseId,
  projectId,
  checkName: "application_reachable",
  expectedValue: "ok",
});
if (health.status === "error") fail("health_create", health.message);
await updateHealthCheck(sb, health.data.id, {
  status: "PASSED",
  observedValue: "ok",
  evidenceRef: "GET /api/health status=ok",
});
await updateDeployment(sb, dep.data.id, {
  inspectorResult: "READY",
  presentationResult: "READY",
});

const toDeployed = await recordReleaseTransition(
  sb,
  releaseId,
  "DEPLOYED",
  "Deployment SUCCEEDED with matching live SHA. DEPLOYED ≠ PRODUCTION_VERIFIED.",
);
if (toDeployed.status === "error") fail("to_deployed", toDeployed.message);

await recordReleaseTransition(
  sb,
  releaseId,
  "PRODUCTION_VERIFICATION",
  "Starting production verification against live SHA.",
);

release = (await loadReleases(sb, projectId)).data!.find((r) => r.id === releaseId)!;
rBundle = await loadReleaseBundle(sb, release);
if (rBundle.status === "error") fail("rbundle_prod", rBundle.message);
evaluated = evaluateReleaseBundle(rBundle.data);
assert("prod_complete", evaluated.production.productionVerified, evaluated.production.gaps);

const toProdVerified = await recordReleaseTransition(
  sb,
  releaseId,
  "PRODUCTION_VERIFIED",
  "Production Inspector and Presentation Gate recorded. Exact SHA verified.",
);
if (toProdVerified.status === "error") fail("to_prod_verified", toProdVerified.message);

release = (await loadReleases(sb, projectId)).data!.find((r) => r.id === releaseId)!;
assert("status_prod_verified", release.status === "PRODUCTION_VERIFIED", release.status);
assert("prod_verified_at", Boolean(release.productionVerifiedAt), release);

rBundle = await loadReleaseBundle(sb, release);
if (rBundle.status === "error") fail("rbundle_final", rBundle.message);
evaluated = evaluateReleaseBundle(rBundle.data);

const truthCtx = {
  release,
  verificationStatus: "VERIFIED" as const,
  deployments: rBundle.data.deployments,
  migrations: rBundle.data.migrations,
  healthChecks: rBundle.data.healthChecks,
  rollbacks: rBundle.data.rollbacks,
  readinessGaps: evaluated.readiness.gaps,
  productionGaps: evaluated.production.gaps,
};

const truthVerifiedNotDeployed = answerDeploymentTruthQuestion("V10 passed. Is it live?", {
  ...truthCtx,
  release: { ...release, status: "DRAFT" },
  deployments: [],
});
assert(
  "truth_verified_not_live",
  truthVerifiedNotDeployed?.answer === "NO",
  truthVerifiedNotDeployed,
);

const truthDeployed = answerDeploymentTruthQuestion("Is this deployed?", truthCtx);
assert("truth_deployed_yes", truthDeployed?.answer === "YES", truthDeployed);

const truthProd = answerDeploymentTruthQuestion("is production verified?", truthCtx);
assert("truth_prod_yes", truthProd?.answer === "YES", truthProd);

const truthCommit = answerDeploymentTruthQuestion("What commit is live?", truthCtx);
assert("truth_commit", truthCommit?.answer === "YES" && truthCommit.reason.includes(RELEASE_SHA), truthCommit);

const truthDeployedNeqProd = answerDeploymentTruthQuestion("does deployed mean production verified?", {
  ...truthCtx,
  release: { ...release, status: "DEPLOYED" },
});
assert("truth_deployed_neq_prod", truthDeployedNeqProd?.answer === "NO", truthDeployedNeqProd);

const failedStillPresent = rBundle.data.deployments.some((d) => d.status === "FAILED");
assert("failed_history", failedStillPresent, rBundle.data.deployments);

const suggestion = suggestReleaseNextAction({
  status: release.status,
  readiness: evaluated.readiness,
  production: evaluated.production,
  latestDeployment: evaluated.latestDeployment,
});

const today = await raw.from("next_actions").select("id,title").eq("project_id", projectId).eq("status", "OPEN");
assert("today", (today.data?.length ?? 0) >= 1, today);

const brain = await raw.from("project_knowledge").select("title,source").eq("project_id", projectId);
assert(
  "brain_rel",
  (brain.data ?? []).some((row) => String(row.title).includes("Release") || String(row.source).includes(releaseId)),
  brain.data,
);

const askItems = collectReleaseItems({
  question: "Is this deployed and has production been verified?",
  bundle: rBundle.data,
});
assert("ask_items", askItems.length >= 2, askItems);
assert(
  "ask_truth",
  askItems.some((item) => item.type === "truth_boundary"),
  askItems,
);

const stranger = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const leaked = await stranger.from("releases").select("id").eq("id", releaseId);
assert("rls_anon", (leaked.data?.length ?? 0) === 0, leaked);

const illegal = await raw.rpc("record_release_transition", {
  target_release_id: releaseId,
  next_status: "DRAFT",
  transition_reason: "illegal",
  transition_actor: "FOUNDER",
});
assert("illegal_blocked", Boolean(illegal.error), illegal);

console.log(
  JSON.stringify(
    {
      pass: true,
      projectId,
      planId: seeded.planId,
      executionId,
      programId,
      releaseId,
      releaseStatus: release.status,
      sourceCommitSha: release.sourceCommitSha,
      deployments: rBundle.data.deployments.map((d) => ({
        humanId: d.humanId,
        status: d.status,
        expected: d.expectedCommitSha,
        live: d.liveCommitSha,
      })),
      productionVerified: evaluated.production.productionVerified,
      todayCount: today.data?.length ?? 0,
      suggestion: suggestion?.title ?? null,
      askGhostItemTypes: askItems.map((item) => item.type),
      chain:
        "VERIFIED → Release DRAFT → readiness gaps → DEPLOYMENT_READY → fail/retry → DEPLOYED → PRODUCTION_VERIFIED",
    },
    null,
    2,
  ),
);

await admin.from("projects").delete().eq("id", projectId);
await admin.from("ideas").delete().eq("id", ideaId);
