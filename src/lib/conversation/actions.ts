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
import { groundingMetadata, sourcesFromMetadata, withSources, type ConversationSource } from "@/lib/conversation/queries";
import { collectGlobalItems, collectProjectItems, selectGrounding } from "@/lib/ghost-context/assemble";
import type { ContextItem } from "@/lib/ghost-context/types";
import { detectMemoryIntent } from "@/lib/ghost-context/memory-intent";
import { explainInspections, inspectionContextItems, inspectionQuestion } from "@/lib/inspector/evidence";
import { explainPresentation, presentationQuestion } from "@/lib/presentation/explain";
import { listReviews, presentationRoot } from "@/lib/presentation/ledger";
import { hashWorkingTree } from "@/lib/presentation/tree";
import { defaultRuntimeRoot, listInspections } from "@/lib/inspector/store";
import { treeStamp } from "@/lib/inspector/status";
import { resolveAuthorizedProject } from "@/lib/ghost-context/resolve";
import {
  bestMemoryMatch,
  describeProvenance,
  findDuplicateMemory,
  matchActiveRules,
} from "@/lib/memory/intelligence";
import { loadFounderRules, loadMemoryProposals } from "@/lib/memory/queries";
import path from "node:path";
import { loadPatterns } from "@/lib/patterns/library";
import { repositoryContextItems } from "@/lib/repository/evidence";
import { readGitState } from "@/lib/repository/local-git";
import { captureRepositorySnapshot, missingExplicitPaths, shouldAttachRepository } from "@/lib/repository/snapshot";
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
  const supabase = session.supabase;

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
    .select("id, role, content, metadata")
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

  async function storeAssistant(content: string, sources: ConversationSource[] = []): Promise<ActionState> {
    const storedAssistant = await supabase.from("ghost_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: withSources(content, sources),
      metadata: groundingMetadata({
        provider: "ghost",
        model: "deterministic",
        projectId: contextProjectId,
        contextItemCount: sources.length,
        sources,
      }),
    });
    if (storedAssistant.error) {
      return { error: storedAssistant.error.message, notice: null };
    }
    revalidatePath("/dashboard");
    revalidatePath("/memory");
    if (requestedProjectId) {
      revalidatePath(`/projects/${requestedProjectId}`);
    }
    return { error: null, notice: null };
  }

  const memory = detectMemoryIntent(message, projectName);
  const activeRules = rules.data.filter((rule) => rule.status === "ACTIVE");

  if (memory.kind === "where") {
    const match = bestMemoryMatch(memory.content, activeRules);
    const text = match
      ? `${match.title}: ${match.content} ${describeProvenance(match.provenance ?? "").text}`
      : "I do not have an active founder rule that matches that question. I will not invent a source conversation.";
    return storeAssistant(text, match ? [{ id: match.id, type: "founder_rule", title: match.title }] : []);
  }

  if (memory.kind === "why") {
    const lastAssistant = [...history.data].reverse().find((turn) => turn.role === "assistant");
    const cited = sourcesFromMetadata(lastAssistant?.metadata).filter((source) => source.type === "founder_rule");
    if (cited.length === 0) {
      return storeAssistant("The previous answer did not record a founder rule in its sources. I will not invent one.");
    }
    const lines = cited.map((source) => {
      const rule = activeRules.find((item) => item.id === source.id);
      const provenance = describeProvenance(rule?.provenance ?? "").text;
      return `${source.title}. ${provenance}`;
    });
    return storeAssistant(`I used these founder rules: ${lines.join(" ")}`, cited);
  }

  if (memory.kind === "retire") {
    const matches = memory.target ? matchActiveRules(memory.target, activeRules) : [];
    const rule = matches.length === 1 ? matches[0] : null;
    if (!rule) {
      const text =
        matches.length === 0
          ? "I did not retire a rule. Name the active rule to retire."
          : `More than one rule matches. I did not retire any of them: ${matches.map((item) => item.title).join(", ")}.`;
      return storeAssistant(text);
    }
    const retired = await session.supabase.rpc("retire_founder_rule", { rule_id: rule.id });
    if (retired.error) {
      return { error: retired.error.message, notice: null };
    }
    return storeAssistant(
      `I retired ${rule.title}. It stays in memory history and leaves normal context. A separate retirement reason was not recorded.`,
      [{ id: rule.id, type: "founder_rule", title: rule.title }],
    );
  }

  if (memory.kind === "correct") {
    const lastAssistant = [...history.data].reverse().find((turn) => turn.role === "assistant");
    const cited = sourcesFromMetadata(lastAssistant?.metadata).filter((source) => source.type === "founder_rule");
    const rule = cited.length === 1 ? cited[0] : null;
    if (!rule) {
      return storeAssistant(
        "I did not change a rule. Name the rule and reply Retire followed by its title if you want it retired.",
      );
    }
    return storeAssistant(`I did not retire ${rule.title}. Reply: Retire ${rule.title}`, [rule]);
  }

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

    const proposals = await loadMemoryProposals(session.supabase);
    if (proposals.status === "error") {
      return { error: proposals.message, notice: null };
    }
    const duplicate = findDuplicateMemory(memory.content, [
      ...activeRules,
      ...proposals.data.filter((item) => item.status === "PENDING"),
      ...(loaded?.items
        .filter((item) => item.sourceTable === "project_knowledge")
        .map((item) => ({
          id: item.sourceId,
          title: item.title,
          content: item.content,
          status: item.status ?? undefined,
        })) ?? []),
    ]);
    if (duplicate) {
      const sourceType =
        duplicate.status === "PENDING" ? "memory_proposal" : duplicate.status === "ACTIVE" ? "founder_rule" : "project_knowledge";
      return storeAssistant(
        `An existing memory already covers that: ${duplicate.title}. I did not create another proposal or an active rule.`,
        [{ id: duplicate.id, type: sourceType, title: duplicate.title }],
      );
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

  if (presentationQuestion(message)) {
    const current = await hashWorkingTree(process.cwd());
    const reviews = await listReviews(presentationRoot(), session.user.id).catch(() => []);
    const latest = reviews.filter((review) => !contextProjectId || review.projectId === contextProjectId).at(-1) ?? null;
    const explained = explainPresentation({ review: latest, current });
    return storeAssistant(explained.text, latest ? [{ id: latest.id, type: "presentation", title: explained.title, status: latest.result }] : []);
  }

  const inspections = await listInspections(defaultRuntimeRoot(), session.user.id).catch(() => []);
  const inspectionIntent = inspectionQuestion(message);
  if (inspectionIntent) {
    const git = await readGitState(process.cwd());
    const explained = explainInspections({
      question: inspectionIntent,
      results: inspections,
      current: {
        commit: git.commit,
        workingTree: git.workingTree,
        treeStamp: treeStamp(git.commit, git.changedFiles),
      },
      verificationLines: contextItems
        .filter((item) => item.type === "verification")
        .map((item) => `${item.title}: ${item.status ?? "unknown"}`),
    });
    return storeAssistant(explained.text, explained.sources);
  }

  const repositoryItems: ContextItem[] = [];
  if (shouldAttachRepository(projectName)) {
    const missing = await missingExplicitPaths(message, process.cwd());
    if (missing.length > 0) {
      return storeAssistant(
        `Ghost cannot find that repository source: ${missing.join(", ")}. I will not invent its contents.`,
      );
    }
    const snapshot = await captureRepositorySnapshot(process.cwd(), message);
    const patterns = await loadPatterns(path.join(process.cwd(), "ghost-patterns"));
    repositoryItems.push(...repositoryContextItems(message, snapshot, patterns));
  }

  const grounding = selectGrounding({
    items: [...contextItems, ...repositoryItems, ...inspectionContextItems(message, inspections)],
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
