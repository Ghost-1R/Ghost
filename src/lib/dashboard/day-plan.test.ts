import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDayPlanPlacements,
  buildWorkerAssignmentPreview,
  groupDayPlan,
  recommendDayPlan,
  recordedEstimateMinutes,
} from "./day-plan";
import { explainArtifactResult, friendlyArtifactTitle } from "./result-labels";
import type { AgentTaskSurfaceRow } from "@/lib/operations/agent-task-surface";
import type { TodayAction } from "@/lib/operations/today";

test("recordedEstimateMinutes only returns explicit recorded estimates", () => {
  assert.equal(recordedEstimateMinutes(null), null);
  assert.equal(recordedEstimateMinutes("Continue MOCK step"), null);
  assert.equal(recordedEstimateMinutes("estimate: 15 minutes"), 15);
  assert.equal(recordedEstimateMinutes("recorded estimate = ~10 min"), 10);
});

test("recommendDayPlan groups do-first, later, and waiting with plain reasons", () => {
  const actions: TodayAction[] = [
    {
      id: "a1",
      projectId: "p1",
      projectName: "Pilot02 Proj",
      title: "Plan next iteration",
      description: "Sketch next loop",
      status: "OPEN",
      priority: "NORMAL",
      provenance: "FACT",
      requiresDecision: false,
      sourceKind: "next_action",
    },
    {
      id: "a2",
      projectId: "p1",
      projectName: "Pilot02 Proj",
      title: "Close this pilot step",
      description: "estimate: 5 minutes",
      status: "OPEN",
      priority: "LOW",
      provenance: "FACT",
      requiresDecision: false,
      sourceKind: "next_action",
    },
  ];
  const agentTasks = [
    {
      id: "t1",
      projectId: "p1",
      projectName: "Pilot02 Proj",
      status: "CHECKPOINT",
      actionType: "agent_task.develop",
      actionScope: "recover",
      authorizationKind: "DEVELOPMENT",
      checkpointSequence: 1,
      blockReason: "",
      updatedAt: "2026-11-04T12:00:00.000Z",
    },
  ] as AgentTaskSurfaceRow[];
  const items = recommendDayPlan({
    actions,
    agentTasks,
    decisions: [
      {
        id: "d1",
        projectId: "p2",
        projectName: "Ghost Pilot 03 — AI Coding Test",
        title: "Accept MOCK vehicle result?",
        question: "Is the MOCK result sufficient?",
      },
    ],
  });
  const groups = groupDayPlan(items);
  assert.ok(groups.some((group) => group.bucket === "DO_FIRST"));
  assert.ok(groups.some((group) => group.bucket === "LATER"));
  assert.ok(groups.some((group) => group.bucket === "WAITING"));
  const continueItem = items.find((item) => item.sourceId === "t1");
  assert.equal(continueItem?.title, "Continue test run");
  assert.equal(continueItem?.detail, "Saved after step 1");
  assert.match(continueItem?.reason ?? "", /mid-flight|Do first/i);
  const decisionItem = items.find((item) => item.sourceKind === "decision");
  assert.equal(decisionItem?.title, "Accept the vehicle test result?");
  const later = items.find((item) => item.sourceId === "a2");
  assert.equal(later?.estimateMinutes, 5);
  const noEstimate = items.find((item) => item.sourceId === "a1");
  assert.equal(noEstimate?.estimateMinutes, null);
});

test("applyDayPlanPlacements preserves founder reorder before missing sources drop away", () => {
  const recommended = recommendDayPlan({
    actions: [
      {
        id: "a1",
        projectId: "p1",
        projectName: "P",
        title: "One",
        description: "",
        status: "OPEN",
        priority: "NORMAL",
        provenance: "FACT",
        requiresDecision: false,
        sourceKind: "next_action",
      },
      {
        id: "a2",
        projectId: "p1",
        projectName: "P",
        title: "Two",
        description: "",
        status: "OPEN",
        priority: "HIGH",
        provenance: "FACT",
        requiresDecision: false,
        sourceKind: "next_action",
      },
    ],
    agentTasks: [],
    decisions: [],
  });
  const applied = applyDayPlanPlacements(recommended, [
    { id: "next_action:a1", bucket: "DO_FIRST" },
    { id: "next_action:a2", bucket: "LATER" },
    { id: "next_action:missing", bucket: "WAITING" },
  ]);
  assert.deepEqual(
    applied.map((item) => item.id),
    ["next_action:a1", "next_action:a2"],
  );
  assert.equal(applied[0]?.bucket, "DO_FIRST");
  assert.equal(applied[1]?.bucket, "LATER");
});

test("worker assignment preview explains review scope and zero test charge", () => {
  const preview = buildWorkerAssignmentPreview({
    scope: {
      mode: "project",
      projectId: "p1",
      projectName: "Pilot02 Proj",
    },
    agentTasks: [
      {
        id: "t1",
        projectId: "p1",
        projectName: "Pilot02 Proj",
        status: "QUEUED",
        actionType: "agent_task.develop",
        actionScope: "recover",
        authorizationKind: "DEVELOPMENT",
        checkpointSequence: 0,
        blockReason: "",
        updatedAt: "2026-11-04T12:00:00.000Z",
      } as AgentTaskSurfaceRow,
    ],
  });
  assert.equal(preview.taskId, "t1");
  assert.match(preview.chargeLabel, /\$0 charged/i);
  assert.ok(preview.willReturn.some((line) => /saved test result/i.test(line)));
});

test("result labels hide hashes in the headline and keep them in technical details", () => {
  const explained = explainArtifactResult({
    title: "MOCK result · agent_task.develop",
    content: [
      "mode=MOCK_GENERATION",
      "task=abc",
      "checkpoints=4",
      "chargedCents=0",
    ].join("\n"),
    contentSha256: "deadbeefcafebabe",
    kind: "DIFF_SUMMARY",
  });
  assert.equal(explained.headline, "Test run completed");
  assert.match(explained.summary, /4 steps saved/i);
  assert.match(explained.summary, /\$0 charged/i);
  assert.equal(
    (explained.summary.match(/\$0 charged/g) ?? []).length,
    1,
    "charge should appear once in the summary",
  );
  assert.equal(explained.isTestResult, true);
  assert.ok(explained.technicalLines.some((line) => /sha256=deadbeefcafebabe/.test(line)));
  assert.ok(explained.technicalLines.some((line) => /task=abc/.test(line)));
  assert.equal(
    friendlyArtifactTitle({ completed: false, checkpointSequence: 3 }),
    "Saved after step 3",
  );
});
