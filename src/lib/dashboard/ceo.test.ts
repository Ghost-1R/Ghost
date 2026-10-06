import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  askPathGrounding,
  buildRedLights,
  buildWaitingOnMe,
  classifyFounderAsk,
  containsHardcodedCeoProjects,
  deriveProjectHealth,
  moneyStatusPhase1,
  rankTop3Actions,
  whoMightCallSection,
  type CeoSignal,
} from "./ceo";
import type { TodayAction } from "@/lib/operations/today";

const signal = (partial: Partial<CeoSignal> & Pick<CeoSignal, "id" | "kind" | "title">): CeoSignal => ({
  projectId: "p1",
  projectName: "Alpha",
  severity: "critical",
  detail: partial.title,
  at: "2026-10-01T00:00:00.000Z",
  href: "/projects/p1",
  clientFacing: true,
  ...partial,
});

const action = (partial: Partial<TodayAction> & Pick<TodayAction, "id" | "title">): TodayAction => ({
  projectId: "p1",
  projectName: "Alpha",
  description: "",
  status: "OPEN",
  priority: "NORMAL",
  provenance: "FOUNDER_APPROVED_ACTION",
  requiresDecision: false,
  sourceKind: "founder_instruction",
  ...partial,
});

test("Top 3 ranking prefers critical signals then decisions then today actions", () => {
  const top = rankTop3Actions({
    signals: [
      signal({ id: "b1", kind: "blocker", title: "Checkout broken", detail: "Orders fail." }),
      signal({ id: "b2", kind: "blocker", title: "Second blocker", detail: "Also bad." }),
    ],
    decisions: [
      {
        id: "d1",
        projectId: "p1",
        projectName: "Alpha",
        title: "Tax mode",
        question: "Which tax mode?",
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ],
    today: [
      action({ id: "a1", title: "Normal work" }),
      action({ id: "a2", title: "Needs decision", requiresDecision: true }),
    ],
  });
  assert.equal(top.length, 3);
  assert.equal(top[0]?.nextAction, "Checkout broken");
  assert.equal(top[1]?.nextAction, "Second blocker");
  assert.match(top[2]?.nextAction ?? "", /Tax mode|Decide/);
});

test("critical blocker and verification failure and failed deployment health → RED", () => {
  for (const kind of ["blocker", "critical_defect", "failed_health", "failed_deployment", "failed_verification"] as const) {
    const health = deriveProjectHealth({
      openBlockerCount: kind === "blocker" ? 1 : 0,
      criticalSignals: [signal({ id: "x", kind, title: "Critical", severity: "critical" })],
      yellowSignals: [],
      hasVerifiedEvidence: true,
      openDecisionCount: 0,
      nextAction: "Fix it",
    });
    assert.equal(health.status, "RED", kind);
    assert.ok(health.sources.length > 0);
  }
});

test("open decision without RED → YELLOW", () => {
  const health = deriveProjectHealth({
    openBlockerCount: 0,
    criticalSignals: [],
    yellowSignals: [],
    hasVerifiedEvidence: false,
    openDecisionCount: 2,
    nextAction: null,
  });
  assert.equal(health.status, "YELLOW");
});

test("YELLOW for incomplete important verification signal", () => {
  const health = deriveProjectHealth({
    openBlockerCount: 0,
    criticalSignals: [],
    yellowSignals: [
      signal({
        id: "y",
        kind: "failed_verification",
        severity: "high",
        title: "Important check incomplete",
        clientFacing: false,
      }),
    ],
    hasVerifiedEvidence: false,
    openDecisionCount: 0,
    nextAction: null,
  });
  assert.equal(health.status, "YELLOW");
});

test("GREEN requires verified evidence — absence of failure is not GREEN", () => {
  const unknown = deriveProjectHealth({
    openBlockerCount: 0,
    criticalSignals: [],
    yellowSignals: [],
    hasVerifiedEvidence: false,
    openDecisionCount: 0,
    nextAction: null,
  });
  assert.equal(unknown.status, "UNKNOWN");

  const green = deriveProjectHealth({
    openBlockerCount: 0,
    criticalSignals: [],
    yellowSignals: [],
    hasVerifiedEvidence: true,
    openDecisionCount: 0,
    nextAction: "Keep monitoring",
  });
  assert.equal(green.status, "GREEN");
  assert.match(green.reason, /evidence/i);
});

test("open decision and requires_decision → Waiting on Me", () => {
  const waiting = buildWaitingOnMe({
    decisions: [
      {
        id: "d1",
        projectId: "p1",
        projectName: "Alpha",
        title: "Pick gateway",
        question: "Which gateway?",
        createdAt: "2026-10-05T12:00:00.000Z",
      },
    ],
    requiresDecisionActions: [action({ id: "a1", title: "Confirm tax", requiresDecision: true })],
    presentationReviews: [
      {
        id: "r1",
        projectId: "p1",
        projectName: "Alpha",
        result: "NOT_READY",
        createdAt: "2026-10-05T10:00:00.000Z",
      },
    ],
    now: new Date("2026-10-06T12:00:00.000Z"),
  });
  assert.equal(waiting.length, 3);
  assert.ok(waiting.some((item) => item.what === "Pick gateway"));
  assert.ok(waiting.some((item) => item.what === "Confirm tax"));
  assert.ok(waiting.some((item) => /Presentation review/i.test(item.what)));
  assert.equal(waiting[0]?.ageLabel, "24h");
});

test("critical signals become Red Lights; empty stays empty", () => {
  assert.deepEqual(buildRedLights([]), []);
  const lights = buildRedLights([
    signal({ id: "1", kind: "blocker", title: "Ship blocker", detail: "Evidence A" }),
  ]);
  assert.equal(lights.length, 1);
  assert.equal(lights[0]?.evidence, "Evidence A");
});

test("no financial source → Money UNKNOWN", () => {
  const money = moneyStatusPhase1();
  assert.equal(money.state, "UNKNOWN");
  assert.match(money.detail, /not connected/i);
  assert.ok(!/\$0|MRR|revenue/i.test(money.label));
});

test("no client-event integration → honest Who Might Call state", () => {
  const section = whoMightCallSection([
    signal({ id: "1", kind: "blocker", title: "Storefront down", clientFacing: true }),
  ]);
  assert.equal(section.connected, false);
  assert.match(section.notice, /No client exception signals connected yet/i);
  assert.equal(section.exceptions.length, 1);
  assert.equal(section.exceptions[0]?.projectName, "Alpha");
});

test("normal question → Second Me path; consequential → gated path", () => {
  assert.equal(classifyFounderAsk("How secure are we?"), "SECOND_ME");
  assert.equal(classifyFounderAsk("What needs me?"), "SECOND_ME");
  assert.equal(classifyFounderAsk("What's happening with the store?"), "SECOND_ME");
  assert.equal(classifyFounderAsk("Which project needs me most?"), "SECOND_ME");
  assert.equal(classifyFounderAsk("What don't you know?"), "SECOND_ME");
  assert.equal(classifyFounderAsk("How do I deploy safely?"), "SECOND_ME");
  assert.equal(classifyFounderAsk("Deploy Ivoire Shop to production"), "CONSEQUENTIAL");
  assert.equal(classifyFounderAsk("Build the booking system"), "CONSEQUENTIAL");
  assert.equal(classifyFounderAsk("Publish the marketing page"), "CONSEQUENTIAL");
  assert.equal(classifyFounderAsk("Send the client a message about outage"), "CONSEQUENTIAL");
  assert.match(askPathGrounding("SECOND_ME"), /question only/i);
  assert.match(askPathGrounding("CONSEQUENTIAL"), /Do not silently execute/i);
});

test("CEO home does not hardcode project names", () => {
  const page = readFileSync(new URL("../../app/(workspace)/dashboard/page.tsx", import.meta.url), "utf8");
  assert.equal(containsHardcodedCeoProjects(page), false);
  assert.ok(!/Ivoire Shop|Cleaning Business/.test(page));
  assert.ok(page.includes("rankTop3Actions") || page.includes("ceo-"));
});
