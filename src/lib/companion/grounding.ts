import type { CompanionIntent } from "./intent";
import type { ProjectFocus } from "./focus";

export function companionIntentGrounding(intent: CompanionIntent, focus: ProjectFocus): string {
  const focusLine =
    focus.kind === "one"
      ? `Active project focus: ${focus.name} (${focus.id}). Do not let unrelated projects dominate.`
      : focus.kind === "several"
        ? `Compare only these projects: ${focus.projects.map((project) => project.name).join(", ")}.`
        : focus.kind === "new_proposal"
          ? `This is a proposed idea (${focus.label}), not an existing Project Brain. Do not answer from unrelated project blockers.`
          : "No specific project was named. Prefer the latest user message over stale thread topics.";

  switch (intent) {
    case "NEW_IDEA":
      return [
        "Ask path: NEW_IDEA (discovery only).",
        focusLine,
        "Acknowledge the idea in plain language.",
        "Give a useful preliminary plan of concrete first steps as suggestions — not as verified Project Brain facts.",
        "Do not refuse merely because no project, requirements, architecture, or founder approval is recorded yet.",
        "For a product or website idea, cover suggested first-step areas when relevant: customers and business requirements, catalog or inventory and availability, core workflows (such as reservations or orders), pricing and payments, customer accounts, admin/operations dashboard, data model, and testing plus deployment — clearly as suggestions, not recorded facts.",
        "Label suggestions clearly as advisory. Offer the path: Idea → Strategy → Product Definition → Architecture → Build Plan.",
        "Do not claim the product is approved, implemented, verified, or deployed.",
        "Ask at most one useful discovery question when it materially improves the plan.",
        "Offer to create or save a project only as a next step the founder can approve — do not create records from this message alone.",
        "Do not drag in unrelated open blockers or status from other projects.",
      ].join(" ");
    case "PROJECT_DISCOVERY":
      return [
        "Ask path: PROJECT_DISCOVERY.",
        focusLine,
        "Help define the product with practical planning guidance.",
        "Prefer structured suggestions and clarifying questions over execution.",
        "Distinguish assumptions and suggestions from verified Project Brain facts. Do not invent founder preferences or recorded requirements.",
        "Do not create or mutate project records unless the founder explicitly approved that action elsewhere.",
      ].join(" ");
    case "PROJECT_STATUS":
      return [
        "Ask path: PROJECT_STATUS (question only).",
        focusLine,
        "Answer from Project Brain and recorded evidence for the focused project(s).",
        "If evidence is missing, say UNKNOWN. Absence of failure is not GREEN.",
      ].join(" ");
    case "RESEARCH":
      return [
        "Ask path: RESEARCH.",
        focusLine,
        "Compare using recorded facts only. Mark gaps as unknown. Do not invent metrics.",
      ].join(" ");
    case "DECISION":
      return [
        "Ask path: DECISION.",
        focusLine,
        "Surface what is recorded and what the founder must decide. Ghost must not resolve the decision in conversation.",
      ].join(" ");
    case "CONSEQUENTIAL_ACTION":
      return [
        "Ask path: CONSEQUENTIAL (founder requested an action).",
        focusLine,
        "Do not silently execute money, public posts, customer messages, production deploy, schema changes, or destructive operations.",
        "Explain what is recorded, what is missing, and which Ghost operating-system step (decision, inspection, deploy, Idea Lab) must happen next.",
        "Ghost conversation cannot mutate project lifecycle by itself.",
        "If the founder asked to draft something, distinguish drafting guidance from creating or modifying records.",
      ].join(" ");
    case "CLARIFICATION":
      return [
        "Ask path: CLARIFICATION.",
        focusLine,
        "Treat this as a follow-up to the immediately prior exchange only.",
        "Answer the clarification directly. Do not restart unrelated project status dumps.",
      ].join(" ");
    case "QUESTION":
    default:
      return [
        "Ask path: QUESTION (answer immediately).",
        focusLine,
        "Answer the latest user message directly from relevant evidence.",
        "Do not start build, deploy, publish, send, or other execution workflows.",
        "Do not ask for approval unless the founder requested an action that needs it.",
      ].join(" ");
  }
}

/** Deterministic discovery reply when the model drifts to unrelated projects. */
export function discoveryFallbackReply(label: string): string {
  return [
    `That sounds like a new product idea: ${label}.`,
    "Ghost can help you walk it through Idea → Strategy → Product Definition → Architecture → Build Plan — discussion first, no project records created from this message alone.",
    "One useful question: who is this for — you, a client, or both?",
  ].join(" ");
}
