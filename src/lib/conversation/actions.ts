"use server";

import { revalidatePath } from "next/cache";
import { getModelProvider } from "@/lib/ai/provider";
import { prepareReply } from "@/lib/ai/reply";
import type { ConversationTurn } from "@/lib/ai/types";
import type { ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth/session";
import { assembleGlobalContext, assembleProjectContext, resolveProjectMention } from "@/lib/brain/context";
import { loadFounderRules } from "@/lib/memory/queries";
import {
  loadBlockers,
  loadKnowledge,
  loadMilestones,
  loadNextActions,
  loadProjectDetail,
  loadProjectSummaries,
  loadVerification,
} from "@/lib/projects/queries";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

async function projectContext(
  session: Extract<Awaited<ReturnType<typeof getSession>>, { status: "authenticated" }>,
  projectId: string,
) {
  const project = await loadProjectDetail(session.supabase, projectId);
  if (project.status === "error" || !project.data) {
    return null;
  }

  const [milestones, knowledge, blockers, actions, verification, rules] = await Promise.all([
    loadMilestones(session.supabase, projectId),
    loadKnowledge(session.supabase, projectId),
    loadBlockers(session.supabase, projectId),
    loadNextActions(session.supabase, projectId),
    loadVerification(session.supabase, projectId),
    loadFounderRules(session.supabase),
  ]);

  if (
    milestones.status === "error" ||
    knowledge.status === "error" ||
    blockers.status === "error" ||
    actions.status === "error" ||
    verification.status === "error" ||
    rules.status === "error"
  ) {
    return null;
  }

  return assembleProjectContext({
    project: {
      id: project.data.id,
      name: project.data.name,
      description: project.data.description,
      status: project.data.status,
      currentMilestone: project.data.currentMilestone,
      repositoryProvider: project.data.repositoryProvider,
      repositoryUrl: project.data.repositoryUrl,
      repositoryBranch: project.data.repositoryBranch,
      repositoryCommit: project.data.repositoryCommit,
    },
    milestones: milestones.data.map((milestone) => ({ title: milestone.title, status: milestone.status })),
    knowledge: knowledge.data.map((item) => ({ kind: item.kind, title: item.title, content: item.content })),
    blockers: blockers.data.map((blocker) => ({
      title: blocker.title,
      description: blocker.description,
      status: blocker.status,
    })),
    nextActions: actions.data.map((action) => ({
      title: action.title,
      description: action.description,
      status: action.status,
      position: action.position,
    })),
    verification: verification.data.map((record) => ({
      category: record.category,
      target: record.target,
      state: record.state,
      evidence: record.evidence,
      checkedAt: record.checkedAt,
    })),
    founderRules: rules.data.map((rule) => ({
      id: rule.id,
      title: rule.title,
      content: rule.content,
      status: rule.status,
    })),
  });
}

export async function sendGhostMessage(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }

  const message = readField(formData, "message");
  const requestedProjectId = readField(formData, "projectId");
  const requestedConversationId = readField(formData, "conversationId");

  if (message.length < 1 || message.length > 4000) {
    return { error: "Ask Ghost in 1 to 4000 characters.", notice: null };
  }

  if (requestedProjectId && !UUID_PATTERN.test(requestedProjectId)) {
    return { error: "That project is not visible.", notice: null };
  }

  let visibleProjectId: string | null = null;
  if (requestedProjectId) {
    const project = await loadProjectDetail(session.supabase, requestedProjectId);
    if (project.status === "error") {
      return { error: project.message, notice: null };
    }
    if (!project.data) {
      const hidden = await prepareReply({
        requestedProjectId,
        visibleProjectId: null,
        context: null,
        messages: [],
        provider: getModelProvider(),
      });
      if (!hidden.ok && hidden.reason === "not-visible") {
        return { error: "That project is not visible.", notice: null };
      }
    }
    visibleProjectId = project.status === "ok" ? project.data?.id ?? null : null;
    if (!visibleProjectId) {
      return { error: "That project is not visible.", notice: null };
    }
  }

  const rules = await loadFounderRules(session.supabase);
  const summaries = await loadProjectSummaries(session.supabase);
  if (rules.status === "error" || summaries.status === "error") {
    return { error: "Ghost could not read your project state.", notice: null };
  }

  let contextProjectId = visibleProjectId;
  if (!contextProjectId) {
    const mention = resolveProjectMention(
      message,
      summaries.data.map((project) => ({ id: project.id, name: project.name })),
    );
    if (mention.kind === "many") {
      return {
        error: null,
        notice: "More than one project matches that name. Open the project and ask from its page.",
      };
    }
    if (mention.kind === "one") {
      contextProjectId = mention.id;
    }
  }

  const context = contextProjectId
    ? await projectContext(session, contextProjectId)
    : assembleGlobalContext({
        projects: summaries.data.map((project) => ({
          id: project.id,
          name: project.name,
          status: project.status,
          currentMilestone: project.currentMilestone,
          openBlockers: project.openBlockers,
          nextAction: project.nextAction,
        })),
        founderRules: rules.data.map((rule) => ({
          id: rule.id,
          title: rule.title,
          content: rule.content,
          status: rule.status,
        })),
      });

  if (!context) {
    return { error: "Ghost could not read that project's records.", notice: null };
  }

  let conversationId = requestedConversationId;
  if (conversationId && !UUID_PATTERN.test(conversationId)) {
    return { error: "That conversation is not visible.", notice: null };
  }

  if (conversationId) {
    const existing = await session.supabase
      .from("ghost_conversations")
      .select("id, project_id")
      .eq("id", conversationId)
      .maybeSingle();

    if (existing.error || !existing.data) {
      return { error: "That conversation is not visible.", notice: null };
    }

    const sameProject =
      (existing.data.project_id ?? null) === (requestedProjectId || null);
    if (!sameProject) {
      conversationId = "";
    }
  }

  if (!conversationId) {
    const created = await session.supabase
      .from("ghost_conversations")
      .insert({
        owner_id: session.user.id,
        project_id: requestedProjectId || null,
        title: message.slice(0, 80),
      })
      .select("id")
      .single();

    if (created.error || !created.data) {
      return { error: created.error?.message ?? "The conversation was not saved.", notice: null };
    }

    conversationId = created.data.id;
  }

  const history = await session.supabase
    .from("ghost_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (history.error) {
    return { error: history.error.message, notice: null };
  }

  const storedUser = await session.supabase.from("ghost_messages").insert({
    conversation_id: conversationId,
    role: "user",
    content: message,
  });

  if (storedUser.error) {
    return { error: storedUser.error.message, notice: null };
  }

  const turns: ConversationTurn[] = history.data.flatMap((turn) =>
    turn.role === "user" || turn.role === "assistant" ? [{ role: turn.role, content: turn.content }] : [],
  );
  turns.push({ role: "user", content: message });

  const reply = await prepareReply({
    requestedProjectId: contextProjectId,
    visibleProjectId: contextProjectId,
    context,
    messages: turns,
    provider: getModelProvider(),
  });

  if (!reply.ok) {
    await session.supabase
      .from("ghost_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);
    revalidatePath("/dashboard");
    if (requestedProjectId) {
      revalidatePath(`/projects/${requestedProjectId}`);
    }
    return {
      error: null,
      notice: reply.reason === "unconfigured" ? reply.notice : "That project is not visible.",
    };
  }

  const storedAssistant = await session.supabase.from("ghost_messages").insert({
    conversation_id: conversationId,
    role: "assistant",
    content: reply.content,
  });

  if (storedAssistant.error) {
    return { error: storedAssistant.error.message, notice: null };
  }

  await session.supabase.from("ghost_conversations").update({ title: message.slice(0, 80) }).eq("id", conversationId);
  revalidatePath("/dashboard");
  if (requestedProjectId) {
    revalidatePath(`/projects/${requestedProjectId}`);
  }

  return { error: null, notice: null };
}
