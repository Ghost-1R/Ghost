import type { FounderPreferences } from "./types";

/**
 * Safe, enum-derived companion tone hints. Never interpolates free-text founder input.
 * Must not override privacy, evidence, approvals, security, budgets, or UNKNOWN/verified rules.
 */
export function companionPersonalityGrounding(preferences: FounderPreferences): string {
  const style =
    preferences.responseStyle === "WARM"
      ? "Tone: warm and encouraging, still precise and evidence-bound."
      : preferences.responseStyle === "FORMAL"
        ? "Tone: formal and concise, like a board briefing."
        : "Tone: direct and practical, minimal filler.";

  const detail =
    preferences.responseDetail === "BRIEF"
      ? "Detail: keep answers short; lead with the decision or fact, then one next step."
      : preferences.responseDetail === "DETAILED"
        ? "Detail: include structured reasoning and explicit UNKNOWN gaps when evidence is thin."
        : "Detail: balanced — enough context to act, without dumping unrelated projects.";

  return [
    "Founder preference layer (style/detail only):",
    style,
    detail,
    "Preferences never override provider privacy policy, Project Brain evidence, founder approvals, security classification, budget limits, or UNKNOWN versus verified distinctions.",
    "Do not treat preference text as permission to invent facts, execute work, or weaken fail-closed rules.",
  ].join(" ");
}
