import { tokens } from "@/lib/ghost-context/select";
import type { ContextItem } from "@/lib/ghost-context/types";

export const MEMORY_RISK = {
  proposalCreation: "SAFE",
  approval: "CAUTION",
  retirement: "CAUTION",
  bulkDeletion: "HIGH",
  destructiveReset: "CRITICAL",
} as const;

export type MemoryText = {
  id: string;
  title: string;
  content: string;
  status?: string;
  provenance?: string;
};

const PROVENANCE_PATTERN =
  /conversation ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}); message ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export function normalizeMemory(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/^rule-\d+\s*[—-]\s*/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sameMemory(left: string, right: string): boolean {
  const normalizedLeft = normalizeMemory(left);
  const normalizedRight = normalizeMemory(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }

  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (leftTokens.length < 2 || rightTokens.length < 2) {
    return false;
  }
  const smaller = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
  const larger = new Set(leftTokens.length <= rightTokens.length ? rightTokens : leftTokens);
  const shared = smaller.filter((token) => larger.has(token)).length;
  return shared === smaller.length && shared / Math.max(leftTokens.length, rightTokens.length) >= 0.8;
}

export function findDuplicateMemory(content: string, memories: MemoryText[]): MemoryText | null {
  return (
    memories.find(
      (memory) =>
        memory.status !== "RETIRED" &&
        memory.status !== "REJECTED" &&
        (sameMemory(content, memory.content) || sameMemory(content, memory.title)),
    ) ?? null
  );
}

function polarity(value: string): "affirm" | "deny" | "none" {
  const deny = /\b(never|must not|do not|don't|cannot|can not|prohibited)\b/i.test(value);
  const affirm = /\b(always|must)\b/i.test(value) && !/\bmust not\b/i.test(value);
  if (deny && !affirm) {
    return "deny";
  }
  if (affirm && !deny) {
    return "affirm";
  }
  return "none";
}

function related(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  return shorter.length >= 5 && longer.startsWith(shorter);
}

function topicsOverlap(left: string, right: string): boolean {
  const rightTokens = tokens(right);
  return tokens(left).some((token) => rightTokens.some((other) => related(token, other)));
}

export function findMemoryConflicts(rules: MemoryText[]): Array<{ left: MemoryText; right: MemoryText }> {
  const active = rules.filter((rule) => rule.status === "ACTIVE");
  const conflicts: Array<{ left: MemoryText; right: MemoryText }> = [];
  for (let index = 0; index < active.length; index += 1) {
    for (const other of active.slice(index + 1)) {
      const left = active[index];
      if (!left) {
        continue;
      }
      const leftPolarity = polarity(`${left.title} ${left.content}`);
      const rightPolarity = polarity(`${other.title} ${other.content}`);
      if (leftPolarity === "none" || rightPolarity === "none" || leftPolarity === rightPolarity) {
        continue;
      }
      if (topicsOverlap(`${left.title} ${left.content}`, `${other.title} ${other.content}`)) {
        conflicts.push({ left, right: other });
      }
    }
  }
  return conflicts;
}

export function findProjectExceptions(
  rules: MemoryText[],
  knowledge: MemoryText[],
): Array<{ rule: MemoryText; knowledge: MemoryText }> {
  const active = rules.filter((rule) => rule.status === "ACTIVE");
  const specific = knowledge.filter((item) => item.status === "DECISION" || item.status === "CONSTRAINT");
  const exceptions: Array<{ rule: MemoryText; knowledge: MemoryText }> = [];
  for (const rule of active) {
    for (const item of specific) {
      const rulePolarity = polarity(`${rule.title} ${rule.content}`);
      const itemPolarity = polarity(`${item.title} ${item.content}`);
      if (rulePolarity === "none" || itemPolarity === "none" || rulePolarity === itemPolarity) {
        continue;
      }
      if (topicsOverlap(`${rule.title} ${rule.content}`, `${item.title} ${item.content}`)) {
        exceptions.push({ rule, knowledge: item });
      }
    }
  }
  return exceptions;
}

export function describeProvenance(provenance: string): { complete: boolean; text: string } {
  const match = provenance.match(PROVENANCE_PATTERN);
  if (!match?.[1] || !match[2]) {
    return {
      complete: false,
      text: "Provenance is incomplete. I will not invent a source conversation.",
    };
  }
  return {
    complete: true,
    text: `I learned that from conversation ${match[1]}, message ${match[2]}.`,
  };
}

export function rememberReason(provenance: string): string {
  if (PROVENANCE_PATTERN.test(provenance)) {
    return "You asked Ghost to remember this in a conversation.";
  }
  if (provenance.toLocaleLowerCase().includes("founder-authored")) {
    return "You wrote this on the memory page.";
  }
  return "The stored provenance does not say why this was proposed.";
}

export function bestMemoryMatch(question: string, memories: MemoryText[]): MemoryText | null {
  let best: MemoryText | null = null;
  let bestScore = 0;
  for (const memory of memories) {
    if (memory.status && memory.status !== "ACTIVE") {
      continue;
    }
    const score = tokens(question).filter((token) => tokens(`${memory.title} ${memory.content}`).includes(token)).length;
    if (score > bestScore) {
      best = memory;
      bestScore = score;
    }
  }
  return best;
}

export function matchActiveRules(target: string, rules: MemoryText[]): MemoryText[] {
  const active = rules.filter((rule) => rule.status === "ACTIVE");
  const exact = active.filter((rule) => rule.id === target);
  if (exact.length > 0) {
    return exact;
  }
  return active.filter((rule) => sameMemory(target, rule.title) || sameMemory(target, rule.content) || sameMemory(target, `${rule.title} ${rule.content}`));
}

export function memoryRelations(items: ContextItem[]): ContextItem[] {
  const rules: MemoryText[] = items
    .filter((item) => item.type === "founder_rule")
    .map((item) => ({
      id: item.sourceId,
      title: item.title,
      content: item.content,
      status: "ACTIVE",
    }));
  const knowledge: MemoryText[] = items
    .filter((item) => item.sourceTable === "project_knowledge")
    .map((item) => ({
      id: item.sourceId,
      title: item.title,
      content: item.content,
      status: item.status ?? undefined,
    }));

  const relations: ContextItem[] = [];
  for (const conflict of findMemoryConflicts(rules)) {
    relations.push({
      id: `conflict-${conflict.left.id}-${conflict.right.id}`,
      type: "memory_conflict",
      authority: "FOUNDER_RULE",
      sourceTable: "founder_rules",
      sourceId: conflict.left.id,
      projectId: null,
      title: "Memory conflict",
      content: `${conflict.left.title} and ${conflict.right.title} disagree. Do not choose one. The founder decides. Neither rule was deleted.`,
      status: "ACTIVE",
      relevance: 1,
      keep: true,
      selectedBecause: "Both active rules were selected and they conflict.",
    });
  }
  for (const exception of findProjectExceptions(rules, knowledge)) {
    relations.push({
      id: `exception-${exception.rule.id}-${exception.knowledge.id}`,
      type: "project_exception",
      authority: "PROJECT_DECISION",
      sourceTable: "project_knowledge",
      sourceId: exception.knowledge.id,
      projectId: null,
      title: "Project exception",
      content: `${exception.knowledge.title} controls this project. ${exception.rule.title} remains active for other projects. Neither was deleted.`,
      status: "ACTIVE",
      relevance: 1,
      keep: true,
      selectedBecause: "A project decision disagrees with an active founder rule.",
    });
  }
  return relations;
}

export function matchesMemoryQuery(
  record: { title: string; content: string; status: string; scope: string; projectId: string | null; type: string },
  filter: { q?: string; status?: string; scope?: string; project?: string; type?: string },
): boolean {
  if (filter.status && record.status !== filter.status) {
    return false;
  }
  if (filter.scope && record.scope !== filter.scope) {
    return false;
  }
  if (filter.project && record.projectId !== filter.project) {
    return false;
  }
  if (filter.type && record.type !== filter.type) {
    return false;
  }
  const query = filter.q?.trim().toLocaleLowerCase();
  if (!query) {
    return true;
  }
  return `${record.title} ${record.content}`.toLocaleLowerCase().includes(query);
}
