import assert from "node:assert/strict";
import test from "node:test";
import { scopeFingerprint } from "@/lib/approvals/workflow";
import { bindAgentTaskAuthorization, assertBindingMatchesAuthorization } from "./binding";
import { AUTH_ID, makeAuth, OTHER_PROJECT_ID, OWNER_ID, PROJECT_ID } from "./test-helpers";

test("binds approved development authorization with matching fingerprint", () => {
  const auth = makeAuth({
    status: "APPROVED",
    actionType: "agent_task.develop",
    actionScope: "module:agent-runtime",
    environmentLabel: "LOCAL",
  });
  const result = bindAgentTaskAuthorization({
    authorization: auth,
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    actionType: "agent_task.develop",
    actionScope: "module:agent-runtime",
    environmentLabel: "LOCAL",
    authorizationKind: "DEVELOPMENT",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.binding.authorizationId, AUTH_ID);
    assert.equal(result.binding.authorizationKind, "DEVELOPMENT");
    assert.equal(
      result.binding.scopeFingerprint,
      scopeFingerprint({
        projectId: PROJECT_ID,
        actionType: "agent_task.develop",
        actionScope: "module:agent-runtime",
        environmentLabel: "LOCAL",
      }),
    );
  }
});

test("cross-project isolation fails closed", () => {
  const auth = makeAuth({
    status: "APPROVED",
    actionType: "agent_task.develop",
    actionScope: "module:agent-runtime",
    environmentLabel: "LOCAL",
  });
  const result = bindAgentTaskAuthorization({
    authorization: auth,
    ownerId: OWNER_ID,
    projectId: OTHER_PROJECT_ID,
    actionType: "agent_task.develop",
    actionScope: "module:agent-runtime",
    environmentLabel: "LOCAL",
    authorizationKind: "DEVELOPMENT",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "PROJECT_MISMATCH");
});

test("owner mismatch and scope mismatch fail closed", () => {
  const auth = makeAuth({
    status: "APPROVED",
    actionType: "agent_task.develop",
    actionScope: "module:agent-runtime",
    environmentLabel: "LOCAL",
  });
  const owner = bindAgentTaskAuthorization({
    authorization: auth,
    ownerId: "99999999-9999-9999-9999-999999999999",
    projectId: PROJECT_ID,
    actionType: "agent_task.develop",
    actionScope: "module:agent-runtime",
    environmentLabel: "LOCAL",
    authorizationKind: "DEVELOPMENT",
  });
  assert.equal(owner.ok, false);
  if (!owner.ok) assert.equal(owner.reason, "OWNER_MISMATCH");

  const scope = bindAgentTaskAuthorization({
    authorization: auth,
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    actionType: "agent_task.develop",
    actionScope: "module:changed",
    environmentLabel: "LOCAL",
    authorizationKind: "DEVELOPMENT",
  });
  assert.equal(scope.ok, false);
  if (!scope.ok) assert.equal(scope.reason, "SCOPE_MISMATCH");
});

test("immutable fingerprint mismatch fails closed", () => {
  const auth = makeAuth({
    status: "APPROVED",
    actionType: "agent_task.develop",
    actionScope: "module:agent-runtime",
    environmentLabel: "LOCAL",
    scopeFingerprint: "0".repeat(64),
  });
  const result = bindAgentTaskAuthorization({
    authorization: auth,
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    actionType: "agent_task.develop",
    actionScope: "module:agent-runtime",
    environmentLabel: "LOCAL",
    authorizationKind: "DEVELOPMENT",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "FINGERPRINT_MISMATCH");
});

test("development authorization cannot bind a deployment task", () => {
  const auth = makeAuth({
    status: "APPROVED",
    actionType: "agent_task.develop",
    actionScope: "module:agent-runtime",
    environmentLabel: "LOCAL",
  });
  const result = bindAgentTaskAuthorization({
    authorization: auth,
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    actionType: "agent_task.deploy",
    actionScope: "module:agent-runtime",
    environmentLabel: "LOCAL",
    authorizationKind: "DEPLOYMENT",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(
      result.reason === "DEVELOPMENT_NOT_AUTHORIZED" ||
        result.reason === "DEPLOYMENT_NOT_AUTHORIZED" ||
        result.reason === "KIND_MISMATCH" ||
        result.reason === "SCOPE_MISMATCH",
    );
  }
});

test("expired revoked consumed and one-time exhausted authorizations cannot bind", () => {
  const cases = [
    {
      name: "expired",
      auth: makeAuth({
        status: "APPROVED",
        actionType: "agent_task.develop",
        actionScope: "x",
        environmentLabel: "LOCAL",
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
      reason: "EXPIRED",
    },
    {
      name: "revoked",
      auth: makeAuth({
        status: "REVOKED",
        actionType: "agent_task.develop",
        actionScope: "x",
        environmentLabel: "LOCAL",
      }),
      reason: "REVOKED",
    },
    {
      name: "consumed",
      auth: makeAuth({
        status: "CONSUMED",
        actionType: "agent_task.develop",
        actionScope: "x",
        environmentLabel: "LOCAL",
        useCount: 1,
      }),
      reason: "CONSUMED",
    },
    {
      name: "uses",
      auth: makeAuth({
        status: "APPROVED",
        actionType: "agent_task.develop",
        actionScope: "x",
        environmentLabel: "LOCAL",
        useCount: 1,
      }),
      reason: "USES_EXHAUSTED",
    },
  ] as const;

  for (const item of cases) {
    const result = bindAgentTaskAuthorization({
      authorization: item.auth,
      ownerId: OWNER_ID,
      projectId: PROJECT_ID,
      actionType: "agent_task.develop",
      actionScope: "x",
      environmentLabel: "LOCAL",
      authorizationKind: "DEVELOPMENT",
    });
    assert.equal(result.ok, false, item.name);
    if (!result.ok) assert.equal(result.reason, item.reason, item.name);
  }
});

test("assertBindingMatchesAuthorization re-checks live authorization identity", () => {
  const auth = makeAuth({
    status: "APPROVED",
    actionType: "agent_task.develop",
    actionScope: "module:agent-runtime",
    environmentLabel: "LOCAL",
  });
  const bound = bindAgentTaskAuthorization({
    authorization: auth,
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    actionType: "agent_task.develop",
    actionScope: "module:agent-runtime",
    environmentLabel: "LOCAL",
    authorizationKind: "DEVELOPMENT",
  });
  assert.equal(bound.ok, true);
  if (!bound.ok) return;

  const ok = assertBindingMatchesAuthorization(bound.binding, auth);
  assert.equal(ok.ok, true);

  const revoked = assertBindingMatchesAuthorization(bound.binding, {
    ...auth,
    status: "REVOKED",
    effectiveStatus: "REVOKED",
  });
  assert.equal(revoked.ok, false);
  if (!revoked.ok) assert.equal(revoked.reason, "REVOKED");
});
