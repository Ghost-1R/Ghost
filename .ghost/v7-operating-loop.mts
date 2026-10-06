/**
 * V7 System Architecture acceptance against live Ghost Supabase.
 * BUILD_READY Product Architect → System Architecture → ARCHITECTURE_READY.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { GhostClient } from "@/lib/auth/session";
import { collectSystemArchitectureItems } from "@/lib/system-architecture/context";
import { initializeSystemArchitectureFromProject } from "@/lib/system-architecture/initialize";
import {
  createSystemComponent,
  createSystemDataFlow,
  createSystemEntity,
  createSystemEntityField,
  createSystemIntegration,
  createSystemInterface,
  createSystemRelationship,
  createSystemRisk,
  loadSystemArchitecture,
  loadSystemArchitectureBundle,
  recordSystemArchitectureTransition,
  updateSystemArchitectureOverview,
  updateSystemComponent,
  updateSystemEntity,
  updateSystemInterface,
  upsertRequirementCoverage,
} from "@/lib/system-architecture/queries";
import { answerSystemTruthQuestion } from "@/lib/system-architecture/truth";
import { evaluateSystemBundle, suggestSystemNextAction } from "@/lib/system-architecture/workflow";
import { initializeProductArchitectFromProject } from "@/lib/product-architect/initialize";
import {
  createProductFeature,
  createProductFlow,
  createProductRequirement,
  loadProductArchitecture,
  loadProductQuestions,
  loadProductFeatures,
  loadProductRequirements,
  recordProductArchitectureTransition,
  updateProductDefinition,
  updateProductFeature,
  updateProductQuestion,
  updateProductRequirement,
} from "@/lib/product-architect/queries";
import { computeProductReadiness } from "@/lib/product-architect/workflow";

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
    const message =
      detail && typeof detail === "object" ? JSON.stringify(detail) : detail ?? new Error("assertion failed");
    fail(step, message);
  }
}

const { data: auth, error: authErr } = await raw.auth.signInWithPassword({ email, password });
if (authErr) fail("auth", authErr);
const uid = auth.user.id;

async function bringProductToBuildReady(projectId: string, ideaId: string, strategyId: string): Promise<{
  productArchitectureId: string;
  requirementId: string;
}> {
  const init = await initializeProductArchitectFromProject(sb, { projectId, ideaId, strategyId, seedNextAction: false });
  if (init.status === "error") fail("product_init", init.message);
  const productArchitectureId = init.data.id;

  await updateProductDefinition(sb, productArchitectureId, {
    what: "Receipt capture MVP for V7 system architecture acceptance",
    why: "Need BUILD_READY product before system design",
    who: "Freelancers",
    outcome: "Authoritative system design gate",
    nonGoals: ["Bank sync"],
    assumptions: ["Web first"],
    risks: ["OCR variance"],
    constraints: ["Responsive web"],
  });
  await recordProductArchitectureTransition(sb, productArchitectureId, "DEFINING", "V7 acceptance defining.");

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
    expectedOutcome: "Receipt visible in list",
    edgeCases: [],
    featureId: featureApproved.data.id,
  });

  const seededQuestions = await loadProductQuestions(sb, productArchitectureId);
  if (seededQuestions.status === "ok") {
    for (const row of seededQuestions.data) {
      if (row.status === "OPEN" || row.status === "ESCALATED") {
        await updateProductQuestion(sb, row.id, { status: "RESOLVED", resolution: "Closed for V7 acceptance." });
      }
    }
  }

  await recordProductArchitectureTransition(sb, productArchitectureId, "REVIEW", "Ready for review.");
  await recordProductArchitectureTransition(sb, productArchitectureId, "APPROVED", "Founder approved.");

  const arch = await loadProductArchitecture(sb, projectId);
  const requirements = await loadProductRequirements(sb, productArchitectureId);
  const features = await loadProductFeatures(sb, productArchitectureId);
  if (arch.status !== "ok" || !arch.data) fail("product_reload", arch);
  if (requirements.status !== "ok") fail("product_reqs_reload", requirements);
  if (features.status !== "ok") fail("product_feats_reload", features);
  const readiness = computeProductReadiness({
    architecture: arch.data,
    requirements: requirements.data,
    features: features.data,
    openQuestions: [],
    openCriticalDecisions: 0,
  });
  assert("product_build_ready_gate", readiness.buildReady, readiness);
  await recordProductArchitectureTransition(
    sb,
    productArchitectureId,
    "BUILD_READY",
    "Product BUILD_READY for system architecture.",
  );

  return { productArchitectureId, requirementId: accepted.data.id };
}

// --- Seed project chain ---
const idea = await raw
  .from("ideas")
  .insert({
    owner_id: uid,
    title: "V7 System Architecture acceptance idea",
    raw_idea: "System design after BUILD_READY product.",
    summary: "Receipt MVP with system architecture gate.",
    problem: "Build without system design",
    target_user: "Freelancers",
    proposed_solution: "System Architecture after Product Architect",
    value_proposition: "Design before build plan",
    assumptions: ["Product Architect gates first"],
    risks: ["Skipping design"],
    opportunities: ["Traceability"],
    constraints_json: ["No V8 yet"],
    open_questions: [],
    status: "APPROVED",
    readiness: "DECISION_READY",
    note: "V7 acceptance seed",
  })
  .select("id")
  .single();
if (idea.error) fail("idea", idea.error);
const ideaId = idea.data.id;

const strategy = await raw
  .from("idea_strategies")
  .insert({
    idea_id: ideaId,
    problem: "Need authoritative system design",
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
    name: "V7 System Architecture acceptance",
    slug: `v7-sa-${Date.now().toString(36)}`,
    description: "V7 operating loop",
    status: "PLANNING",
    lifecycle_stage: "STRATEGY",
    current_milestone: "System Architecture → ARCHITECTURE_READY",
  })
  .select("id")
  .single();
if (project.error) fail("project", project.error);
const projectId = project.data.id;
await raw.from("ideas").update({ promoted_project_id: projectId, status: "PROMOTED" }).eq("id", ideaId);

const { productArchitectureId, requirementId } = await bringProductToBuildReady(projectId, ideaId, strategyId);

const sysInit = await initializeSystemArchitectureFromProject(sb, { projectId, seedNextAction: true });
if (sysInit.status === "error") fail("system_init", sysInit.message);
const systemArchitectureId = sysInit.data.id;
assert("system_status_draft", sysInit.data.status === "DRAFT", sysInit.data);
assert("system_product_link", sysInit.data.productArchitectureId === productArchitectureId, sysInit.data);

const brainInit = await raw
  .from("project_knowledge")
  .select("title,source")
  .eq("project_id", projectId)
  .ilike("title", "%System Architecture initialized%");
assert("brain_system_init", (brainInit.data?.length ?? 0) >= 1, brainInit.error || brainInit.data);

let arch = sysInit.data;
let bundleResult = await loadSystemArchitectureBundle(sb, arch);
if (bundleResult.status === "error") fail("bundle_initial", bundleResult.message);
let evaluated = evaluateSystemBundle(bundleResult.data);
assert("readiness_blocks_initially", !evaluated.readiness.architectureReady && evaluated.blockers.length > 0, {
  blockers: evaluated.blockers.slice(0, 5),
});

const gateBlocked = evaluated.blockers.length > 0;
assert("architecture_ready_gate_simulation", gateBlocked, evaluated.blockers[0]);

const overview = await updateSystemArchitectureOverview(sb, systemArchitectureId, {
  summary: "Next.js web app with Supabase Auth, Postgres storage for receipts, and object storage for files.",
  authSummary: "Supabase Auth email/password; session in HTTP-only cookies via SSR client.",
  authorizationSummary: "RLS on user-owned receipt rows via owns_project-style owner_id checks.",
  runtimeTopology: ["Browser → Next.js App Router", "Next.js → Supabase Postgres + Storage"],
});
if (overview.status === "error") fail("overview", overview.message);
arch = overview.data;

await recordSystemArchitectureTransition(sb, systemArchitectureId, "DESIGNING", "Founder began system design.");

const comp = await createSystemComponent(sb, {
  architectureId: systemArchitectureId,
  projectId,
  name: "Web App",
  purpose: "Receipt capture UI and server actions",
  componentType: "WEB_APPLICATION",
  responsibilities: ["Upload UI", "List receipts"],
  requirementIds: [requirementId],
  status: "PROPOSED",
});
if (comp.status === "error") fail("component", comp.message);

const authComp = await createSystemComponent(sb, {
  architectureId: systemArchitectureId,
  projectId,
  name: "Auth",
  purpose: "Sign-in and session",
  componentType: "AUTH",
  status: "PROPOSED",
});
if (authComp.status === "error") fail("auth_component", authComp.message);

const compApproved = await updateSystemComponent(sb, comp.data.id, { status: "APPROVED", requirementIds: [requirementId] });
if (compApproved.status === "error") fail("component_approve", compApproved.message);
await updateSystemComponent(sb, authComp.data.id, { status: "APPROVED" });

const entity = await createSystemEntity(sb, {
  architectureId: systemArchitectureId,
  projectId,
  name: "receipts",
  purpose: "Receipt metadata per user",
  ownershipField: "owner_id",
  rlsExpectation: "Users may read/write rows where owner_id = auth.uid()",
  sensitiveClass: "PII",
  status: "PROPOSED",
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
  purpose: "Persist receipt metadata",
  caller: "Web App",
  receiver: "Postgres",
  operation: "insert receipt row",
  authRequired: true,
  requirementIds: [requirementId],
  status: "PROPOSED",
});
if (iface.status === "error") fail("interface", iface.message);
await updateSystemInterface(sb, iface.data.id, { status: "APPROVED", requirementIds: [requirementId] });

await createSystemRelationship(sb, {
  architectureId: systemArchitectureId,
  projectId,
  sourceEntityId: entity.data.id,
  targetEntityId: entity.data.id,
  cardinality: "ONE_TO_ONE",
  rationale: "Self reference placeholder for acceptance (not used in MVP)",
  status: "APPROVED",
});

await createSystemDataFlow(sb, {
  architectureId: systemArchitectureId,
  projectId,
  name: "Receipt upload path",
  sourceLabel: "Browser file picker",
  processLabel: "Next.js server action",
  storageLabel: "receipts table",
  resultLabel: "Receipt list refresh",
  steps: ["Validate session", "Insert row", "Return receipt id"],
  componentRefs: [compApproved.data.humanId],
  status: "APPROVED",
});

await createSystemIntegration(sb, {
  architectureId: systemArchitectureId,
  projectId,
  provider: "Supabase",
  purpose: "Auth, Postgres, Storage",
  secretNames: ["SUPABASE_SERVICE_ROLE_KEY"],
  status: "APPROVED",
});

await createSystemRisk(sb, {
  architectureId: systemArchitectureId,
  projectId,
  description: "RLS misconfiguration: receipt rows could leak if policies omit owner_id check.",
  severity: "HIGH",
  mitigation: "Design RLS in build plan; verify with anon probes.",
  status: "APPROVED",
});

const coverage = await upsertRequirementCoverage(sb, {
  architectureId: systemArchitectureId,
  projectId,
  requirementId,
  coverage: "COVERED",
  supportingRefs: [compApproved.data.humanId, iface.data.humanId],
  gapNote: "Web component + create receipt interface cover REQ.",
});
if (coverage.status === "error") fail("coverage", coverage.message);

await recordSystemArchitectureTransition(sb, systemArchitectureId, "REVIEW", "Design ready for founder review.");
await recordSystemArchitectureTransition(sb, systemArchitectureId, "APPROVED", "Founder approved system design.");

arch = (await loadSystemArchitecture(sb, projectId)).data!;
bundleResult = await loadSystemArchitectureBundle(sb, arch);
if (bundleResult.status === "error") fail("bundle_pre_ready", bundleResult.message);
evaluated = evaluateSystemBundle(bundleResult.data);
assert("readiness_clear_before_architecture_ready", evaluated.readiness.architectureReady && evaluated.blockers.length === 0, {
  blockers: evaluated.blockers,
  gaps: evaluated.readiness.gaps,
});

const toReady = await recordSystemArchitectureTransition(
  sb,
  systemArchitectureId,
  "ARCHITECTURE_READY",
  "Deterministic readiness cleared; design ready for build plan.",
);
if (toReady.status === "error") fail("transition_architecture_ready", toReady.message);

const finalArch = await loadSystemArchitecture(sb, projectId);
if (finalArch.status !== "ok" || !finalArch.data) fail("final_arch", finalArch);
assert("status_architecture_ready", finalArch.data.status === "ARCHITECTURE_READY", finalArch.data.status);

bundleResult = await loadSystemArchitectureBundle(sb, finalArch.data);
if (bundleResult.status === "error") fail("bundle_final", bundleResult.message);
evaluated = evaluateSystemBundle(bundleResult.data);

const truthReady = answerSystemTruthQuestion("Is this ready for a build plan?", {
  architecture: finalArch.data,
  readinessReasons: evaluated.readiness.reasons,
  entities: bundleResult.data.entities,
});
assert("truth_build_plan_yes", truthReady?.answer === "YES", truthReady);

const truthDeployed = answerSystemTruthQuestion("Is the product deployed?", {
  architecture: finalArch.data,
  readinessReasons: evaluated.readiness.reasons,
  entities: bundleResult.data.entities,
});
assert("truth_not_deployed", truthDeployed?.answer === "NO" && truthDeployed.kind === "NOT_IMPLEMENTED", truthDeployed);

const truthPast = answerSystemTruthQuestion("Did Ghost say this was approved in a past response?", {
  architecture: finalArch.data,
  readinessReasons: evaluated.readiness.reasons,
  entities: bundleResult.data.entities,
});
assert("truth_past_ghost_no", truthPast?.kind === "MODEL_SUGGESTION" && truthPast.answer === "NO", truthPast);

const suggestion = suggestSystemNextAction({
  readiness: evaluated.readiness,
  defects: evaluated.defects,
  architectureStatus: finalArch.data.status,
  summaryPresent: Boolean(finalArch.data.summary.trim()),
  componentCount: bundleResult.data.components.length,
  proposedRecordCount: bundleResult.data.components.filter((row) => row.status === "PROPOSED").length,
});

const nextActionInsert = await raw
  .from("next_actions")
  .insert({
    project_id: projectId,
    title: suggestion?.title ?? "Begin build plan from ARCHITECTURE_READY design",
    description: suggestion?.description ?? "System design is ready; implementation is separate.",
    status: "OPEN",
    position: 1,
    priority: "HIGH",
    provenance: "FOUNDER_APPROVED_ACTION",
    source_kind: suggestion?.sourceKind ?? "system_architecture",
    source_ref: systemArchitectureId,
    requires_decision: false,
  })
  .select("id,title")
  .single();
if (nextActionInsert.error) fail("next_action", nextActionInsert.error);

const today = await raw.from("next_actions").select("id,title,status,source_kind").eq("project_id", projectId).eq("status", "OPEN");
assert("today", (today.data?.length ?? 0) >= 1, today.error || today.data);

const brain = await raw.from("project_knowledge").select("title,source,content").eq("project_id", projectId);
assert("brain_rows", (brain.data?.length ?? 0) >= 2, brain.error || brain.data);

const askItems = collectSystemArchitectureItems({
  question: "Is the system architecture ready for a build plan and is anything deployed?",
  bundle: bundleResult.data,
});
assert("ask_ghost_items", askItems.length >= 2, askItems);
assert(
  "ask_ghost_truth",
  askItems.some((item) => item.type === "truth_boundary" && /YES/i.test(item.content)),
  askItems,
);

const stranger = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const leaked = await stranger.from("system_architectures").select("id").eq("id", systemArchitectureId);
assert("rls_anon_blocked", (leaked.data?.length ?? 0) === 0, leaked);

const illegal = await raw.rpc("record_system_architecture_transition", {
  target_architecture_id: systemArchitectureId,
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
      productArchitectureId,
      systemArchitectureId,
      requirementId,
      status: finalArch.data.status,
      productStatus: bundleResult.data.productStatus,
      blockerCountInitial: "verified",
      readiness: evaluated.readiness.architectureReady,
      todayCount: today.data?.length ?? 0,
      askGhostItemTypes: askItems.map((item) => item.type),
      chain:
        "BUILD_READY Product → System Architecture → Components/Entities/Auth/Interface/Flow/Integration/Risk/Coverage → ARCHITECTURE_READY → Today → Brain → Ask Ghost",
    },
    null,
    2,
  ),
);

await admin.from("projects").delete().eq("id", projectId);
await admin.from("ideas").delete().eq("id", ideaId);
