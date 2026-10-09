/**
 * Offline full-pathway checks for exploratory companion replies.
 * Uses branded mock providers only — never live model HTTP.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { brandMockFetch } from "@/lib/ai/live-provider-mode";
import { prepareReply } from "@/lib/ai/reply";
import { resolveModelProvider } from "@/lib/ai/provider";
import { assembleGlobalContext } from "@/lib/brain/context";
import { collectGlobalItems, selectGrounding } from "@/lib/ghost-context/assemble";
import { classifyCompanionIntent, classifyFounderAsk } from "./intent";
import { resolveProjectFocus } from "./focus";
import { companionIntentGrounding } from "./grounding";
import { selectCompanionProjectItems } from "./context";
import { boundCompanionHistory } from "./history";
import { checkResponseRelevance } from "./relevance";
import { askPathGrounding } from "@/lib/dashboard/ceo";

const projects = [
  { id: "ivoire", name: "Ivoire Shop" },
  { id: "ghost", name: "Ghost" },
];

const summaries = projects.map((project) => ({
  ...project,
  status: "BUILD",
  currentMilestone: "Build",
  openBlockers: project.id === "ivoire" ? 2 : 0,
  nextAction: project.id === "ivoire" ? "Reconcile delivery" : null,
}));

const EMPTY_RULES: Array<{ id: string; title: string; content: string; status: string }> = [];

const PLAN_DOMAINS = [
  /customer|business requirement/i,
  /catalog|inventory|availability|fleet|car list/i,
  /reservation|booking/i,
  /pric|payment/i,
  /account|auth|sign[- ]?in|login/i,
  /admin|dashboard|operations/i,
  /database|data model|schema/i,
  /test|deploy/i,
];

function buildExploratoryPathway(message: string) {
  const intent = classifyCompanionIntent(message);
  const focus = resolveProjectFocus({
    message,
    intent,
    projects,
    lockedProjectId: "ivoire",
  });
  const companionProjectItems = selectCompanionProjectItems({
    question: message,
    intent,
    focus,
    projects: summaries,
  });
  const companionProjectIds = new Set(companionProjectItems.map((item) => item.id));
  const context = assembleGlobalContext({
    projects: summaries
      .filter((project) => companionProjectIds.has(project.id))
      .map((project) => ({
        id: project.id,
        name: project.name,
        status: project.status,
        currentMilestone: project.currentMilestone,
        openBlockers: project.openBlockers,
        nextAction: project.nextAction,
      })),
    founderRules: EMPTY_RULES,
  });
  const historyMessages = boundCompanionHistory({
    messages: [
      { role: "user", content: "What's happening with Ivoire Shop?" },
      { role: "assistant", content: "Ivoire Shop still has a delivery conflict." },
      { role: "user", content: message },
    ],
    intent,
    focus,
    projects,
  });
  const grounding = selectGrounding({
    items: [
      ...companionProjectItems,
      ...collectGlobalItems({ question: message, projects: [], founderRules: EMPTY_RULES }),
    ],
    messages: [{ role: "user", content: message }],
    historyMessages,
    projectId: null,
    productionVerified: false,
  });
  const askPath = classifyFounderAsk(message);
  const pathAwareGrounding = [
    grounding.data,
    companionIntentGrounding(intent, focus),
    askPathGrounding(askPath, message),
  ]
    .filter(Boolean)
    .join("\n\n");

  return { intent, focus, askPath, context, grounding, pathAwareGrounding, companionProjectItems, historyMessages };
}

/** Fixture provider: returns a plan only when request grounding authorizes NEW_IDEA discovery. */
function exploratoryPlanFixtureFetch() {
  return brandMockFetch(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    const blob = (body.messages ?? []).map((message) => message.content ?? "").join("\n");
    assert.match(blob, /NEW_IDEA|discovery only|preliminary plan/i);
    assert.ok(!/Ivoire Shop still has a delivery conflict/i.test(blob), "stale Ivoire history must not re-enter model messages");

    const content = [
      "That sounds like a car rental product idea — here is a preliminary plan as suggestions, not recorded Project Brain facts.",
      "Suggested first steps:",
      "1. Customers and business requirements — who rents, who owns the fleet, markets, and operating constraints.",
      "2. Car catalog and availability — vehicle types, locations, and how availability is checked.",
      "3. Reservations — booking flow, hold windows, and cancellation rules.",
      "4. Pricing and payments — rates, deposits, and payment provider choices (names only; no secrets).",
      "5. Customer accounts — sign-up, identity, and rental history.",
      "6. Admin dashboard — fleet ops, bookings, and support actions.",
      "7. Database architecture — core entities for vehicles, bookings, customers, and payments (design only).",
      "8. Testing and deployment — verification before any live launch; nothing is implemented or approved yet.",
      "Path: Idea → Strategy → Product Definition → Architecture → Build Plan.",
      "One question: is this for a client fleet, peer-to-peer, or your own inventory?",
    ].join("\n");

    return new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 40, completion_tokens: 120, total_tokens: 160 },
      }),
      { status: 200 },
    );
  });
}

