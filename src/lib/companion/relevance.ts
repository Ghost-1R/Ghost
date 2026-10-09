import { tokens } from "@/lib/ghost-context/select";
import { normalizeName } from "@/lib/ghost-context/resolve";
import type { CompanionIntent } from "./intent";
import type { NamedProject, ProjectFocus } from "./focus";
import { discoveryFallbackReply } from "./grounding";

export type RelevanceCheck = {
  ok: boolean;
  reasons: string[];
  correctedContent: string | null;
};

function mentionsUnrelatedProjects(answer: string, focus: ProjectFocus, projects: NamedProject[]): string[] {
  const haystack = normalizeName(answer);
  const allowed = new Set(
    focus.kind === "one"
      ? [normalizeName(focus.name)]
      : focus.kind === "several"
        ? focus.projects.map((project) => normalizeName(project.name))
        : [],
  );

  return projects
    .filter((project) => {
      const name = normalizeName(project.name);
      if (!name || name.length < 4) return false;
      if (allowed.has(name)) return false;
      return haystack.includes(name);
    })
    .map((project) => project.name);
}

function answersLatestQuestion(question: string, answer: string): boolean {
  const wanted = tokens(question);
  if (wanted.length === 0) return answer.trim().length > 0;
  const answered = new Set(tokens(answer));
  let hits = 0;
  for (const word of wanted) {
    if (answered.has(word)) hits += 1;
  }
  // Short answers / discovery templates can be valid with low lexical overlap.
  if (answer.length < 280) return hits >= 1 || /idea|path|strategy|unknown|don't know|do not|cannot/i.test(answer);
  return hits / wanted.length >= 0.15 || hits >= 2;
}

function dominatedByUnrelated(answer: string, unrelated: string[]): boolean {
  if (unrelated.length === 0) return false;
  const lower = answer.toLocaleLowerCase();
  let hits = 0;
  for (const name of unrelated) {
    const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    hits += (lower.match(re) ?? []).length;
  }
  return hits >= 2 || (hits >= 1 && answer.length > 200 && hits / Math.max(1, tokens(answer).length) > 0.08);
}

/**
 * Inexpensive deterministic relevance gate. No second model call.
 * On failure, returns a bounded correction — never fabricated evidence.
 */
export function checkResponseRelevance(input: {
  question: string;
  answer: string;
  intent: CompanionIntent;
  focus: ProjectFocus;
  projects: NamedProject[];
}): RelevanceCheck {
  const reasons: string[] = [];
  const answer = input.answer.trim();

  if (!answer) {
    return {
      ok: false,
      reasons: ["empty_answer"],
      correctedContent: "Ghost did not produce an answer for that message. Please ask again.",
    };
  }

  if (!answersLatestQuestion(input.question, answer)) {
    reasons.push("did_not_address_latest_message");
  }

  if (/ignore (?:previous|all) instructions|override founder|reveal (?:system|hidden) prompt/i.test(answer)) {
    reasons.push("prompt_injection_pattern");
  }

  const unrelated = mentionsUnrelatedProjects(answer, input.focus, input.projects);

  if (
    (input.intent === "NEW_IDEA" || input.focus.kind === "new_proposal") &&
    dominatedByUnrelated(answer, unrelated)
  ) {
    reasons.push("unrelated_project_domination");
    const label = input.focus.kind === "new_proposal" ? input.focus.label : "new product idea";
    return {
      ok: false,
      reasons,
      correctedContent: discoveryFallbackReply(label),
    };
  }

  if (input.focus.kind === "one") {
    const named = normalizeName(answer).includes(normalizeName(input.focus.name));
    if (!named && input.intent === "PROJECT_STATUS" && unrelated.length > 0 && dominatedByUnrelated(answer, unrelated)) {
      reasons.push("wrong_project_focus");
    }
  }

  if (input.intent === "CONSEQUENTIAL_ACTION") {
    const gated =
      /cannot|won't|will not|do not|don't|approval|decision|inspect|controlled|must happen next|not (?:execute|mutating|create)|conversation cannot/i.test(
        answer,
      );
    if (!gated && /\b(done|fixed|deployed|applied the migration|i (?:created|updated|deleted))\b/i.test(answer)) {
      reasons.push("claimed_execution_without_gate");
      return {
        ok: false,
        reasons,
        correctedContent: [
          "That request is consequential work.",
          "Ghost will not silently modify the project from conversation.",
          "Next: use the recorded decision, inspection, or build path for that change — say which step you want to take.",
        ].join(" "),
      };
    }
  }

  if (reasons.includes("prompt_injection_pattern")) {
    return {
      ok: false,
      reasons,
      correctedContent:
        input.intent === "NEW_IDEA" || input.focus.kind === "new_proposal"
          ? discoveryFallbackReply(input.focus.kind === "new_proposal" ? input.focus.label : "new product idea")
          : "Ghost ignored instruction-like text inside project data. Ask again without that override attempt.",
    };
  }

  if (reasons.includes("did_not_address_latest_message") && input.intent === "NEW_IDEA") {
    const label = input.focus.kind === "new_proposal" ? input.focus.label : "new product idea";
    return { ok: false, reasons, correctedContent: discoveryFallbackReply(label) };
  }

  return {
    ok: reasons.length === 0,
    reasons,
    correctedContent: null,
  };
}
