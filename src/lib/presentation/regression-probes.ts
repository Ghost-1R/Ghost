import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { GhostClient } from "@/lib/auth/session";
import { prepareReply } from "@/lib/ai/reply";
import { ProviderError, resolveModelProvider } from "@/lib/ai/provider";
import { redactSecrets } from "@/lib/security/redact";
import type { ProbeResult } from "./security-probe";

const CONVERSATION_BUG = "Conversation migration is not on the remote database";
const PROVIDER_BUG = "No model provider is configured";

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