test("full pathway: car rental first steps gets advisory plan without unrelated project evidence", async () => {
  const message = "I want to create a car rental website. What are the first steps?";
  const pathway = buildExploratoryPathway(message);

  assert.equal(pathway.intent, "NEW_IDEA");
  assert.equal(pathway.askPath, "SECOND_ME");
  assert.equal(pathway.focus.kind, "new_proposal");
  assert.equal(pathway.companionProjectItems.length, 0);
  assert.equal(pathway.grounding.count, pathway.grounding.sources.length);
  assert.ok(
    !pathway.grounding.sources.some((source) => /ivoire|ghost/i.test(source.title ?? "")),
    "grounding sources must not include unrelated project summaries",
  );
  assert.match(pathway.pathAwareGrounding, /suggested first-step areas|preliminary plan/i);
  assert.match(pathway.pathAwareGrounding, /Do not claim the product is approved, implemented/i);
  assert.equal(pathway.historyMessages.length, 1);
  assert.equal(pathway.historyMessages[0]?.content, message);

  const selection = resolveModelProvider(
    {
      GHOST_NO_LIVE_PROVIDER_CALLS: "1",
      GHOST_MODEL_PROVIDER: "groq",
      GROQ_API_KEY: "gsk_testkeyvalue000000000000000000000000000000",
    },
    exploratoryPlanFixtureFetch(),
  );
  assert.ok(selection.provider);

  const reply = await prepareReply({
    requestedProjectId: null,
    visibleProjectId: null,
    context: pathway.context,
    grounding: pathway.pathAwareGrounding,
    messages: pathway.grounding.messages.flatMap((turn) =>
      turn.role === "user" || turn.role === "assistant" ? [{ role: turn.role, content: turn.content }] : [],
    ),
    provider: selection.provider,
  });

  assert.equal(reply.ok, true);
  if (!reply.ok) return;

  for (const domain of PLAN_DOMAINS) {
    assert.match(reply.content, domain);
  }
  assert.match(reply.content, /suggestion|preliminary|not recorded/i);
  assert.ok(!/I (?:implemented|deployed|approved)|production verified|build is complete/i.test(reply.content));

  const relevance = checkResponseRelevance({
    question: message,
    answer: reply.content,
    intent: pathway.intent,
    focus: pathway.focus,
    projects,
  });
  assert.equal(relevance.ok, true);
  assert.equal(relevance.correctedContent, null);
});

test("full pathway: Ivoire status keeps Ivoire project items and drops Ghost", () => {
  const message = "What is Ivoire Shop's current deployment status?";
  const intent = classifyCompanionIntent(message);
  const focus = resolveProjectFocus({ message, intent, projects, lockedProjectId: null });
  assert.equal(focus.kind, "one");
  if (focus.kind !== "one") return;
  assert.equal(focus.id, "ivoire");

  const items = selectCompanionProjectItems({
    question: message,
    intent,
    focus,
    projects: summaries,
  });
  assert.ok(items.some((item) => item.id === "ivoire" || /Ivoire/i.test(item.title)));
  assert.ok(!items.some((item) => item.id === "ghost"));
});

test("approval boundaries: draft/show advisory; save/start consequential", () => {
  assert.equal(classifyCompanionIntent("Show me a build plan."), "PROJECT_DISCOVERY");
  assert.equal(classifyFounderAsk("Show me a build plan."), "SECOND_ME");
  assert.equal(classifyCompanionIntent("Draft the architecture."), "PROJECT_DISCOVERY");
  assert.equal(classifyFounderAsk("Draft the architecture."), "SECOND_ME");
  assert.equal(classifyCompanionIntent("Save this plan."), "CONSEQUENTIAL_ACTION");
  assert.equal(classifyFounderAsk("Save this plan."), "CONSEQUENTIAL");
  assert.equal(classifyCompanionIntent("Start building."), "CONSEQUENTIAL_ACTION");
  assert.equal(classifyFounderAsk("Start building."), "CONSEQUENTIAL");
  assert.match(
    companionIntentGrounding("CONSEQUENTIAL_ACTION", { kind: "none" }),
    /Do not silently execute|cannot mutate project lifecycle/i,
  );
});

test("provider fail-closed under NO_LIVE without branded mock", async () => {
  const selection = resolveModelProvider({
    GHOST_NO_LIVE_PROVIDER_CALLS: "1",
    GHOST_MODEL_PROVIDER: "groq",
    GROQ_API_KEY: "gsk_testkeyvalue000000000000000000000000000000",
  });
  assert.ok(selection.provider);
  await assert.rejects(
    () =>
      selection.provider!.complete({
        system: "x",
        context: assembleGlobalContext({ projects: [], founderRules: [] }),
        messages: [{ role: "user", content: "hi" }],
      }),
    /NO_LIVE_PROVIDER_CALLS/,
  );
});
