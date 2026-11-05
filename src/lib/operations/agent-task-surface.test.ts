import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createBoundAgentTask } from "@/lib/agent-runtime/workflow";
import { makeAuth, OWNER_ID, PROJECT_ID } from "@/lib/agent-runtime/test-helpers";
import {
  countActiveAgentTasks,
  projectAgentTasksToActivity,
  projectAgentTasksToTodayActions,
  surfaceRowFromTask,
} from "./agent-task-surface";

function sampleRows() {
  const auth = makeAuth({
    status: "APPROVED",
    actionType: "agent_task.develop",
    actionScope: "ops-surface",
    environmentLabel: "LOCAL",
  });
  const created = createBoundAgentTask({
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    authorization: auth,
    authorizationKind: "DEVELOPMENT",
    actionType: "agent_task.develop",
    actionScope: "ops-surface",
    environmentLabel: "LOCAL",
    idempotencyKey: "ops-surface-001",
  });
  if (!created.ok) {
    assert.fail(created.message);
  }
  const running = {
    ...created.task,
    status: "CHECKPOINT" as const,
    checkpointSequence: 2,
    claimedAt: new Date().toISOString(),
  };
  const blocked = {
    ...created.task,
    id: "blocked-task",
    status: "BLOCKED" as const,
    blockReason: "REVOKED",
    claimedAt: new Date().toISOString(),
  };
  return [
    surfaceRowFromTask(running, "Ghost"),
    surfaceRowFromTask(blocked, "Ghost"),
  ];
}

test("projects genuine agent tasks to today actions without fake percentages", () => {
  const actions = projectAgentTasksToTodayActions(sampleRows());
  assert.equal(actions.length, 2);
  assert.ok(actions.every((a) => a.provenance === "FACT"));
  assert.ok(actions.every((a) => a.sourceKind === "agent_task"));
  assert.ok(actions.some((a) => a.status === "IN_PROGRESS" && /checkpoint 2/.test(a.description)));
  assert.ok(actions.some((a) => a.status === "BLOCKED" && a.requiresDecision));
  assert.ok(!actions.some((a) => /%|velocity|Tasks completed/i.test(`${a.title} ${a.description}`)));
});

test("activity projection uses recorded status only", () => {
  const items = projectAgentTasksToActivity(sampleRows());
  assert.equal(items.length, 2);
  assert.ok(items.every((item) => item.kind === "agent_task"));
  assert.equal(countActiveAgentTasks(sampleRows()), 2);
});

test("dashboard wires agent-task surface without importing agent-runtime", () => {
  const page = readFileSync(new URL("../../app/(workspace)/dashboard/page.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("loadAgentTaskSurface"));
  assert.ok(page.includes("projectAgentTasksToTodayActions"));
  assert.ok(!page.includes("@/lib/agent-runtime"));
  assert.ok(!/78\s*%|fake progress/i.test(page));
});

test("settings status stays disabled and secret-free", () => {
  const status = readFileSync(new URL("../preferences/status.ts", import.meta.url), "utf8");
  assert.ok(!status.includes("@/lib/agent-runtime"));
  assert.ok(status.includes('agentExecution: "DISABLED"'));
});
