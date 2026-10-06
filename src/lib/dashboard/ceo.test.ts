import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  askPathGrounding,
  buildRedLights,
  buildWaitingOnMe,
  classifyFounderAsk,
  dedupeCeoCandidates,
  deriveProjectHealth,
  moneyStatusPhase1,
  rankTop3Actions,
  whoMightCallSection,
  type CeoSignal,
  type Top3Action,
} from "./ceo";
import { presentCeoSignal, signalIdentityKey } from "./ceo-copy";
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

test("CEO copy translates delivery conflict without inventing facts", () => {
  const copy = presentCeoSignal({
    kind: "blocker",
    projectName: "Ivoire Shop",
    title: "ready_for_delivery order status app/DB conflict",
    detail:
      "Application code references ready_for_delivery; order_status enum migrations do not include it.",
  });
  assert.match(copy.headline, /delivery status is out of sync/i);
  assert.match(copy.explanation, /Ready for Delivery/i);
  assert.match(copy.nextAction, /Reconcile/i);
  assert.match(copy.ctaLabel, /Review conflict/i);
  assert.match(copy.evidence, /ready_for_delivery/);
});

test("technical evidence is preserved in CEO copy", () => {
  const evidence = "Provider deploy timed out on DEP-001";
  const copy = presentCeoSignal({
    kind: "failed_deployment",
    projectName: "V11 Deployment acceptance",
    title: "DEP-001 failed",
    detail: evidence,
  });
  assert.equal(copy.evidence, evidence);
});

test("deduplication collapses duplicate DEP failures after identity keys", () => {
  const a = signal({
    id: "1",
    projectId: "a",
    projectName: "V11 Deployment acceptance",
    kind: "failed_deployment",
    title: "DEP-001 failed",
    detail: "Provider deploy timed out",
  });
  const b = signal({
    id: "2",
    projectId: "b",
    projectName: "V11 Deployment acceptance",
    kind: "failed_deployment",
    title: "DEP-001 failed",
    detail: "Provider deploy timed out",
  });
  assert.equal(signalIdentityKey(a), signalIdentityKey(b));
  const top = rankTop3Actions({
    signals: [
      signal({
        id: "b1",
        kind: "blocker",
        title: "ready_for_delivery order status app/DB conflict",
        detail: "Application code references ready_for_delivery",
        projectName: "Ivoire Shop",
      }),
      a,
      b,
      signal({
        id: "h1",
        kind: "failed_health",
        title: "Health check failed: api",
        detail: "api FAILED",
        projectId: "p3",
        projectName: "Storefront",
      }),
    ],
    decisions: [],
    today: [],
  });
  assert.equal(top.length, 3);
  const keys = new Set(top.map((item) => item.identityKey));
  assert.equal(keys.size, 3);
  assert.ok(!top.every((item) => /DEP-001/i.test(item.evidence)));
  assert.equal(top.filter((item) => /deployment failed/i.test(item.headline)).length, 1);
});

