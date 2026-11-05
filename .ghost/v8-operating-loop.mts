/**
 * V8 Build Plan acceptance against live Ghost Supabase.
 * BUILD_READY → ARCHITECTURE_READY → BUILD_PLAN_READY.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { GhostClient } from "@/lib/auth/session";
import { collectBuildPlanItems } from "@/lib/build-plan/context";
import { initializeBuildPlanFromProject } from "@/lib/build-plan/initialize";
import {
  createBuildPhase,
  createBuildRisk,
  createConfigRequirement,
  createManualAction,
  createVerification,
  createWorkPackage,
  createWorkPackageDependency,
  linkArchitecture,
  linkFeature,
  linkRequirement,
  loadBuildPlan,
  loadBuildPlanBundle,
  recordBuildPlanTransition,
  updateBuildPlanOverview,
} from "@/lib/build-plan/queries";
import { answerBuildPlanTruthQuestion } from "@/lib/build-plan/truth";
import {
  computeCriticalPath,
  computeExecutionWaves,
  detectDependencyCycles,
  evaluateBuildPlanBundle,
  suggestBuildNextAction,
} from "@/lib/build-plan/workflow";
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

async function seedProductAndSystem(projectId: string, ideaId: string, strategyId: string) {
  const init = await initializeProductArchitectFromProject(sb, { projectId, ideaId, strategyId, seedNextAction: false });
  if (init.status === "error") fail("product_init", init.message);
  const productArchitectureId = init.data.id;

  await updateProductDefinition(sb, productArchitectureId, {
    what: "Receipt capture MVP for V8 build plan acceptance",
    why: "Need BUILD_READY then ARCHITECTURE_READY before Build Plan",
    who: "Freelancers",
    outcome: "Authoritative build plan gate",
    nonGoals: ["Bank sync"],
    assumptions: ["Web first"],
    risks: ["OCR variance"],
    constraints: ["Responsive web"],
  });
  await recordProductArchitectureTransition(sb, productArchitectureId, "DEFINING", "V8 defining.");

  const req = await createProductRequirement(sb, {
    architectureId: productArchitectureId,
    projectId,
    title: "Persist receipt metadata per user",
    description: "Store receipt rows scoped to the signed-in user.",
    reqType: "FUNCTIONAL",
    priority: "HIGH",
    acceptanceCriteria: [],
  });
  if (req.status === "error") fail("product_req", req.message);
  const accepted = await updateProductRequirement(sb, req.data.id, {
    approvalStatus: "ACCEPTED",
    acceptanceCriteria: ["Receipt row includes owner and category"],
  });
  if (accepted.status === "error") fail("product_req_accept", accepted.message);

  const feature = await createProductFeature(sb, {
    architectureId: productArchitectureId,
    projectId,
    name: "Receipt storage",
    purpose: "Persist uploads",
    priority: "HIGH",
    requirementIds: [accepted.data.id],
  });
  if (feature.status === "error") fail("product_feature", feature.message);
  const featureApproved = await updateProductFeature(sb, feature.data.id, {
    status: "APPROVED",
    acceptanceCriteria: ["Receipt list loads for owner"],
    requirementIds: [accepted.data.id],
  });
  if (featureApproved.status === "error") fail("product_feature_approve", featureApproved.message);

  await createProductFlow(sb, {
    architectureId: productArchitectureId,
    projectId,
    name: "Upload receipt",
    actor: "User",
    startingCondition: "Signed in",
    steps: ["Upload", "Store", "List"],
    expectedOutcome: "Receipt visible",
    edgeCases: [],
    featureId: featureApproved.data.id,
  });

  const seededQuestions = await loadProductQuestions(sb, productArchitectureId);
  if (seededQuestions.status === "ok") {
    for (const row of seededQuestions.data) {
      if (row.status === "OPEN" || row.status === "ESCALATED") {
        await updateProductQuestion(sb, row.id, { status: "RESOLVED", resolution: "Closed for V8." });
      }
    }
  }

  await recordProductArchitectureTransition(sb, productArchitectureId, "REVIEW", "Ready for review.");
  await recordProductArchitectureTransition(sb, productArchitectureId, "APPROVED", "Approved.");

  const arch = await loadProductArchitecture(sb, projectId);
  const requirements = await loadProductRequirements(sb, productArchitectureId);
  const features = await loadProductFeatures(sb, productArchitectureId);
  if (arch.status !== "ok" || !arch.data) fail("product_reload", arch);
  if (requirements.status !== "ok" || features.status !== "ok") fail("product_lists", { requirements, features });
  const readiness = computeProductReadiness({
    architecture: arch.data,
    requirements: requirements.data,
    features: features.data,
    openQuestions: [],
    openCriticalDecisions: 0,
  });
  assert("product_build_ready_gate", readiness.buildReady, readiness);
  await recordProductArchitectureTransition(sb, productArchitectureId, "BUILD_READY", "Product BUILD_READY.");

  const sysInit = await initializeSystemArchitectureFromProject(sb, { projectId, seedNextAction: false });
  if (sysInit.status === "error") fail("system_init", sysInit.message);
  const systemArchitectureId = sysInit.data.id;

  await updateSystemArchitectureOverview(sb, systemArchitectureId, {
    summary: "Next.js + Supabase Auth + Postgres receipts.",
    authSummary: "Supabase Auth email/password via SSR cookies.",
    authorizationSummary: "RLS on owner_id = auth.uid().",
    runtimeTopology: ["Browser → Next.js", "Next.js → Supabase"],
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
  if (comp.status === "error") fail("component", comp.message);
  await updateSystemComponent(sb, comp.data.id, { status: "APPROVED", requirementIds: [accepted.data.id] });

  const authComp = await createSystemComponent(sb, {
    architectureId: systemArchitectureId,
    projectId,
    name: "Auth",
    purpose: "Sign-in",
    componentType: "AUTH",
  });
  if (authComp.status === "error") fail("auth_comp", authComp.message);
  await updateSystemComponent(sb, authComp.data.id, { status: "APPROVED" });

  const entity = await createSystemEntity(sb, {
    architectureId: systemArchitectureId,
    projectId,
    name: "receipts",
    purpose: "Receipt metadata",
    ownershipField: "owner_id",
    rlsExpectation: "Users may read/write rows where owner_id = auth.uid()",
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
    purpose: "Persist receipt",
    caller: "Web App",
    receiver: "Postgres",
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
    supportingRefs: [comp.data.humanId, iface.data.humanId],
  });

  await recordSystemArchitectureTransition(sb, systemArchitectureId, "REVIEW", "Review.");
  await recordSystemArchitectureTransition(sb, systemArchitectureId, "APPROVED", "Approved.");
  await recordSystemArchitectureTransition(sb, systemArchitectureId, "ARCHITECTURE_READY", "Architecture ready.");

  const system = await loadSystemArchitecture(sb, projectId);
  assert("system_architecture_ready", system.status === "ok" && system.data?.status === "ARCHITECTURE_READY", system);

  return {
    productArchitectureId,
    systemArchitectureId,
    requirementId: accepted.data.id,
    featureId: featureApproved.data.id,
    componentHumanId: comp.data.humanId,
    entityHumanId: entity.data.humanId,
    interfaceHumanId: iface.data.humanId,
  };
}

const idea = await raw
  .from("ideas")
  .insert({
    owner_id: uid,
    title: "V8 Build Plan acceptance idea",
    raw_idea: "Build plan after architecture ready.",
    summary: "Receipt MVP with build plan gate.",
    problem: "Build without a plan",
    target_user: "Freelancers",
    proposed_solution: "Build Plan after System Architecture",
    value_proposition: "Executable blueprint before coding",
    assumptions: ["Architecture gates first"],
    risks: ["Skipping plan"],
    opportunities: ["Traceability"],
    constraints_json: ["No V9 yet"],
    open_questions: [],
    status: "APPROVED",
    readiness: "DECISION_READY",
    note: "V8 acceptance seed",
  })
  .select("id")
  .single();
if (idea.error) fail("idea", idea.error);
const ideaId = idea.data.id;

const strategy = await raw
  .from("idea_strategies")
  .insert({
    idea_id: ideaId,
    problem: "Need authoritative build plan",
    target_customer: "Freelancers",
    value_proposition: "Receipt path",
    core_offer: "Capture",
    mvp: "Upload + store",
    not_building: "Bank sync",
    non_goals: ["Bank sync"],
    assumptions: ["Web"],
    risks: ["Scope"],
    constraints_json: ["Web"],
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
    name: "V8 Build Plan acceptance",
    slug: `v8-bp-${Date.now().toString(36)}`,
    description: "V8 operating loop",
    status: "PLANNING",
    lifecycle_stage: "STRATEGY",
    current_milestone: "Build Plan → BUILD_PLAN_READY",
  })
  .select("id")
  .single();
if (project.error) fail("project", project.error);
const projectId = project.data.id;
await raw.from("ideas").update({ promoted_project_id: projectId, status: "PROMOTED" }).eq("id", ideaId);

const seeded = await seedProductAndSystem(projectId, ideaId, strategyId);

const planInit = await initializeBuildPlanFromProject(sb, { projectId, seedNextAction: true });
if (planInit.status === "error") fail("build_plan_init", planInit.message);
const planId = planInit.data.id;
assert("plan_draft", planInit.data.status === "DRAFT", planInit.data);
assert("plan_product_link", planInit.data.productArchitectureId === seeded.productArchitectureId, planInit.data);
assert("plan_system_link", planInit.data.systemArchitectureId === seeded.systemArchitectureId, planInit.data);

let plan = planInit.data;
let bundleResult = await loadBuildPlanBundle(sb, plan);
if (bundleResult.status === "error") fail("bundle_initial", bundleResult.message);
let evaluated = evaluateBuildPlanBundle(bundleResult.data);
assert("readiness_blocks_initially", !evaluated.readiness.buildPlanReady && evaluated.blockers.length > 0, {
  blockers: evaluated.blockers.slice(0, 8),
});

await updateBuildPlanOverview(sb, planId, {
  summary: "Implement receipt persistence from ARCHITECTURE_READY design: schema, RLS, server actions, UI list.",
  deploymentSequence: [
    "preflight",
    "apply receipts migration",
    "configure env names",
    "deploy app",
    "health check",
    "smoke test owner isolation",
    "rollback via previous deploy if health fails",
  ],
  rollbackSummary: "Revert app deploy; migration may be irreversible without restore.",
});
await recordBuildPlanTransition(sb, planId, "PLANNING", "Founder began planning work packages.");

const phaseFoundation = await createBuildPhase(sb, {
  planId,
  projectId,
  name: "FOUNDATION",
  objective: "Auth and database foundation",
  position: 0,
});
if (phaseFoundation.status === "error") fail("phase_foundation", phaseFoundation.message);

const phaseDomain = await createBuildPhase(sb, {
  planId,
  projectId,
  name: "CORE DOMAIN",
  objective: "Receipt write/read path",
  position: 1,
});
if (phaseDomain.status === "error") fail("phase_domain", phaseDomain.message);

const wpSchema = await createWorkPackage(sb, {
  planId,
  projectId,
  phaseId: phaseFoundation.data.id,
  title: "Receipts table migration + RLS",
  objective: "Add receipts entity with owner_id RLS",
  description: "Design migration from ENT receipts; do not apply in V8.",
  priority: "CRITICAL",
  status: "READY",
  databaseImpact: "Create receipts table; RLS policies; owner_id.",
  securityImpact: "Owner isolation via RLS",
  pathCertainty: "EXPECTED_AREA",
  likelyCodeAreas: ["supabase/migrations/*"],
  definitionOfDone: ["Migration exists", "RLS policy designed", "Types updated"],
  acceptanceCriteria: ["owner_id present", "PK present"],
  rollbackConsideration: "IRREVERSIBLE without backup if applied later",
  irreversible: true,
});
if (wpSchema.status === "error") fail("wp_schema", wpSchema.message);

const wpApi = await createWorkPackage(sb, {
  planId,
  projectId,
  phaseId: phaseDomain.data.id,
  title: "Create receipt server action",
  objective: "Implement create receipt interface",
  description: "Server action matching API create receipt.",
  priority: "HIGH",
  status: "PLANNED",
  pathCertainty: "EXPECTED_AREA",
  likelyCodeAreas: ["src/app/*", "src/lib/*"],
  definitionOfDone: ["Action exists", "Auth required", "Linked tests planned"],
  acceptanceCriteria: ["Insert succeeds for owner"],
});
if (wpApi.status === "error") fail("wp_api", wpApi.message);

const wpUi = await createWorkPackage(sb, {
  planId,
  projectId,
  phaseId: phaseDomain.data.id,
  title: "Receipt list UI",
  objective: "Show owner receipts",
  description: "List UI for feature Receipt storage.",
  priority: "HIGH",
  status: "BLOCKED",
  pathCertainty: "UNKNOWN",
  definitionOfDone: ["List renders for owner", "Empty state"],
  acceptanceCriteria: ["Owner sees own rows only"],
});
if (wpUi.status === "error") fail("wp_ui", wpUi.message);

// Parallel-safe with schema? No — api depends on schema. UI depends on api. CAN_RUN_WITH between unrelated not needed.
await createWorkPackageDependency(sb, {
  planId,
  projectId,
  fromPackageId: wpApi.data.id,
  toPackageId: wpSchema.data.id,
  edgeKind: "DEPENDS_ON",
  note: "API needs table",
});
await createWorkPackageDependency(sb, {
  planId,
  projectId,
  fromPackageId: wpUi.data.id,
  toPackageId: wpApi.data.id,
  edgeKind: "DEPENDS_ON",
  note: "UI needs create path",
});

// Coverage links — initially leave feature uncovered to prove readiness gap, then fix.
await linkRequirement(sb, wpSchema.data.id, seeded.requirementId);
await linkArchitecture(sb, {
  workPackageId: wpSchema.data.id,
  planId,
  projectId,
  linkKind: "ENTITY",
  recordRef: seeded.entityHumanId,
});
await linkArchitecture(sb, {
  workPackageId: wpSchema.data.id,
  planId,
  projectId,
  linkKind: "COMPONENT",
  recordRef: seeded.componentHumanId,
});
await linkArchitecture(sb, {
  workPackageId: wpSchema.data.id,
  planId,
  projectId,
  linkKind: "COMPONENT",
  recordRef: "COMP-002",
});
await linkArchitecture(sb, {
  workPackageId: wpApi.data.id,
  planId,
  projectId,
  linkKind: "INTERFACE",
  recordRef: seeded.interfaceHumanId,
});

await createVerification(sb, {
  workPackageId: wpSchema.data.id,
  planId,
  projectId,
  kind: "RLS",
  description: "Anon cannot read owner receipts; owner can read own rows.",
  observableSignal: "RLS probe exits 0",
});
await createVerification(sb, {
  workPackageId: wpApi.data.id,
  planId,
  projectId,
  kind: "INTEGRATION",
  description: "Authenticated create receipt returns id.",
  observableSignal: "Integration test pass",
});
// Intentionally omit UI verification first to force a gap.

await createManualAction(sb, {
  planId,
  projectId,
  workPackageId: wpSchema.data.id,
  title: "Apply receipts migration in Supabase SQL Editor when V9 begins",
  description: "Founder-run migration for target product — not during V8.",
  status: "REQUIRED",
});

await createConfigRequirement(sb, {
  planId,
  projectId,
  workPackageId: wpApi.data.id,
  variableName: "NEXT_PUBLIC_SUPABASE_URL",
  purpose: "Client Supabase URL",
  environment: "production",
  classification: "PUBLIC",
  founderActionRequired: false,
});

await createBuildRisk(sb, {
  planId,
  projectId,
  workPackageId: wpSchema.data.id,
  description: "Migration ordering risk if receipts FK to profiles is wrong.",
  severity: "HIGH",
  mitigation: "Apply after auth tables; verify with RLS probe before deploy.",
});

plan = (await loadBuildPlan(sb, projectId)).data!;
bundleResult = await loadBuildPlanBundle(sb, plan);
if (bundleResult.status === "error") fail("bundle_gap", bundleResult.message);
evaluated = evaluateBuildPlanBundle(bundleResult.data);
assert("gap_refuses_ready", !evaluated.readiness.buildPlanReady, evaluated.blockers);
assert(
  "gap_includes_feature_or_verify",
  evaluated.blockers.some((b) => b.code.startsWith("FEAT_") || b.code.startsWith("VERIFY_")),
  evaluated.blockers,
);

// Fix gaps: link feature, add UI verification
await linkFeature(sb, wpUi.data.id, seeded.featureId);
await createVerification(sb, {
  workPackageId: wpUi.data.id,
  planId,
  projectId,
  kind: "E2E",
  description: "Owner sees receipt list after create.",
  observableSignal: "Browser flow pass",
});

await recordBuildPlanTransition(sb, planId, "REVIEW", "Plan ready for founder review.");
await recordBuildPlanTransition(sb, planId, "APPROVED", "Founder approved build plan.");

plan = (await loadBuildPlan(sb, projectId)).data!;
bundleResult = await loadBuildPlanBundle(sb, plan);
if (bundleResult.status === "error") fail("bundle_pre_ready", bundleResult.message);
evaluated = evaluateBuildPlanBundle(bundleResult.data);

const cycle = detectDependencyCycles(bundleResult.data.packages, bundleResult.data.dependencies);
assert("no_cycle", cycle === null, cycle);
const waves = computeExecutionWaves(bundleResult.data.packages, bundleResult.data.dependencies);
assert("waves_schema_first", waves[0]?.includes(wpSchema.data.humanId), waves);
assert("waves_ui_later", waves.length >= 2 && waves.some((w) => w.includes(wpUi.data.humanId)), waves);
const critical = computeCriticalPath(bundleResult.data.packages, bundleResult.data.dependencies);
assert("critical_path_len", critical.length >= 2, critical);

assert("readiness_clear", evaluated.readiness.buildPlanReady && evaluated.blockers.length === 0, {
  blockers: evaluated.blockers,
  gaps: evaluated.readiness.gaps,
});

const toReady = await recordBuildPlanTransition(
  sb,
  planId,
  "BUILD_PLAN_READY",
  "Deterministic readiness cleared; plan ready for implementation.",
);
if (toReady.status === "error") fail("transition_build_plan_ready", toReady.message);

const finalPlan = await loadBuildPlan(sb, projectId);
if (finalPlan.status !== "ok" || !finalPlan.data) fail("final_plan", finalPlan);
assert("status_build_plan_ready", finalPlan.data.status === "BUILD_PLAN_READY", finalPlan.data.status);

bundleResult = await loadBuildPlanBundle(sb, finalPlan.data);
if (bundleResult.status === "error") fail("bundle_final", bundleResult.message);
evaluated = evaluateBuildPlanBundle(bundleResult.data);

const truthReady = answerBuildPlanTruthQuestion("Are we ready to start coding?", {
  plan: finalPlan.data,
  packageStatuses: bundleResult.data.packages.map((row) => row.status),
});
assert("truth_ready_to_code", truthReady?.answer === "YES", truthReady);

const truthImpl = answerBuildPlanTruthQuestion("Is WP-001 implemented?", {
  plan: finalPlan.data,
  packageStatuses: bundleResult.data.packages.map((row) => row.status),
});
assert("truth_not_implemented", truthImpl?.answer === "NO", truthImpl);

const truthDeploy = answerBuildPlanTruthQuestion("Is this deployed?", {
  plan: finalPlan.data,
  packageStatuses: bundleResult.data.packages.map((row) => row.status),
});
assert("truth_not_deployed", truthDeploy?.answer === "NO", truthDeploy);

const truthPast = answerBuildPlanTruthQuestion("Did Ghost say this was approved in a past response?", {
  plan: finalPlan.data,
  packageStatuses: bundleResult.data.packages.map((row) => row.status),
});
assert("truth_past_ghost", truthPast?.kind === "MODEL_SUGGESTION" && truthPast.answer === "NO", truthPast);

const suggestion = suggestBuildNextAction({
  readiness: evaluated.readiness,
  planStatus: finalPlan.data.status,
  packageCount: bundleResult.data.packages.length,
  phaseCount: bundleResult.data.phases.length,
  summaryPresent: Boolean(finalPlan.data.summary.trim()),
});

const nextActionInsert = await raw
  .from("next_actions")
  .insert({
    project_id: projectId,
    title: suggestion?.title ?? "Begin implementation from BUILD_PLAN_READY plan",
    description: suggestion?.description ?? "Build Plan is ready; implementation is separate (V9).",
    status: "OPEN",
    position: 1,
    priority: "HIGH",
    provenance: "FOUNDER_APPROVED_ACTION",
    source_kind: suggestion?.sourceKind ?? "build_plan",
    source_ref: planId,
    requires_decision: false,
  })
  .select("id,title")
  .single();
if (nextActionInsert.error) fail("next_action", nextActionInsert.error);

const today = await raw.from("next_actions").select("id,title,status,source_kind").eq("project_id", projectId).eq("status", "OPEN");
assert("today", (today.data?.length ?? 0) >= 1, today.error || today.data);

const brain = await raw.from("project_knowledge").select("title,source,content").eq("project_id", projectId);
assert(
  "brain_build_plan",
  (brain.data ?? []).some((row) => String(row.title).includes("Build Plan") || String(row.source || "").includes(planId)),
  brain.data,
);

const askItems = collectBuildPlanItems({
  question: "What should we build first and is anything implemented?",
  bundle: bundleResult.data,
});
assert("ask_ghost_items", askItems.length >= 2, askItems);
assert(
  "ask_ghost_truth",
  askItems.some((item) => item.type === "truth_boundary"),
  askItems,
);

const stranger = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const leaked = await stranger.from("build_plans").select("id").eq("id", planId);
assert("rls_anon_blocked", (leaked.data?.length ?? 0) === 0, leaked);

const illegal = await raw.rpc("record_build_plan_transition", {
  target_plan_id: planId,
  next_status: "DRAFT",
  transition_reason: "illegal skip",
  transition_actor: "FOUNDER",
});
assert("illegal_transition_blocked", Boolean(illegal.error), illegal);

console.log(
  JSON.stringify(
    {
      pass: true,
      ideaId,
      strategyId,
      projectId,
      productArchitectureId: seeded.productArchitectureId,
      systemArchitectureId: seeded.systemArchitectureId,
      planId,
      status: finalPlan.data.status,
      waves,
      criticalPath: critical,
      readiness: evaluated.readiness.buildPlanReady,
      todayCount: today.data?.length ?? 0,
      askGhostItemTypes: askItems.map((item) => item.type),
      chain:
        "BUILD_READY → ARCHITECTURE_READY → Build Plan → Phases/WPs/Deps/Coverage/Verify → BUILD_PLAN_READY → Today → Brain → Ask Ghost",
    },
    null,
    2,
  ),
);

await admin.from("projects").delete().eq("id", projectId);
await admin.from("ideas").delete().eq("id", ideaId);
