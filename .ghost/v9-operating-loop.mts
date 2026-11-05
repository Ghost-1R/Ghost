/**
 * V9 Build Execution acceptance against live Ghost Supabase.
 * BUILD_PLAN_READY → initialize execution → IMPLEMENTED (≠ verified/deployed).
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { GhostClient } from "@/lib/auth/session";
import { collectBuildExecutionItems } from "@/lib/build-execution/context";
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
import { answerBuildExecutionTruthQuestion } from "@/lib/build-execution/truth";
import { evaluateExecutionBundle, suggestExecutionNextAction } from "@/lib/build-execution/workflow";
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
    what: "Receipt MVP for V9 execution",
    why: "Need BUILD_PLAN_READY before execution",
    who: "Freelancers",
    outcome: "Evidence-backed implementation gate",
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
        await updateProductQuestion(sb, row.id, { status: "RESOLVED", resolution: "Closed for V9." });
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
    title: "V9 Build Execution acceptance",
    raw_idea: "Execute after BUILD_PLAN_READY",
    summary: "Receipt MVP execution gate",
    problem: "Plan without execution",
    target_user: "Freelancers",
    proposed_solution: "Build Execution",
    value_proposition: "Evidence-backed implementation",
    assumptions: [],
    risks: [],
    opportunities: [],
    constraints_json: [],
    open_questions: [],
    status: "APPROVED",
    readiness: "DECISION_READY",
    note: "V9 acceptance",
  })
  .select("id")
  .single();
if (idea.error) fail("idea", idea.error);
const ideaId = idea.data.id;

const strategy = await raw
  .from("idea_strategies")
  .insert({
    idea_id: ideaId,
    problem: "Need execution",
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
    name: "V9 Build Execution acceptance",
    slug: `v9-ex-${Date.now().toString(36)}`,
    description: "V9 operating loop",
    status: "PLANNING",
    lifecycle_stage: "STRATEGY",
    current_milestone: "Build Execution → IMPLEMENTED",
  })
  .select("id")
  .single();
if (project.error) fail("project", project.error);
const projectId = project.data.id;
await raw.from("ideas").update({ promoted_project_id: projectId, status: "PROMOTED" }).eq("id", ideaId);

const seeded = await seedToBuildPlanReady(projectId, ideaId, strategyId);

// Refuse init without BUILD_PLAN_READY is already satisfied; prove execution init
const execInit = await initializeBuildExecutionFromProject(sb, { projectId, seedNextAction: true });
if (execInit.status === "error") fail("exec_init", execInit.message);
const executionId = execInit.data.id;
assert("exec_not_started", execInit.data.status === "NOT_STARTED", execInit.data);
assert("exec_plan_link", execInit.data.buildPlanId === seeded.planId, execInit.data);

let packages = await loadPackageExecutions(sb, executionId);
if (packages.status === "error") fail("packages", packages.message);
assert("seeded_two", packages.data.length === 2, packages.data);

const byWp = new Map(packages.data.map((row) => [row.workPackageId, row]));
const pe1 = byWp.get(seeded.wp1Id)!;
const pe2 = byWp.get(seeded.wp2Id)!;
assert("wp1_ready", pe1.status === "READY", pe1);
assert("wp2_queued", pe2.status === "QUEUED", pe2);

// Begin WP1
await recordBuildExecutionTransition(sb, executionId, "EXECUTING", "Started first package.");
const started1 = await updatePackageExecution(sb, pe1.id, {
  status: "IN_PROGRESS",
  startedAt: new Date().toISOString(),
  startedBy: uid,
  implementationNotes: "Writing receipts migration design notes",
});
if (started1.status === "error") fail("start_wp1", started1.message);

// Blocker then resolve
const blocker = await createBlocker(sb, {
  packageExecutionId: pe1.id,
  executionId,
  projectId,
  description: "Need owner_id column confirmation before finishing migration notes",
});
if (blocker.status === "error") fail("blocker", blocker.message);
const blocked = await updatePackageExecution(sb, pe1.id, { status: "BLOCKED" });
if (blocked.status === "error") fail("set_blocked", blocked.message);

await resolveBlocker(sb, blocker.data.id, "Confirmed owner_id = auth.uid() in architecture.");
const unblocked = await updatePackageExecution(sb, pe1.id, { status: "IN_PROGRESS" });
if (unblocked.status === "error") fail("unblock", unblocked.message);

// Evidence + implement WP1
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
assert("wp2_now_ready", pe2After.status === "READY", pe2After);

// WP2
const started2 = await updatePackageExecution(sb, pe2After.id, {
  status: "IN_PROGRESS",
  startedAt: new Date().toISOString(),
  startedBy: uid,
});
if (started2.status === "error") fail("start_wp2", started2.message);
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
let bundle = await loadBuildExecutionBundle(sb, execution);
if (bundle.status === "error") fail("bundle_pre", bundle.message);
let evaluated = evaluateExecutionBundle(bundle.data);
assert("completion_clear", evaluated.completion.implementationComplete, evaluated.completion.gaps);

const toImplemented = await recordBuildExecutionTransition(
  sb,
  executionId,
  "IMPLEMENTED",
  "Deterministic completion gate cleared. Not verified. Not deployed.",
);
if (toImplemented.status === "error") fail("to_implemented", toImplemented.message);

execution = (await loadBuildExecution(sb, projectId)).data!;
assert("status_implemented", execution.status === "IMPLEMENTED", execution.status);
bundle = await loadBuildExecutionBundle(sb, execution);
if (bundle.status === "error") fail("bundle_final", bundle.message);
evaluated = evaluateExecutionBundle(bundle.data);

const truthImpl = answerBuildExecutionTruthQuestion("Is the project implemented?", {
  execution,
  packageExecutions: bundle.data.packageExecutions,
  evidence: bundle.data.evidence,
});
assert("truth_implemented_yes", truthImpl?.answer === "YES", truthImpl);

const truthVerified = answerBuildExecutionTruthQuestion("Is it verified?", {
  execution,
  packageExecutions: bundle.data.packageExecutions,
  evidence: bundle.data.evidence,
});
assert("truth_not_verified", truthVerified?.answer === "NO" && truthVerified.kind === "NOT_VERIFIED", truthVerified);

const truthDeployed = answerBuildExecutionTruthQuestion("Is it deployed?", {
  execution,
  packageExecutions: bundle.data.packageExecutions,
  evidence: bundle.data.evidence,
});
assert("truth_not_deployed", truthDeployed?.answer === "NO" && truthDeployed.kind === "NOT_DEPLOYED", truthDeployed);

const suggestion = suggestExecutionNextAction({
  completion: evaluated.completion,
  executionStatus: execution.status,
  packageExecutions: bundle.data.packageExecutions,
});

const nextActionInsert = await raw
  .from("next_actions")
  .insert({
    project_id: projectId,
    title: suggestion?.title ?? "Begin verification (V10) — implementation is not verification",
    description: suggestion?.description ?? "IMPLEMENTED ≠ VERIFIED ≠ DEPLOYED",
    status: "OPEN",
    position: 1,
    priority: "HIGH",
    provenance: "FOUNDER_APPROVED_ACTION",
    source_kind: suggestion?.sourceKind ?? "build_execution",
    source_ref: executionId,
    requires_decision: false,
  })
  .select("id")
  .single();
if (nextActionInsert.error) fail("next_action", nextActionInsert.error);

const today = await raw.from("next_actions").select("id").eq("project_id", projectId).eq("status", "OPEN");
assert("today", (today.data?.length ?? 0) >= 1, today);

const brain = await raw.from("project_knowledge").select("title,source").eq("project_id", projectId);
assert(
  "brain_exec",
  (brain.data ?? []).some((row) => String(row.title).includes("Build Execution") || String(row.source).includes(executionId)),
  brain.data,
);

const askItems = collectBuildExecutionItems({
  question: "Is the project implemented and is it verified or deployed?",
  bundle: bundle.data,
});
assert("ask_items", askItems.length >= 2, askItems);
assert(
  "ask_truth",
  askItems.some((item) => item.type === "truth_boundary"),
  askItems,
);

const stranger = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const leaked = await stranger.from("build_executions").select("id").eq("id", executionId);
assert("rls_anon", (leaked.data?.length ?? 0) === 0, leaked);

const illegal = await raw.rpc("record_build_execution_transition", {
  target_execution_id: executionId,
  next_status: "NOT_STARTED",
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
      status: execution.status,
      packages: bundle.data.packageExecutions.map((row) => ({
        workPackageId: row.workPackageId,
        status: row.status,
      })),
      evidenceCount: bundle.data.evidence.length,
      completion: evaluated.completion.implementationComplete,
      todayCount: today.data?.length ?? 0,
      askGhostItemTypes: askItems.map((item) => item.type),
      chain:
        "BUILD_PLAN_READY → Execution → READY/IN_PROGRESS/BLOCKED/evidence → IMPLEMENTED ≠ VERIFIED ≠ DEPLOYED",
    },
    null,
    2,
  ),
);

await admin.from("projects").delete().eq("id", projectId);
await admin.from("ideas").delete().eq("id", ideaId);