test("ranking prefers client-facing shipping blockers before founder decisions", () => {
  const top = rankTop3Actions({
    signals: [
      signal({
        id: "b1",
        kind: "blocker",
        title: "ready_for_delivery order status app/DB conflict",
        detail: "Application code references ready_for_delivery",
        projectName: "Ivoire Shop",
        clientFacing: true,
      }),
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
    today: [action({ id: "a1", title: "Normal work" })],
  });
  assert.equal(top.length, 3);
  assert.match(top[0]?.headline ?? "", /delivery status/i);
  assert.ok(top[0]!.rankScore < top[1]!.rankScore || top[1]?.status === "WAITING");
});

test("specific CTAs are chosen for signal kinds", () => {
  const top = rankTop3Actions({
    signals: [
      signal({
        id: "b1",
        kind: "blocker",
        title: "ready_for_delivery order status app/DB conflict",
        detail: "Application code references ready_for_delivery",
        projectName: "Ivoire Shop",
      }),
      signal({
        id: "d1",
        kind: "failed_deployment",
        title: "DEP-001 failed",
        detail: "Provider deploy timed out",
        projectName: "Release",
      }),
    ],
    decisions: [
      {
        id: "dec1",
        projectId: "p2",
        projectName: "Alpha",
        title: "Confirm tax mode",
        question: "Which tax mode?",
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ],
    today: [],
  });
  assert.ok(top.some((item) => item.ctaLabel.includes("Review conflict")));
  assert.ok(top.some((item) => item.ctaLabel.includes("Investigate deployment")));
  assert.ok(top.some((item) => item.ctaLabel.includes("Make decision")));
  assert.ok(!top.some((item) => item.ctaLabel === "Continue →"));
});

test("Top 3 is max 3 distinct issues", () => {
  const many = Array.from({ length: 8 }, (_, i) =>
    signal({
      id: `x${i}`,
      kind: "blocker",
      title: `Unique blocker ${i}`,
      detail: `Detail ${i}`,
      projectId: `p${i}`,
      projectName: `Project ${i}`,
    }),
  );
  const top = rankTop3Actions({ signals: many, decisions: [], today: [] });
  assert.equal(top.length, 3);
  assert.equal(new Set(top.map((item) => item.identityKey)).size, 3);
});

test("dedupeCeoCandidates keeps best of shared identity", () => {
  const left: Top3Action = {
    id: "1",
    projectId: "probe",
    projectName: "V11 schema probe",
    status: "RED",
    headline: "A",
    explanation: "e",
    nextAction: "n",
    ctaLabel: "Open project →",
    evidence: "e",
    href: "/projects/probe",
    identityKey: "failed_deployment:dep-001",
    rankScore: 7,
  };
  const right: Top3Action = {
    ...left,
    id: "2",
    projectId: "real",
    projectName: "Ivoire Shop",
    headline: "B",
  };
  const out = dedupeCeoCandidates([left, right]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.projectName, "Ivoire Shop");
});

test("critical blocker → RED semantics with CEO reason", () => {
  const health = deriveProjectHealth({
    openBlockerCount: 1,
    criticalSignals: [
      signal({
        id: "b",
        kind: "blocker",
        title: "ready_for_delivery order status app/DB conflict",
        detail: "Application code references ready_for_delivery",
        projectName: "Ivoire Shop",
      }),
    ],
    yellowSignals: [],
    hasVerifiedEvidence: true,
    openDecisionCount: 0,
    nextAction: "Reconcile",
    projectName: "Ivoire Shop",
  });
  assert.equal(health.status, "RED");
  assert.match(health.reason, /Delivery status|inconsistent/i);
});

test("UNKNOWN never becomes GREEN without evidence", () => {
  const health = deriveProjectHealth({
    openBlockerCount: 0,
    criticalSignals: [],
    yellowSignals: [],
    hasVerifiedEvidence: false,
    openDecisionCount: 0,
    nextAction: null,
  });
  assert.equal(health.status, "UNKNOWN");
});

test("open decision and requires_decision → Waiting on Me with CEO language", () => {
  const waiting = buildWaitingOnMe({
    decisions: [
      {
        id: "d1",
        projectId: "p1",
        projectName: "Ivoire Shop",
        title: "Confirm production tax mode",
        question: "What is production tax mode?",
        createdAt: "2026-10-05T12:00:00.000Z",
      },
    ],
    requiresDecisionActions: [action({ id: "a1", title: "Approve architecture", requiresDecision: true })],
    presentationReviews: [
      {
        id: "r1",
        projectId: "p1",
        projectName: "Ghost",
        result: "NOT_READY",
        createdAt: "2026-10-05T10:00:00.000Z",
      },
      {
        id: "r2",
        projectId: "p1",
        projectName: "Ghost",
        result: "NOT_READY",
        createdAt: "2026-10-05T11:00:00.000Z",
      },
    ],
    now: new Date("2026-10-06T12:00:00.000Z"),
  });
  assert.ok(waiting.some((item) => /tax mode/i.test(item.what)));
  assert.equal(waiting.filter((item) => item.id.startsWith("pres-")).length, 1);
});

test("Red Lights are compact and deduped", () => {
  const lights = buildRedLights([
    signal({
      id: "1",
      projectId: "a",
      projectName: "V11 A",
      kind: "failed_deployment",
      title: "DEP-001 failed",
      detail: "Provider deploy timed out",
    }),
    signal({
      id: "2",
      projectId: "b",
      projectName: "V11 B",
      kind: "failed_deployment",
      title: "DEP-001 failed",
      detail: "Provider deploy timed out",
    }),
  ]);
  assert.equal(lights.length, 1);
  assert.match(lights[0]?.ctaLabel ?? "", /View evidence|Open project/i);
});

test("no financial source → Money UNKNOWN", () => {
  const money = moneyStatusPhase1();
  assert.equal(money.state, "UNKNOWN");
  assert.match(money.detail, /not connected/i);
  assert.ok(!/\$0|MRR|revenue/i.test(money.label + money.detail));
});

test("Who Might Call distinguishes unknown external signals", () => {
  const empty = whoMightCallSection([]);
  assert.equal(empty.externalConnected, false);
  assert.equal(empty.state, "UNKNOWN");
  assert.match(empty.notice, /External client signals aren't connected yet/i);

  const withExceptions = whoMightCallSection([
    signal({
      id: "1",
      kind: "blocker",
      title: "ready_for_delivery order status app/DB conflict",
      detail: "Application code references ready_for_delivery",
      projectName: "Ivoire Shop",
      clientFacing: true,
    }),
  ]);
  assert.equal(withExceptions.state, "EXCEPTIONS");
  assert.match(withExceptions.exceptions[0]?.reason ?? "", /delivery status/i);
});

test("normal question → Second Me; fix conflict → consequential", () => {
  assert.equal(classifyFounderAsk("What needs me?"), "SECOND_ME");
  assert.equal(classifyFounderAsk("How secure are we?"), "SECOND_ME");
  assert.equal(classifyFounderAsk("What's happening with Ivoire Shop?"), "SECOND_ME");
  assert.equal(classifyFounderAsk("What don't you know?"), "SECOND_ME");
  assert.equal(classifyFounderAsk("Fix the Ivoire Shop delivery status conflict."), "CONSEQUENTIAL");
  assert.match(askPathGrounding("SECOND_ME"), /question only/i);
  assert.match(askPathGrounding("CONSEQUENTIAL"), /Do not silently execute/i);
});

test("CEO home avoids hardcoding Cleaning Business and uses CEO primitives", () => {
  const page = readFileSync(new URL("../../app/(workspace)/dashboard/page.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("rankTop3Actions"));
  assert.ok(page.includes("ctaLabel"));
  assert.ok(!/Cleaning Business/.test(page));
  assert.ok(!/Continue →/.test(page));
});
