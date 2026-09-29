"use server";

import { revalidatePath } from "next/cache";
import { getModelProvider } from "@/lib/ai/provider";
import { prepareReply } from "@/lib/ai/reply";
import type { ConversationTurn } from "@/lib/ai/types";
import type { ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth/session";
import { assembleGlobalContext, assembleProjectContext } from "@/lib/brain/context";
import { isSupportedVerified } from "@/lib/brain/verification";
import { reuseUnansweredUserMessage } from "@/lib/conversation/idempotency";
import { groundingMetadata, withSources } from "@/lib/conversation/queries";
import { collectGlobalItems, collectProjectItems, selectGrounding } from "@/lib/ghost-context/assemble";
import { detectMemoryIntent } from "@/lib/ghost-context/memory-intent";
import { resolveAuthorizedProject } from "@/lib/ghost-context/resolve";
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
  question: string,
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

  const ghost = assembleProjectContext({
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

  return {
    ghost,
    projectName: project.data.name,
    productionVerified: verification.data.some(
      (record) => record.category === "PRODUCTION" && isSupportedVerified(record),
    ),
    items: collectProjectItems({
      question,
      project: {
        id: project.data.id,
        name: project.data.name,
        description: project.data.description,
        status: project.data.status,
        currentMilestone: project.data.currentMilestone,
      },
      knowledge: knowledge.data.map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        content: item.content,
      })),
      blockers: blockers.data.map((blocker) => ({
        id: blocker.id,
        title: blocker.title,
        description: blocker.description,
        status: blocker.status,
      })),
      nextActions: actions.data.map((action) => ({
        id: action.id,
        title: action.title,
        description: action.description,
        status: action.status,
        position: action.position,
      })),
      verification: verification.data.map((record) => ({
        id: record.id,
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
    }),
  };
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

  const resolution = resolveAuthorizedProject({
    message,
    lockedProjectId: visibleProjectId,
    projects: summaries.data.map((project) => ({ id: project.id, name: project.name })),
  });

  if (resolution.kind === "ambiguous") {
    return {
      error: null,
      notice: `More than one project matches that name: ${resolution.names.join(", ")}. Open the project and ask from its page.`,
    };
  }

  if (resolution.kind === "unknown") {
    return {
      error: null,
      notice: `Ghost does not have an authorized Project Brain for ${resolution.name}.`,
    };
  }

  const contextProjectId = resolution.kind === "global" ? null : resolution.id;
  const loaded = contextProjectId ? await projectContext(session, contextProjectId, message) : null;
  if (contextProjectId && !loaded) {
    return { error: "Ghost could not read that project's records.", notice: null };
  }

  const context = loaded
    ? loaded.ghost
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

  const contextItems = loaded
    ? loaded.items
    : collectGlobalItems({
        question: message,
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
  const projectName = loaded?.projectName ?? null;

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
    .select("id, role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (history.error) {
    return { error: history.error.message, notice: null };
  }

  const turns: ConversationTurn[] = history.data.flatMap((turn) =>
    turn.role === "user" || turn.role === "assistant" ? [{ role: turn.role, content: turn.content }] : [],
  );
  const retryingFailedRequest = reuseUnansweredUserMessage(turns, message);
  let userMessageId = retryingFailedRequest ? history.data.at(-1)?.id ?? "" : "";

  if (!retryingFailedRequest) {
    const storedUser = await session.supabase
      .from("ghost_messages")
      .insert({
        conversation_id: conversationId,
        role: "user",
        content: message,
      })
      .select("id")
      .single();

    if (storedUser.error || !storedUser.data) {
      return { error: storedUser.error?.message ?? "The message was not saved.", notice: null };
    }

    userMessageId = storedUser.data.id;
    turns.push({ role: "user", content: message });
  }

  const memory = detectMemoryIntent(message, projectName);
  if (memory.kind === "ask-scope") {
    const storedAssistant = await session.supabase.from("ghost_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content:
        "Should this apply to every project, or only this one? I did not save a proposal, and I did not create an active rule.",
    });
    if (storedAssistant.error) {
      return { error: storedAssistant.error.message, notice: null };
    }
    revalidatePath("/dashboard");
    if (requestedProjectId) {
      revalidatePath(`/projects/${requestedProjectId}`);
    }
    return { error: null, notice: null };
  }

  if (memory.kind === "propose") {
    if (memory.scope === "PROJECT_KNOWLEDGE" && !contextProjectId) {
      return {
        error: null,
        notice: "Name the project this should apply to. I did not save a proposal.",
      };
    }

    const proposal = await session.supabase
      .from("memory_proposals")
      .insert({
        owner_id: session.user.id,
        project_id: memory.scope === "PROJECT_KNOWLEDGE" ? contextProjectId : null,
        proposed_scope: memory.scope,
        title: memory.content.slice(0, 80),
        content: memory.content,
        provenance: `conversation ${conversationId}; message ${userMessageId}; project ${contextProjectId ?? "none"}`,
        status: "PENDING",
      })
      .select("id")
      .single();

    if (proposal.error || !proposal.data) {
      return { error: proposal.error?.message ?? "The proposal was not saved.", notice: null };
    }

    const confirmation =
      memory.scope === "FOUNDER_RULE"
        ? "I saved a pending founder-rule proposal. It is not active until you approve it."
        : "I saved a pending project-knowledge proposal. It is not an active founder rule.";
    const storedAssistant = await session.supabase.from("ghost_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: withSources(confirmation, [
        { id: proposal.data.id, type: "memory_proposal", title: memory.content.slice(0, 80) },
      ]),
    });
    if (storedAssistant.error) {
      return { error: storedAssistant.error.message, notice: null };
    }
    revalidatePath("/memory");
    revalidatePath("/dashboard");
    if (requestedProjectId) {
      revalidatePath(`/projects/${requestedProjectId}`);
    }
    return { error: null, notice: null };
  }

  const grounding = selectGrounding({
    items: contextItems,
    messages: turns,
    projectId: contextProjectId,
    productionVerified: loaded?.productionVerified ?? false,
  });

  let reply: Awaited<ReturnType<typeof prepareReply>>;
  try {
    reply = await prepareReply({
      requestedProjectId: contextProjectId,
      visibleProjectId: contextProjectId,
      context,
      grounding: grounding.data,
      messages: grounding.messages.flatMap((turn) =>
        turn.role === "user" || turn.role === "assistant" ? [{ role: turn.role, content: turn.content }] : [],
      ),
      provider: getModelProvider(),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The model provider failed.";
    const notice = detail.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 500);
    console.info("ghost.model.failure", { notice });
    return {
      error: null,
      notice,
    };
  }

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

  if (reply.usage) {
    console.info("ghost.model.usage", {
      provider: reply.provider,
      model: reply.model,
      ...reply.usage,
    });
  }

  const storedAssistant = await session.supabase.from("ghost_messages").insert({
    conversation_id: conversationId,
    role: "assistant",
    content: withSources(reply.content, grounding.sources),
    metadata: groundingMetadata({
      provider: reply.provider,
      model: reply.model,
      projectId: contextProjectId,
      contextItemCount: grounding.count,
      sources: grounding.sources,
      usage: reply.usage,
    }),
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
