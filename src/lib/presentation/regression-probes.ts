import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { GhostClient } from "@/lib/auth/session";
import { prepareReply } from "@/lib/ai/reply";
import { getModelProvider } from "@/lib/ai/provider";
import type { ProbeResult } from "./security-probe";

const CONVERSATION_BUG = "Conversation migration is not on the remote database";
const PROVIDER_BUG = "No model provider is configured";

function redact(value: string): string {
  return value
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]");
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
    return { status: "blocked", exitCode: 1, output: redact(lines.join("\n")) };
  }
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email: other.email });
  const token = link.data.properties?.hashed_token;
  const otherClient = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const verified = token ? await otherClient.auth.verifyOtp({ token_hash: token, type: "magiclink" }) : { error: { message: "no token" } };
  if (verified.error) {
    lines.push("cross-user session: unavailable");
    return { status: "blocked", exitCode: 1, output: redact(lines.join("\n")) };
  }
  const seen = await otherClient.from("ghost_messages").select("id").limit(20);
  lines.push(`cross-user message rows: ${seen.data?.length ?? "error"}`);
  if ((seen.data?.length ?? 1) > 0 || seen.error) {
    return { status: "failed", exitCode: 1, output: redact(lines.join("\n")) };
  }
  lines.push("cross-user read: denied by zero rows");
  return { status: "passed", exitCode: 0, output: redact(lines.join("\n")) };
}

export async function evaluateModelProviderRegression(): Promise<ProbeResult> {
  const lines = [PROVIDER_BUG];
  const provider = getModelProvider();
  const openAiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  const exposed = Object.entries(process.env).some(
    ([name, value]) => name.startsWith("NEXT_PUBLIC_") && Boolean(openAiKey) && (value ?? "").includes(openAiKey),
  );
  lines.push(`client env exposure: ${exposed ? "yes" : "no"}`);
  const unconfigured = await prepareReply({
    requestedProjectId: null,
    visibleProjectId: null,
    context: null,
    messages: [{ role: "user", content: "ping" }],
    provider: null,
  });
  lines.push(`unconfigured boundary: ${unconfigured.ok ? "called" : unconfigured.reason}`);
  if (!provider || exposed || unconfigured.ok || unconfigured.reason !== "unconfigured") {
    return { status: "failed", exitCode: 1, output: redact(lines.join("\n")) };
  }
  try {
    const response = await provider.complete({
      system: "Reply with the single word ready.",
      context: {
        scope: "global",
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
      },
      messages: [{ role: "user", content: "Reply with the single word ready." }],
    });
    const leaked = response.content.includes(openAiKey) || /sk-[A-Za-z0-9_-]+/.test(response.content);
    lines.push(`provider=${response.provider}`);
    lines.push(`model=${response.model}`);
    lines.push(`liveCall=${leaked ? "exposed" : "accepted"}`);
    if (leaked || response.provider.length === 0) {
      return { status: "failed", exitCode: 1, output: redact(lines.join("\n")) };
    }
    return { status: "passed", exitCode: 0, output: redact(lines.join("\n")) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "provider call failed";
    lines.push(`liveCall=failed ${redact(message)}`);
    return { status: "failed", exitCode: 1, output: redact(lines.join("\n")) };
  }
}

export async function conversationSourceAvoidsDirectRules(cwd: string): Promise<boolean> {
  const source = await readFile(path.join(cwd, "src/lib/conversation/actions.ts"), "utf8");
  return source.includes('.from("memory_proposals")') && !source.includes('.from("founder_rules")');
}
