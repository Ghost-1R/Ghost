import { createHash } from "node:crypto";
import type { ProposedStep } from "@/lib/underworld/types";

/** Deterministic MOCK plan — no provider calls. LIVE must stay off. */
export function proposeBoundedUnderworldPlan(input: {
  title: string;
  objective: string;
}): { steps: ProposedStep[]; scopeSummary: string; scopeFingerprint: string } {
  const title = input.title.trim() || "Untitled goal";
  const objective = input.objective.trim() || "No objective recorded.";

  const steps: ProposedStep[] = [
    {
      seq: 1,
      title: `Plan bounded work for “${title}”`,
      role: "PLANNER",
      assigneeKind: "AI",
      stopCondition: "Stop after a three-step plan is saved. No paid calls.",
    },
    {
      seq: 2,
      title: `Execute MOCK step for “${title}”`,
      role: "EXECUTOR",
      assigneeKind: "AI",
      stopCondition: "Stop after MOCK checkpoints finish or founder pauses. LIVE refused.",
    },
    {
      seq: 3,
      title: `Independent review of “${title}”`,
      role: "REVIEWER",
      assigneeKind: "HUMAN",
      stopCondition: "Reviewer must differ from executor. Founder approves consequential next actions.",
    },
  ];

  const scopeSummary = [
    `Goal: ${title}`,
    `Objective: ${objective}`,
    "Mode: MOCK / LIVE=0",
    "Workers: planner (AI) → executor (AI MOCK) → reviewer (human)",
    "Consequential actions require exact-scope founder approval.",
  ].join("\n");

  const scopeFingerprint = createHash("sha256")
    .update(JSON.stringify({ title, objective, steps: steps.map((s) => [s.seq, s.role, s.assigneeKind]) }))
    .digest("hex")
    .slice(0, 32);

  return { steps, scopeSummary, scopeFingerprint };
}

export function reviewerIsIndependent(executorActorId: string | null, reviewerActorId: string | null): boolean {
  if (!executorActorId || !reviewerActorId) return true;
  return executorActorId !== reviewerActorId;
}
