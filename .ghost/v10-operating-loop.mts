/**
 * V10 Verification acceptance against live Ghost Supabase.
 * BUILD_PLAN_READY → Execution IMPLEMENTED → Verification → VERIFIED (≠ DEPLOYED).
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
import { collectVerificationItems } from "@/lib/verification/context";
import { initializeVerificationFromProject } from "@/lib/verification/initialize";
import {
  addVerificationEvidence,
  createVerificationDefect,
  loadVerificationBundle,
  loadVerificationCases,
  loadVerificationProgram,
  recordRetestEvent,
  recordVerificationProgramTransition,
  resolveVerificationDefect,
  updateVerificationCase,
} from "@/lib/verification/queries";
import { answerVerificationTruthQuestion } from "@/lib/verification/truth";
import { evaluateVerificationBundle, suggestVerificationNextAction } from "@/lib/verification/workflow";

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
    what: "Receipt MVP for V10 verification",
    why: "Need IMPLEMENTED execution before verification",
    who: "Freelancers",
    outcome: "Evidence-backed verification gate",
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
        await updateProductQuestion(sb, row.id, { status: "RESOLVED", resolution: "Closed for V10." });
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
    title: "V10 Verification acceptance",
    raw_idea: "Verify after IMPLEMENTED",
    summary: "Receipt MVP verification gate",
    problem: "Implementation without verification",
    target_user: "Freelancers",
    proposed_solution: "Verification program",
    value_proposition: "Evidence-backed verification",
    assumptions: [],
    risks: [],
    opportunities: [],
    constraints_json: [],
    open_questions: [],
    status: "APPROVED",
    readiness: "DECISION_READY",
    note: "V10 acceptance",
  })
  .select("id")
  .single();
if (idea.error) fail("idea", idea.error);
const ideaId = idea.data.id;

const strategy = await raw
  .from("idea_strategies")
  .insert({
    idea_id: ideaId,
    problem: "Need verification",
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
    name: "V10 Verification acceptance",
    slug: `v10-ver-${Date.now().toString(36)}`,
    description: "V10 operating loop",
    status: "PLANNING",
    lifecycle_stage: "STRATEGY",
    current_milestone: "Verification → VERIFIED",
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

const verInit = await initializeVerificationFromProject(sb, { projectId, seedNextAction: true });
if (verInit.status === "error") fail("ver_init", verInit.message);
const programId = verInit.data.id;
assert("program_not_started", verInit.data.status === "NOT_STARTED", verInit.data);
assert("program_exec_link", verInit.data.buildExecutionId === executionId, verInit.data);

const cases = await loadVerificationCases(sb, programId);
if (cases.status === "error") fail("cases", cases.message);
assert("seeded_cases", cases.data.length === 2, cases.data);
assert(
  "cases_ready",
  cases.data.every((row) => row.status === "READY"),
  cases.data,
);
assert(
  "coverage_links",
  cases.data.some((row) => row.requirementId === seeded.requirementId) &&
    cases.data.some((row) => row.featureId === seeded.featureId),
  cases.data,
);

const caseByWp = new Map(cases.data.map((row) => [row.workPackageId, row]));
const tc1 = caseByWp.get(seeded.wp1Id)!;
const tc2 = caseByWp.get(seeded.wp2Id)!;

// Start TESTING via first case
await recordVerificationProgramTransition(sb, programId, "TESTING", "Founder began verification testing.");
const run1 = await updateVerificationCase(sb, tc1.id, {
  status: "RUNNING",
  startedAt: new Date().toISOString(),
});
if (run1.status === "error") fail("run_tc1", run1.message);

// Pass TC1 with evidence
const ev1 = await addVerificationEvidence(sb, {
  caseId: tc1.id,
  programId,
  projectId,
  kind: "RLS_PROBE",
  reference: "inspector:v10-rls-owner-isolation",
  summary: "Owner isolation probe exit 0",
});
if (ev1.status === "error") fail("ver_ev1", ev1.message);
const passWithoutEvidence = await updateVerificationCase(sb, tc1.id, { status: "PASSED" }, { evidenceCount: 0 });
assert("pass_requires_evidence", passWithoutEvidence.status === "error", passWithoutEvidence);

const pass1 = await updateVerificationCase(
  sb,
  tc1.id,
  {
    status: "PASSED",
    actualResult: "probe exit 0",
    completedAt: new Date().toISOString(),
  },
  { evidenceCount: 1 },
);
if (pass1.status === "error") fail("pass_tc1", pass1.message);

// Fail TC2 → defect → resolve → retest pass
const run2 = await updateVerificationCase(sb, tc2.id, {
  status: "RUNNING",
  startedAt: new Date().toISOString(),
});
if (run2.status === "error") fail("run_tc2", run2.message);
const fail2 = await updateVerificationCase(sb, tc2.id, {
  status: "FAILED",
  actualResult: "create receipt returned null id",
  completedAt: new Date().toISOString(),
});
if (fail2.status === "error") fail("fail_tc2", fail2.message);

const defect = await createVerificationDefect(sb, {
  programId,
  projectId,
  caseId: tc2.id,
  title: "Create receipt returns null id",
  description: "Integration case failed on id assertion",
  severity: "HIGH",
  packageExecutionId: pe2After.id,
  featureId: seeded.featureId,
  createUpstreamChange: true,
  buildExecutionId: executionId,
});
if (defect.status === "error") fail("defect", defect.message);
assert("defect_blocking", defect.data.blocking === true && defect.data.status === "OPEN", defect.data);

let program = (await loadVerificationProgram(sb, projectId)).data!;
let vBundle = await loadVerificationBundle(sb, program);
if (vBundle.status === "error") fail("vbundle_blocked", vBundle.message);
let evaluated = evaluateVerificationBundle(vBundle.data);
assert("not_complete_with_defect", !evaluated.completion.verificationComplete, evaluated.completion.gaps);
assert(
  "blocking_gap",
  evaluated.completion.gaps.some((g) => g.code === "OPEN_BLOCKING_DEFECTS"),
  evaluated.completion.gaps,
);

const resolved = await resolveVerificationDefect(
  sb,
  defect.data.id,
  "Fixed create-receipt to return inserted id; ready for retest.",
);
if (resolved.status === "error") fail("resolve_defect", resolved.message);
assert("retest_required", resolved.data.status === "RETEST_REQUIRED", resolved.data);

const reset2 = await updateVerificationCase(sb, tc2.id, { status: "READY" });
if (reset2.status === "error") fail("reset_tc2", reset2.message);
await updateVerificationCase(sb, tc2.id, {
  status: "RUNNING",
  startedAt: new Date().toISOString(),
});
const ev2 = await addVerificationEvidence(sb, {
  caseId: tc2.id,
  programId,
  projectId,
  kind: "AUTOMATED_RESULT",
  reference: "npm test -- create-receipt.integration",
  summary: "Integration test pass after defect fix",
});
if (ev2.status === "error") fail("ver_ev2", ev2.message);
const pass2 = await updateVerificationCase(
  sb,
  tc2.id,
  {
    status: "PASSED",
    actualResult: "test pass; id returned",
    completedAt: new Date().toISOString(),
  },
  { evidenceCount: 1 },
);
if (pass2.status === "error") fail("pass_tc2", pass2.message);

const retest = await recordRetestEvent(sb, {
  defectId: defect.data.id,
  programId,
  projectId,
  caseId: tc2.id,
  resultStatus: "PASSED",
  evidenceId: ev2.data.id,
  note: "Retest passed after create-receipt fix.",
});
if (retest.status === "error") fail("retest", retest.message);

const defectsAfter = await raw
  .from("verification_defects")
  .select("status")
  .eq("id", defect.data.id)
  .single();
assert("defect_closed", defectsAfter.data?.status === "CLOSED", defectsAfter);

await recordVerificationProgramTransition(
  sb,
  programId,
  "VERIFICATION_REVIEW",
  "All required cases passed with evidence; blocking defects closed.",
);

program = (await loadVerificationProgram(sb, projectId)).data!;
vBundle = await loadVerificationBundle(sb, program);
if (vBundle.status === "error") fail("vbundle_review", vBundle.message);
evaluated = evaluateVerificationBundle(vBundle.data);
assert("complete_in_review", evaluated.completion.verificationComplete, evaluated.completion.gaps);

const prematureVerified = await recordVerificationProgramTransition(
  sb,
  programId,
  "VERIFIED",
  "Gate cleared. VERIFIED ≠ DEPLOYED.",
);
if (prematureVerified.status === "error") fail("to_verified", prematureVerified.message);

program = (await loadVerificationProgram(sb, projectId)).data!;
assert("status_verified", program.status === "VERIFIED", program.status);
assert("verified_at", Boolean(program.verifiedAt), program);

vBundle = await loadVerificationBundle(sb, program);
if (vBundle.status === "error") fail("vbundle_final", vBundle.message);
evaluated = evaluateVerificationBundle(vBundle.data);
assert("still_complete", evaluated.completion.verificationComplete, evaluated.completion.gaps);

const truthCtx = {
  program,
  executionStatus: execution.status as "IMPLEMENTED",
  cases: vBundle.data.cases,
  evidence: vBundle.data.evidence,
  defects: vBundle.data.defects,
  requirements: vBundle.data.requirements.map((r) => ({ id: r.id, humanId: r.humanId, title: r.title })),
};

const truthVerified = answerVerificationTruthQuestion("Is it verified?", truthCtx);
assert("truth_verified_yes", truthVerified?.answer === "YES", truthVerified);

const truthDeployed = answerVerificationTruthQuestion("Is it deployed?", truthCtx);
assert("truth_not_deployed", truthDeployed?.answer === "NO" && truthDeployed.kind === "NOT_DEPLOYED", truthDeployed);

const truthMeansDeployed = answerVerificationTruthQuestion("does verified mean deployed?", truthCtx);
assert("truth_verified_neq_deployed", truthMeansDeployed?.answer === "NO", truthMeansDeployed);

const truthImpl = answerVerificationTruthQuestion("is implementation complete?", truthCtx);
assert("truth_implemented_yes", truthImpl?.answer === "YES", truthImpl);

const suggestion = suggestVerificationNextAction({
  completion: evaluated.completion,
  programStatus: program.status,
  cases: vBundle.data.cases,
  defects: vBundle.data.defects,
});

const today = await raw.from("next_actions").select("id,title").eq("project_id", projectId).eq("status", "OPEN");
assert("today", (today.data?.length ?? 0) >= 1, today);

const brain = await raw.from("project_knowledge").select("title,source").eq("project_id", projectId);
assert(
  "brain_ver",
  (brain.data ?? []).some(
    (row) => String(row.title).includes("Verification") || String(row.source).includes(programId),
  ),
  brain.data,
);

const askItems = collectVerificationItems({
  question: "Is it verified and is it deployed?",
  bundle: vBundle.data,
});
assert("ask_items", askItems.length >= 2, askItems);
assert(
  "ask_truth",
  askItems.some((item) => item.type === "truth_boundary"),
  askItems,
);

const stranger = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const leaked = await stranger.from("verification_programs").select("id").eq("id", programId);
assert("rls_anon", (leaked.data?.length ?? 0) === 0, leaked);

const illegal = await raw.rpc("record_verification_program_transition", {
  target_program_id: programId,
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
      programId,
      executionStatus: execution.status,
      programStatus: program.status,
      cases: vBundle.data.cases.map((row) => ({
        humanId: row.humanId,
        status: row.status,
        requirementId: row.requirementId,
        featureId: row.featureId,
      })),
      evidenceCount: vBundle.data.evidence.length,
      defects: vBundle.data.defects.map((row) => ({ humanId: row.humanId, status: row.status })),
      completion: evaluated.completion.verificationComplete,
      todayCount: today.data?.length ?? 0,
      suggestion: suggestion?.title ?? null,
      askGhostItemTypes: askItems.map((item) => item.type),
      chain:
        "IMPLEMENTED → Verification → TESTING → fail/defect/retest → VERIFICATION_REVIEW → VERIFIED ≠ DEPLOYED",
    },
    null,
    2,
  ),
);

await admin.from("projects").delete().eq("id", projectId);
await admin.from("ideas").delete().eq("id", ideaId);
