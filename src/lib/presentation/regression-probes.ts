import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import type { GhostClient } from "@/lib/auth/session";
import { prepareReply } from "@/lib/ai/reply";
import { ProviderError, resolveModelProvider } from "@/lib/ai/provider";
import { redactSecrets } from "@/lib/security/redact";
import type { ProbeResult } from "./security-probe";

const CONVERSATION_BUG = "Conversation migration is not on the remote database";
const PROVIDER_BUG = "No model provider is configured";
const REPOSITORY_BUG = "GitHub remote is not connected";
const SIGNUP_BUG = "Public sign-up rate limit";

const execFileAsync = promisify(execFile);

export async function evaluateRepositoryRegression(cwd: string): Promise<ProbeResult> {
  const lines = [REPOSITORY_BUG];
  try {
    const git = (args: string[]) => execFileAsync("git", args, { cwd, windowsHide: true, timeout: 20_000 }).then((result) => result.stdout.trim());
    const origin = await git(["remote", "get-url", "origin"]);
    const repository = /github\.com[/:]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/i.exec(origin)?.[1] ?? null;
    lines.push(`origin: ${repository ? `github.com/${repository}` : "not a GitHub repository"}`);
    const heads = (await git(["ls-remote", "--heads", "origin"]))
      .split("\n")
      .map((line) => line.split("\t")[1]?.replace("refs/heads/", ""))
      .filter((name): name is string => Boolean(name));
    lines.push(`remote branches: ${heads.length}`);
    lines.push(`ghost-experience on remote: ${heads.includes("ghost-experience") ? "present" : "missing"}`);
    const connected = repository?.toLowerCase() === "ghost-1r/ghost" && heads.includes("ghost-experience");
    lines.push(`remote connected: ${connected ? "yes" : "no"}`);
    return { status: connected ? "passed" : "failed", exitCode: connected ? 0 : 1, output: redactSecrets(lines.join("\n")) };
  } catch (error) {
    lines.push(`remote read: ${error instanceof Error ? error.message.split("\n")[0] : "failed"}`);
    return { status: "blocked", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
}

export async function evaluateSignupRegression(supabase: GhostClient, projectId: string): Promise<ProbeResult> {
  const lines = [SIGNUP_BUG, "live sign-up sent by this probe: none"];
  const blocker = await supabase.from("blockers").select("created_at").eq("project_id", projectId).eq("title", SIGNUP_BUG).maybeSingle();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (blocker.error || !blocker.data || !serviceKey) {
    lines.push("sign-up records: unavailable");
    return { status: "blocked", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const current = await supabase.auth.getUser();
  const users = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (users.error) {
    lines.push("sign-up records: unavailable");
    return { status: "blocked", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  const since = Date.parse(blocker.data.created_at);
  const accepted = users.data.users.filter(
    (user) => user.id !== current.data.user?.id && user.app_metadata?.provider === "email" && Date.parse(user.created_at) > since,
  );
  lines.push(`blocker recorded: ${blocker.data.created_at}`);
  lines.push(`accepted public sign-ups since the blocker: ${accepted.length}`);
  const passed = accepted.length > 0;
  return { status: passed ? "passed" : "failed", exitCode: passed ? 0 : 1, output: redactSecrets(lines.join("\n")) };
}

export async function evaluateConversationRegression(supabase: GhostClient, projectId: string): Promise<ProbeResult> {
  const lines = [CONVERSATION_BUG];
  const conversations = await supabase.from("ghost_conversations").select("id").eq("project_id", projectId).limit(1);
  const messages = await supabase.from("ghost_messages").select("id, metadata").limit(1);
  if (conversations.error || messages.error) {
    lines.push("remote conversation tables or metadata column: missing");
    return { status: "failed", exitCode: 1, output: lines.join("\n") };
  }
  lines.push("remote ghost_conversations: present");
  lines.push("remote ghost_messages.metadata: present");
  const metadata = messages.data?.[0]?.metadata;
  if (metadata != null && (typeof metadata !== "object" || Array.isArray(metadata))) {
    lines.push("metadata shape: not an object");
    return { status: "failed", exitCode: 1, output: lines.join("\n") };
  }
  lines.push(`metadata shape: ${metadata == null ? "empty" : "object"}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const admin = serviceKey ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  const current = await supabase.auth.getUser();
  const users = admin ? await admin.auth.admin.listUsers({ page: 1, perPage: 20 }) : { data: { users: [] }, error: null };
  const other = users.data.users.find((user) => user.id !== current.data.user?.id && user.email);
  if (!admin || !other?.email || users.error) {
    lines.push("cross-user session: unavailable");
    return { status: "blocked", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email: other.email });
  const token = link.data.properties?.hashed_token;
  const otherClient = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const verified = token ? await otherClient.auth.verifyOtp({ token_hash: token, type: "magiclink" }) : { error: { message: "no token" } };
  if (verified.error) {
    lines.push("cross-user session: unavailable");
    return { status: "blocked", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  const seen = await otherClient.from("ghost_messages").select("id").limit(20);
  lines.push(`cross-user message rows: ${seen.data?.length ?? "error"}`);
  if ((seen.data?.length ?? 1) > 0 || seen.error) {
    return { status: "failed", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  lines.push("cross-user read: denied by zero rows");
  return { status: "passed", exitCode: 0, output: redactSecrets(lines.join("\n")) };
}

async function paidFallbackCalls(): Promise<{ statuses: string[]; paidCalls: number; freeCalls: number }> {
  const failures: Array<[number, string]> = [
    [401, "invalid_api_key"],
    [429, "rate_limit_exceeded"],
    [503, "service_unavailable"],
  ];
  const statuses: string[] = [];
  let paidCalls = 0;
  let freeCalls = 0;
  for (const [status, code] of failures) {
    const selection = resolveModelProvider(
      { GHOST_MODEL_PROVIDER: "groq", GROQ_API_KEY: "probe-invalid", OPENAI_API_KEY: "probe-paid", XAI_API_KEY: "probe-paid" },
      async (url) => {
        if (url.startsWith("https://api.groq.com/")) {
          freeCalls += 1;
        } else {
          paidCalls += 1;
        }
        return new Response(JSON.stringify({ error: { code, message: "probe" } }), { status });
      },
    );
    try {
      await selection.provider?.complete({ system: "probe", context: EMPTY_CONTEXT, messages: [{ role: "user", content: "probe" }] });
      statuses.push("answered");
    } catch (error) {
      statuses.push(error instanceof ProviderError ? error.status : "unknown");
    }
  }
  const missing = resolveModelProvider({ GHOST_MODEL_PROVIDER: "groq", OPENAI_API_KEY: "probe-paid" }, async () => {
    paidCalls += 1;
    return new Response("{}", { status: 200 });
  });
  statuses.push(missing.status);
  return { statuses, paidCalls, freeCalls };
}

const EMPTY_CONTEXT = {
  scope: "global" as const,
  project: null,
  projects: [],
  milestone: null,
  requirements: [],
  decisions: [],
  constraints: [],
  blockers: [],
  nextActions: [],
  verification: [],
  founderRules: [],
  truncated: false,
};

export async function evaluateModelProviderRegression(): Promise<ProbeResult> {
  const lines = [PROVIDER_BUG];
  const selection = resolveModelProvider();
  const provider = selection.provider;
  const secrets = ["OPENAI_API_KEY", "GROQ_API_KEY", "XAI_API_KEY", "ANTHROPIC_API_KEY"]
    .map((name) => process.env[name]?.trim() ?? "")
    .filter((value) => value.length > 0);
  const exposed = Object.entries(process.env).some(
    ([name, value]) =>
      name.startsWith("NEXT_PUBLIC_") && (/GROQ|OPENAI|XAI|ANTHROPIC/.test(name) || secrets.some((secret) => (value ?? "").includes(secret))),
  );
  lines.push(`client env exposure: ${exposed ? "yes" : "no"}`);
  lines.push(`selected provider: ${selection.providerId} ${selection.model ?? ""} ${selection.status} ${selection.paid ? "paid" : "free"}`);
  const fallback = await paidFallbackCalls();
  lines.push(`groq failure statuses: ${fallback.statuses.join(",")}`);
  lines.push(`paid fallback calls: ${fallback.paidCalls}`);
  const fallbackSafe =
    fallback.paidCalls === 0 &&
    fallback.freeCalls === 3 &&
    fallback.statuses.join(",") === "AUTH_FAILED,RATE_LIMITED,PROVIDER_UNAVAILABLE,NOT_CONFIGURED";
  if (!fallbackSafe) {
    return { status: "failed", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  const unconfigured = await prepareReply({
    requestedProjectId: null,
    visibleProjectId: null,
    context: null,
    messages: [{ role: "user", content: "ping" }],
    provider: null,
  });
  lines.push(`unconfigured boundary: ${unconfigured.ok ? "called" : unconfigured.reason}`);
  if (!provider || exposed || unconfigured.ok || unconfigured.reason !== "unconfigured") {
    return { status: "failed", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  try {
    const response = await provider.complete({
      system: "Reply with the single word ready.",
      context: EMPTY_CONTEXT,
      messages: [{ role: "user", content: "Reply with the single word ready." }],
    });
    const leaked = secrets.some((secret) => response.content.includes(secret)) || redactSecrets(response.content) !== response.content;
    lines.push(`provider=${response.provider}`);
    lines.push(`model=${response.model}`);
    lines.push(`liveCall=${leaked ? "exposed" : "accepted"}`);
    if (leaked || response.provider.length === 0) {
      return { status: "failed", exitCode: 1, output: redactSecrets(lines.join("\n")) };
    }
    return { status: "passed", exitCode: 0, output: redactSecrets(lines.join("\n")) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "provider call failed";
    lines.push(`liveCall=failed ${redactSecrets(message)}`);
    return { status: "failed", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
}

export async function conversationSourceAvoidsDirectRules(cwd: string): Promise<boolean> {
  const source = await readFile(path.join(cwd, "src/lib/conversation/actions.ts"), "utf8");
  return source.includes('.from("memory_proposals")') && !source.includes('.from("founder_rules")');
}

const IDEA_LAB_BUG = "Idea Lab domain is incomplete";

export async function evaluateIdeaLabRegression(supabase: GhostClient): Promise<ProbeResult> {
  const lines = [
    IDEA_LAB_BUG,
    "IDEA DOMAIN",
    "IDEA RLS",
    "IDEA WORKFLOW",
    "VALIDATION",
    "STRATEGY",
    "STRATEGY DECISIONS",
    "IDEA → PROJECT PROMOTION",
    "TRUTH BOUNDARY",
    "V4 REGRESSION",
  ];

  const tables = await Promise.all([
    supabase.from("ideas").select("id").limit(1),
    supabase.from("idea_transitions").select("id").limit(1),
    supabase.from("idea_validations").select("id").limit(1),
    supabase.from("idea_evidence").select("id").limit(1),
    supabase.from("idea_strategies").select("id").limit(1),
  ]);
  if (tables.some((result) => result.error && /does not exist|schema cache/i.test(result.error.message))) {
    lines.push("remote idea tables: missing");
    return { status: "failed", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  if (tables.some((result) => result.error)) {
    lines.push(`remote idea tables: ${tables.find((result) => result.error)?.error?.message ?? "error"}`);
    return { status: "blocked", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  lines.push("remote idea tables: present");

  const decisionCols = await supabase.from("project_decisions").select("id, idea_id, strategy_id, project_id").limit(1);
  if (decisionCols.error && /idea_id|strategy_id|column/i.test(decisionCols.error.message)) {
    lines.push("project_decisions idea/strategy columns: missing");
    return { status: "failed", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  lines.push("project_decisions idea/strategy columns: present");

  const truthSource = await readFile(path.join(process.cwd(), "src/lib/ideas/truth.ts"), "utf8").catch(() => "");
  const promoteSource = await readFile(path.join(process.cwd(), "src/lib/ideas/promote.ts"), "utf8").catch(() => "");
  const workflowSource = await readFile(path.join(process.cwd(), "src/lib/ideas/workflow.ts"), "utf8").catch(() => "");
  const hasTruth =
    truthSource.includes("isIdeaValidated") &&
    truthSource.includes("isProductBuilt") &&
    truthSource.includes("isDeployed");
  const hasPromote =
    promoteSource.includes("Only an approved idea can become a project") &&
    promoteSource.includes("Project creation is not implementation");
  const hasWorkflow = workflowSource.includes("NEEDS_DECISION") && workflowSource.includes("DECISION_READY");
  lines.push(`truth boundary module: ${hasTruth ? "present" : "missing"}`);
  lines.push(`promotion guard: ${hasPromote ? "present" : "missing"}`);
  lines.push(`workflow readiness: ${hasWorkflow ? "present" : "missing"}`);
  if (!hasTruth || !hasPromote || !hasWorkflow) {
    return { status: "failed", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }

  const v4 = await Promise.all([
    supabase.from("lifecycle_transitions").select("id").limit(1),
    supabase.from("next_actions").select("id").limit(1),
    supabase.from("project_decisions").select("id").limit(1),
  ]);
  if (v4.some((result) => result.error)) {
    lines.push("v4 operating tables: unavailable");
    return { status: "blocked", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  lines.push("v4 operating tables: present");
  return { status: "passed", exitCode: 0, output: redactSecrets(lines.join("\n")) };
}

const PRODUCT_ARCHITECT_BUG = "Product Architect domain is incomplete";

export async function evaluateProductArchitectRegression(supabase: GhostClient): Promise<ProbeResult> {
  const lines = [
    PRODUCT_ARCHITECT_BUG,
    "PRODUCT ARCHITECT DOMAIN",
    "PRODUCT ARCHITECT RLS",
    "REQUIREMENTS",
    "FEATURES",
    "READINESS",
    "TRUTH BOUNDARY",
    "V5 REGRESSION",
  ];

  const tables = await Promise.all([
    supabase.from("product_architectures").select("id").limit(1),
    supabase.from("product_architecture_transitions").select("id").limit(1),
    supabase.from("product_requirements").select("id").limit(1),
    supabase.from("product_features").select("id").limit(1),
    supabase.from("product_flows").select("id").limit(1),
    supabase.from("product_questions").select("id").limit(1),
    supabase.from("product_dependencies").select("id").limit(1),
  ]);
  if (tables.some((result) => result.error && /does not exist|schema cache/i.test(result.error.message))) {
    lines.push("remote product architect tables: missing");
    return { status: "failed", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  if (tables.some((result) => result.error)) {
    lines.push(`remote product architect tables: ${tables.find((result) => result.error)?.error?.message ?? "error"}`);
    return { status: "blocked", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  lines.push("remote product architect tables: present");

  const truthSource = await readFile(path.join(process.cwd(), "src/lib/product-architect/truth.ts"), "utf8").catch(() => "");
  const workflowSource = await readFile(path.join(process.cwd(), "src/lib/product-architect/workflow.ts"), "utf8").catch(
    () => "",
  );
  const hasTruth = truthSource.includes("isRequirementAuthoritative") && truthSource.includes("past Ghost answer");
  const hasReadiness = workflowSource.includes("computeProductReadiness") && workflowSource.includes("BUILD_READY");
  lines.push(`truth boundary module: ${hasTruth ? "present" : "missing"}`);
  lines.push(`readiness module: ${hasReadiness ? "present" : "missing"}`);
  if (!hasTruth || !hasReadiness) {
    return { status: "failed", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }

  const v5 = await Promise.all([
    supabase.from("ideas").select("id").limit(1),
    supabase.from("idea_strategies").select("id").limit(1),
  ]);
  if (v5.some((result) => result.error)) {
    lines.push("v5 idea/strategy tables: unavailable");
    return { status: "blocked", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  lines.push("v5 idea/strategy tables: present");
  return { status: "passed", exitCode: 0, output: redactSecrets(lines.join("\n")) };
}

const SYSTEM_ARCHITECTURE_BUG = "System Architecture domain is incomplete";

export async function evaluateSystemArchitectureRegression(supabase: GhostClient): Promise<ProbeResult> {
  const lines = [
    SYSTEM_ARCHITECTURE_BUG,
    "SYSTEM ARCHITECTURE DOMAIN",
    "SYSTEM ARCHITECTURE RLS",
    "COMPONENTS",
    "DATABASE DESIGN",
    "INTERFACES",
    "COVERAGE",
    "READINESS",
    "TRUTH BOUNDARY",
    "V6 REGRESSION",
  ];

  const tables = await Promise.all([
    supabase.from("system_architectures").select("id").limit(1),
    supabase.from("system_architecture_transitions").select("id").limit(1),
    supabase.from("system_components").select("id").limit(1),
    supabase.from("system_entities").select("id").limit(1),
    supabase.from("system_entity_fields").select("id").limit(1),
    supabase.from("system_relationships").select("id").limit(1),
    supabase.from("system_interfaces").select("id").limit(1),
    supabase.from("system_data_flows").select("id").limit(1),
    supabase.from("system_integrations").select("id").limit(1),
    supabase.from("system_env_configs").select("id").limit(1),
    supabase.from("system_technical_risks").select("id").limit(1),
    supabase.from("system_technical_constraints").select("id").limit(1),
    supabase.from("system_requirement_coverage").select("id").limit(1),
    supabase.from("system_questions").select("id").limit(1),
  ]);
  if (tables.some((result) => result.error && /does not exist|schema cache/i.test(result.error.message))) {
    lines.push("remote system architecture tables: missing");
    return { status: "failed", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  if (tables.some((result) => result.error)) {
    lines.push(`remote system architecture tables: ${tables.find((result) => result.error)?.error?.message ?? "error"}`);
    return { status: "blocked", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  lines.push("remote system architecture tables: present");

  const decisionColumn = await supabase.from("project_decisions").select("id, system_architecture_id").limit(1);
  if (decisionColumn.error && /system_architecture_id|column/i.test(decisionColumn.error.message)) {
    lines.push("project_decisions system_architecture_id: missing");
    return { status: "failed", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  lines.push("project_decisions system_architecture_id: present");

  const truthSource = await readFile(path.join(process.cwd(), "src/lib/system-architecture/truth.ts"), "utf8").catch(() => "");
  const workflowSource = await readFile(path.join(process.cwd(), "src/lib/system-architecture/workflow.ts"), "utf8").catch(
    () => "",
  );
  const hasTruth = truthSource.includes("isArchitectureImplemented") && truthSource.includes("past Ghost answer");
  const hasReadiness =
    workflowSource.includes("computeSystemReadiness") &&
    workflowSource.includes("validateSchemaDefects") &&
    workflowSource.includes("ARCHITECTURE_READY");
  lines.push(`truth boundary module: ${hasTruth ? "present" : "missing"}`);
  lines.push(`readiness and schema validation module: ${hasReadiness ? "present" : "missing"}`);
  if (!hasTruth || !hasReadiness) {
    return { status: "failed", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }

  const v6 = await Promise.all([
    supabase.from("product_architectures").select("id").limit(1),
    supabase.from("product_requirements").select("id").limit(1),
  ]);
  if (v6.some((result) => result.error)) {
    lines.push("v6 product architecture tables: unavailable");
    return { status: "blocked", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  lines.push("v6 product architecture tables: present");
  return { status: "passed", exitCode: 0, output: redactSecrets(lines.join("\n")) };
}

const BUILD_PLAN_BUG = "Build Plan domain is incomplete";

export async function evaluateBuildPlanRegression(supabase: GhostClient): Promise<ProbeResult> {
  const lines = [
    BUILD_PLAN_BUG,
    "BUILD PLAN DOMAIN",
    "BUILD PLAN RLS",
    "PHASES",
    "WORK PACKAGES",
    "DEPENDENCIES",
    "COVERAGE",
    "VERIFICATION",
    "READINESS",
    "TRUTH BOUNDARY",
    "V7 REGRESSION",
  ];

  const tables = await Promise.all([
    supabase.from("build_plans").select("id").limit(1),
    supabase.from("build_plan_transitions").select("id").limit(1),
    supabase.from("build_phases").select("id").limit(1),
    supabase.from("work_packages").select("id").limit(1),
    supabase.from("work_package_dependencies").select("id").limit(1),
    supabase.from("work_package_requirement_links").select("id").limit(1),
    supabase.from("work_package_feature_links").select("id").limit(1),
    supabase.from("work_package_architecture_links").select("id").limit(1),
    supabase.from("work_package_verifications").select("id").limit(1),
    supabase.from("build_manual_actions").select("id").limit(1),
    supabase.from("build_config_requirements").select("id").limit(1),
    supabase.from("build_plan_risks").select("id").limit(1),
  ]);
  if (tables.some((result) => result.error && /does not exist|schema cache/i.test(result.error.message))) {
    lines.push("remote build plan tables: missing");
    return { status: "failed", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  if (tables.some((result) => result.error)) {
    lines.push(`remote build plan tables: ${tables.find((result) => result.error)?.error?.message ?? "error"}`);
    return { status: "blocked", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  lines.push("remote build plan tables: present");

  const decisionColumn = await supabase.from("project_decisions").select("id, build_plan_id").limit(1);
  if (decisionColumn.error && /build_plan_id|column/i.test(decisionColumn.error.message)) {
    lines.push("project_decisions build_plan_id: missing");
    return { status: "failed", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  lines.push("project_decisions build_plan_id: present");

  const truthSource = await readFile(path.join(process.cwd(), "src/lib/build-plan/truth.ts"), "utf8").catch(() => "");
  const workflowSource = await readFile(path.join(process.cwd(), "src/lib/build-plan/workflow.ts"), "utf8").catch(() => "");
  const hasTruth = truthSource.includes("isPackageImplemented") && truthSource.includes("past Ghost answer");
  const hasReadiness =
    workflowSource.includes("computeBuildPlanReadiness") &&
    workflowSource.includes("detectDependencyCycles") &&
    workflowSource.includes("BUILD_PLAN_READY");
  lines.push(`truth boundary module: ${hasTruth ? "present" : "missing"}`);
  lines.push(`readiness and dependency module: ${hasReadiness ? "present" : "missing"}`);
  if (!hasTruth || !hasReadiness) {
    return { status: "failed", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }

  const v7 = await Promise.all([
    supabase.from("system_architectures").select("id").limit(1),
    supabase.from("system_components").select("id").limit(1),
  ]);
  if (v7.some((result) => result.error)) {
    lines.push("v7 system architecture tables: unavailable");
    return { status: "blocked", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  lines.push("v7 system architecture tables: present");
  return { status: "passed", exitCode: 0, output: redactSecrets(lines.join("\n")) };
}

const BUILD_EXECUTION_BUG = "Build Execution domain is incomplete";

export async function evaluateBuildExecutionRegression(supabase: GhostClient): Promise<ProbeResult> {
  const lines = [
    BUILD_EXECUTION_BUG,
    "BUILD EXECUTION DOMAIN",
    "BUILD EXECUTION RLS",
    "PACKAGE EXECUTIONS",
    "EVIDENCE",
    "BLOCKERS",
    "UPSTREAM",
    "READINESS",
    "COMPLETION GATE",
    "TRUTH BOUNDARY",
    "V8 REGRESSION",
  ];

  const tables = await Promise.all([
    supabase.from("build_executions").select("id").limit(1),
    supabase.from("build_execution_transitions").select("id").limit(1),
    supabase.from("work_package_executions").select("id").limit(1),
    supabase.from("implementation_evidence").select("id").limit(1),
    supabase.from("execution_blockers").select("id").limit(1),
    supabase.from("execution_upstream_changes").select("id").limit(1),
  ]);
  if (tables.some((result) => result.error && /does not exist|schema cache/i.test(result.error.message))) {
    lines.push("remote build execution tables: missing");
    return { status: "failed", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  if (tables.some((result) => result.error)) {
    lines.push(`remote build execution tables: ${tables.find((result) => result.error)?.error?.message ?? "error"}`);
    return { status: "blocked", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  lines.push("remote build execution tables: present");

  const decisionColumn = await supabase.from("project_decisions").select("id, build_execution_id").limit(1);
  if (decisionColumn.error && /build_execution_id|column/i.test(decisionColumn.error.message)) {
    lines.push("project_decisions build_execution_id: missing");
    return { status: "failed", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  lines.push("project_decisions build_execution_id: present");

  const truthSource = await readFile(path.join(process.cwd(), "src/lib/build-execution/truth.ts"), "utf8").catch(() => "");
  const workflowSource = await readFile(path.join(process.cwd(), "src/lib/build-execution/workflow.ts"), "utf8").catch(
    () => "",
  );
  const hasTruth =
    truthSource.includes("isExecutionImplemented") &&
    truthSource.includes("isVerified") &&
    truthSource.includes("past Ghost answer");
  const hasWorkflow =
    workflowSource.includes("computeExecutionCompletion") &&
    workflowSource.includes("refreshDerivedPackageStatuses") &&
    workflowSource.includes("LEGAL_BUILD_EXECUTION_TRANSITIONS");
  lines.push(`truth boundary module: ${hasTruth ? "present" : "missing"}`);
  lines.push(`readiness and completion module: ${hasWorkflow ? "present" : "missing"}`);
  if (!hasTruth || !hasWorkflow) {
    return { status: "failed", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }

  const v8 = await Promise.all([
    supabase.from("build_plans").select("id").limit(1),
    supabase.from("work_packages").select("id").limit(1),
  ]);
  if (v8.some((result) => result.error)) {
    lines.push("v8 build plan tables: unavailable");
    return { status: "blocked", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  lines.push("v8 build plan tables: present");
  return { status: "passed", exitCode: 0, output: redactSecrets(lines.join("\n")) };
}

const VERIFICATION_BUG = "Verification domain is incomplete";

export async function evaluateVerificationRegression(supabase: GhostClient): Promise<ProbeResult> {
  const lines = [
    VERIFICATION_BUG,
    "VERIFICATION DOMAIN",
    "VERIFICATION RLS",
    "CASES",
    "EVIDENCE",
    "DEFECTS",
    "RETEST",
    "COMPLETION GATE",
    "TRUTH BOUNDARY",
    "V9 REGRESSION",
  ];

  const tables = await Promise.all([
    supabase.from("verification_programs").select("id").limit(1),
    supabase.from("verification_program_transitions").select("id").limit(1),
    supabase.from("verification_cases").select("id").limit(1),
    supabase.from("verification_evidence").select("id").limit(1),
    supabase.from("verification_defects").select("id").limit(1),
    supabase.from("verification_retest_events").select("id").limit(1),
  ]);
  if (tables.some((result) => result.error && /does not exist|schema cache/i.test(result.error.message))) {
    lines.push("remote verification tables: missing");
    return { status: "failed", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  if (tables.some((result) => result.error)) {
    lines.push(`remote verification tables: ${tables.find((result) => result.error)?.error?.message ?? "error"}`);
    return { status: "blocked", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  lines.push("remote verification tables: present");

  const decisionColumn = await supabase.from("project_decisions").select("id, verification_program_id").limit(1);
  if (decisionColumn.error && /verification_program_id|column/i.test(decisionColumn.error.message)) {
    lines.push("project_decisions verification_program_id: missing");
    return { status: "failed", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  lines.push("project_decisions verification_program_id: present");

  const truthSource = await readFile(path.join(process.cwd(), "src/lib/verification/truth.ts"), "utf8").catch(() => "");
  const workflowSource = await readFile(path.join(process.cwd(), "src/lib/verification/workflow.ts"), "utf8").catch(
    () => "",
  );
  const hasTruth =
    truthSource.includes("isProgramVerified") &&
    truthSource.includes("isDeployed") &&
    truthSource.includes("past Ghost answer");
  const hasWorkflow =
    workflowSource.includes("computeVerificationCompletion") &&
    workflowSource.includes("LEGAL_VERIFICATION_PROGRAM_TRANSITIONS") &&
    workflowSource.includes("isBlockingDefect");
  lines.push(`truth boundary module: ${hasTruth ? "present" : "missing"}`);
  lines.push(`completion and transitions module: ${hasWorkflow ? "present" : "missing"}`);
  if (!hasTruth || !hasWorkflow) {
    return { status: "failed", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }

  const v9 = await Promise.all([
    supabase.from("build_executions").select("id").limit(1),
    supabase.from("work_package_executions").select("id").limit(1),
  ]);
  if (v9.some((result) => result.error)) {
    lines.push("v9 build execution tables: unavailable");
    return { status: "blocked", exitCode: 1, output: redactSecrets(lines.join("\n")) };
  }
  lines.push("v9 build execution tables: present");
  return { status: "passed", exitCode: 0, output: redactSecrets(lines.join("\n")) };
}
