import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPriorityCards,
  dueDateLabel,
  groupActivityByDate,
  groupProjectsByStatus,
  isTestSessionExpired,
  pickCurrentWorkerTask,
  primaryWorkerAction,
  workerControlsFor,
} from "./today-board";
import type { AgentTaskSurfaceRow } from "@/lib/operations/agent-task-surface";
import type { ActivityItem } from "@/lib/operations/activity";

test("dueDateLabel marks missing dates clearly", () => {
  assert.equal(dueDateLabel(null), "No due date recorded");
  assert.equal(dueDateLabel(undefined), "No due date recorded");
  assert.equal(dueDateLabel("not-a-date"), "No due date recorded");
});

test("buildPriorityCards always labels missing due dates", () => {
  const cards = buildPriorityCards([
    {
      id: "1",
      projectId: "p1",
      projectName: "Ghost Pilot",
      title: "Ship mock",
      description: "Run mock",
      status: "OPEN",
      priority: "HIGH",
      provenance: "FACT",
      requiresDecision: false,
      sourceKind: "next_action",
    },
  ]);
  assert.equal(cards[0]?.dueLabel, "No due date recorded");
  assert.equal(cards[0]?.projectName, "Ghost Pilot");
});

test("pickCurrentWorkerTask prefers running then blocked then queued", () => {
  const rows = [
    { id: "q", status: "QUEUED", projectId: "p", updatedAt: "2026-01-01" },
    { id: "b", status: "BLOCKED", projectId: "p", updatedAt: "2026-01-02" },
    { id: "r", status: "RUNNING", projectId: "p", updatedAt: "2026-01-03" },
  ] as AgentTaskSurfaceRow[];
  assert.equal(pickCurrentWorkerTask(rows)?.id, "r");
  assert.deepEqual(workerControlsFor("RUNNING"), ["MOCK", "PAUSE", "CANCEL"]);
  assert.deepEqual(workerControlsFor("BLOCKED"), ["RESUME"]);
  assert.deepEqual(workerControlsFor("QUEUED"), ["MOCK", "CANCEL"]);
});

test("expired in-flight sessions hide Continue and Pause", () => {
  assert.equal(
    isTestSessionExpired({ status: "CHECKPOINT", leaseExpiresAt: null }),
    true,
  );
  assert.equal(
    isTestSessionExpired({
      status: "CHECKPOINT",
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
    }),
    false,
  );
  assert.deepEqual(
    workerControlsFor("CHECKPOINT", { leaseExpiresAt: null }),
    ["CANCEL"],
  );
  assert.equal(
    primaryWorkerAction("CHECKPOINT", {
      leaseExpiresAt: null,
      checkpointSequence: 1,
    }),
    "View saved step",
  );
  assert.deepEqual(
    workerControlsFor("RUNNING", {
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
    }),
    ["MOCK", "PAUSE", "CANCEL"],
  );
});

test("groupProjectsByStatus keeps status order and drops empty buckets", () => {
  const groups = groupProjectsByStatus([
    {
      projectId: "1",
      projectName: "A",
      status: "BUILDING",
      nextAction: "Write tests",
      href: "/projects/1",
    },
    {
      projectId: "2",
      projectName: "B",
      status: "BLOCKED",
      nextAction: null,
      href: "/projects/2",
    },
  ]);
  assert.deepEqual(
    groups.map((group) => group.status),
    ["BUILDING", "BLOCKED"],
  );
});

test("groupActivityByDate enriches agent task result links", () => {
  const items: ActivityItem[] = [
    {
      id: "agent-task-act-abc",
      projectId: "p1",
      projectName: "Pilot",
      kind: "agent_task",
      title: "Agent task develop",
      detail: "status SUCCEEDED · DEVELOPMENT · checkpoint 4",
      at: "2026-11-04T15:00:00.000Z",
      href: "/projects/p1/workspace",
    },
  ];
  const groups = groupActivityByDate(items, "UTC");
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.items[0]?.resultHref, "/files");
  assert.match(groups[0]?.items[0]?.href ?? "", /task=abc/);
});
