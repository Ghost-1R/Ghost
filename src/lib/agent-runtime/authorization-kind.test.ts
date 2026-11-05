import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAuthorizationKindCompatible,
  classifyAgentActionType,
  developmentApprovalGrantsDeployment,
} from "./authorization-kind";

test("classifies canonical development and deployment action types", () => {
  assert.equal(classifyAgentActionType("agent_task.develop"), "DEVELOPMENT");
  assert.equal(classifyAgentActionType("agent_task.implement"), "DEVELOPMENT");
  assert.equal(classifyAgentActionType("agent_task.deploy"), "DEPLOYMENT");
  assert.equal(classifyAgentActionType("agent_task.release"), "DEPLOYMENT");
  assert.equal(classifyAgentActionType("start_deployment"), null);
  assert.equal(classifyAgentActionType("synthetic_local_action"), null);
});

test("development approval never grants deployment permission", () => {
  assert.equal(developmentApprovalGrantsDeployment("agent_task.develop", "DEPLOYMENT"), false);
  assert.equal(developmentApprovalGrantsDeployment("agent_task.deploy", "DEPLOYMENT"), true);
  assert.equal(developmentApprovalGrantsDeployment("agent_task.develop", "DEVELOPMENT"), false);
});

test("kind compatibility fails closed across development and deployment", () => {
  assert.deepEqual(assertAuthorizationKindCompatible("DEVELOPMENT", "agent_task.develop"), { ok: true });
  assert.deepEqual(assertAuthorizationKindCompatible("DEPLOYMENT", "agent_task.deploy"), { ok: true });

  const cross = assertAuthorizationKindCompatible("DEPLOYMENT", "agent_task.develop");
  assert.equal(cross.ok, false);
  if (!cross.ok) assert.equal(cross.reason, "DEPLOYMENT_NOT_AUTHORIZED");

  const reverse = assertAuthorizationKindCompatible("DEVELOPMENT", "agent_task.deploy");
  assert.equal(reverse.ok, false);
  if (!reverse.ok) assert.equal(reverse.reason, "DEVELOPMENT_NOT_AUTHORIZED");

  const unknown = assertAuthorizationKindCompatible("DEVELOPMENT", "start_deployment");
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.reason, "UNKNOWN_ACTION_TYPE");
});
