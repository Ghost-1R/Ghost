import { isSupportedVerified } from "@/lib/brain/verification";
import { memoryRelations } from "@/lib/memory/intelligence";
import { applyBudget, boundConversation } from "./budget";
import { claimItems, conflictItems } from "./claims";
import { publicContext, sourceRefs } from "./provenance";
import { relevanceScore } from "./select";
import type { ContextItem, SourceRef } from "./types";

type Knowledge = { id: string; kind: string; title: string; content: string };
type Blocker = { id: string; title: string; description: string; status: string };
type Action = { id: string; title: string; description: string; status: string; position: number };
type Verification = {
  id: string;
  category: string;
  target: string;
  state: string;
  evidence: unknown;
  checkedAt: string | null;
};
type Rule = { id: string; title: string; content: string; status: string };
type Project = { id: string; name: string; description: string; status: string; currentMilestone: string };

function item(partial: Omit<ContextItem, "relevance"> & { question: string }): ContextItem {
  return {
    ...partial,
    relevance: partial.keep ? 1 : relevanceScore(partial.question, partial.title, partial.content),
  };
}

export function collectProjectItems(input: {
  question: string;
  project: Project;
  knowledge: Knowledge[];
  blockers: Blocker[];
  nextActions: Action[];
  verification: Verification[];
  founderRules: Rule[];
}): ContextItem[] {
  const question = input.question;
  const projectId = input.project.id;
  const items: ContextItem[] = [
    item({
      question,
      id: `project-${projectId}`,
      type: "project",
      authority: "PROJECT_STATE",
      sourceTable: "projects",
      sourceId: projectId,
      projectId,
      title: input.project.name,
      content: input.project.description,
      status: input.project.status,
      keep: true,
      selectedBecause: "Project identity is always included.",
    }),
    item({
      question,
      id: `milestone-${projectId}`,
      type: "milestone",
      authority: "PROJECT_STATE",
      sourceTable: "projects",
      sourceId: projectId,
      projectId,
      title: "Current milestone",
      content: input.project.currentMilestone,
      status: input.project.status,
      keep: true,
      selectedBecause: "Current milestone is always included.",
    }),
  ];

  for (const blocker of input.blockers.filter((entry) => entry.status === "OPEN")) {
    items.push(
      item({
        question,
        id: blocker.id,
        type: "blocker",
        authority: "PROJECT_STATE",
        sourceTable: "blockers",
        sourceId: blocker.id,
        projectId,
        title: blocker.title,
        content: blocker.description,
        status: blocker.status,
        keep: true,
        selectedBecause: "Open blockers are always included.",
      }),
    );
  }

  for (const action of input.nextActions
    .filter((entry) => entry.status === "OPEN")
    .sort((left, right) => left.position - right.position)) {
    items.push(
      item({
        question,
        id: action.id,
        type: "next_action",
        authority: "PROJECT_STATE",
        sourceTable: "next_actions",
        sourceId: action.id,
        projectId,
        title: action.title,
        content: action.description,
        status: action.status,
        keep: true,
        selectedBecause: "Open next actions are always included.",
      }),
    );
  }

  for (const record of input.verification) {
    const supported = isSupportedVerified(record);
    items.push(
      item({
        question,
        id: record.id,
        type: "verification",
        authority: supported ? "VERIFIED_EVIDENCE" : "PROJECT_STATE",
        sourceTable: "verification_records",
        sourceId: record.id,
        projectId,
        title: record.target,
        content: `${record.category}: ${supported ? "VERIFIED" : record.state}. Supported only when evidence and a check time exist.`,
        status: supported ? "VERIFIED" : record.state,
        keep: true,
        selectedBecause: supported
          ? "Supported verification is always included."
          : "Unverified records stay visible and are not promoted.",
      }),
    );
  }

  for (const knowledge of input.knowledge) {
    const authority =
      knowledge.kind === "DECISION"
        ? "PROJECT_DECISION"
        : knowledge.kind === "FACT" || knowledge.kind === "LESSON"
          ? "PROJECT_NOTE"
          : "PROJECT_REQUIREMENT";
    const scored = item({
      question,
      id: knowledge.id,
      type: knowledge.kind.toLocaleLowerCase(),
      authority,
      sourceTable: "project_knowledge",
      sourceId: knowledge.id,
      projectId,
      title: knowledge.title,
      content: knowledge.content,
      status: knowledge.kind,
      keep: false,
      selectedBecause: "Selected because it shares terms with the question.",
    });
    if (scored.relevance > 0) {
      items.push(scored);
    }
  }

  for (const rule of input.founderRules.filter((entry) => entry.status === "ACTIVE")) {
    const scored = item({
      question,
      id: rule.id,
      type: "founder_rule",
      authority: "FOUNDER_RULE",
      sourceTable: "founder_rules",
      sourceId: rule.id,
      projectId,
      title: rule.title,
      content: rule.content,
      status: rule.status,
      keep: false,
      selectedBecause: "Selected because the active rule shares terms with the question.",
    });
    if (scored.relevance > 0) {
      items.push(scored);
    }
  }

  return [...items, ...memoryRelations(items)];
}

export function collectGlobalItems(input: {
  question: string;
  projects: Array<{
    id: string;
    name: string;
    status: string;
    currentMilestone: string;
    openBlockers: number;
    nextAction: string | null;
  }>;
  founderRules: Rule[];
}): ContextItem[] {
  const items: ContextItem[] = input.projects.map((project) => ({
    id: project.id,
    type: "project_summary",
    authority: "PROJECT_STATE" as const,
    sourceTable: "projects",
    sourceId: project.id,
    projectId: project.id,
    title: project.name,
    content: `${project.currentMilestone}. Open blockers: ${project.openBlockers}. Next action: ${project.nextAction ?? "none"}.`,
    status: project.status,
    relevance: 1,
    keep: true,
    selectedBecause: "Global context includes project summaries, not detailed knowledge.",
  }));

  for (const rule of input.founderRules.filter((entry) => entry.status === "ACTIVE")) {
    const relevance = relevanceScore(input.question, rule.title, rule.content);
    if (relevance === 0) {
      continue;
    }
    items.push({
      id: rule.id,
      type: "founder_rule",
      authority: "FOUNDER_RULE",
      sourceTable: "founder_rules",
      sourceId: rule.id,
      projectId: null,
      title: rule.title,
      content: rule.content,
      status: rule.status,
      relevance,
      keep: false,
      selectedBecause: "Selected because the active rule shares terms with the question.",
    });
  }

  return [...items, ...memoryRelations(items)];
}

export function selectGrounding(input: {
  items: ContextItem[];
  messages: Array<{ role: string; content: string }>;
  projectId: string | null;
  productionVerified: boolean;
}): { data: string; sources: SourceRef[]; count: number; messages: Array<{ role: "user" | "assistant"; content: string }> } {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const message of boundConversation(input.messages)) {
    if (message.role === "user" || message.role === "assistant") {
      messages.push({ role: message.role, content: message.content });
    }
  }
  const selected = applyBudget([
    ...input.items,
    ...claimItems(messages, input.projectId),
    ...conflictItems({
      messages,
      productionVerified: input.productionVerified,
      projectId: input.projectId,
    }),
  ]);

  return {
    data: JSON.stringify(publicContext(selected)),
    sources: sourceRefs(selected),
    count: selected.length,
    messages,
  };
}
