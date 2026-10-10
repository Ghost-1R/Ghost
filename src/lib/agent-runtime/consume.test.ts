import assert from "node:assert/strict";
import test from "node:test";
import { planAuthorizationConsumption, simulateConcurrentOneTimeConsumption } from "./consume";

test("one-time consumption plans CONSUMED with CAS on status+use_count", () => {
  const plan = planAuthorizationConsumption({
    authorizationId: "a",
    observedStatus: "APPROVED",
    observedUseCount: 0,
    reusePolicy: "ONE_TIME",
    maxUses: null,
  });
  assert.equal(plan.ok, true);
  if (plan.ok) {
    assert.equal(plan.nextStatus, "CONSUMED");
    assert.equal(plan.nextUseCount, 1);
    assert.equal(plan.consumeFully, true);
    assert.deepEqual(plan.cas, { status: "APPROVED", useCount: 0 });
  }
});

test("concurrent one-time consumers: exactly one winner under CAS", () => {
  const result = simulateConcurrentOneTimeConsumption(8, 0);
  assert.equal(result.winners, 1);
  assert.equal(result.losers, 7);
  assert.equal(result.finalStatus, "CONSUMED");
  assert.equal(result.finalUseCount, 1);
});

test("already consumed and non-approved fail closed", () => {
  assert.equal(
    planAuthorizationConsumption({
      authorizationId: "a",
      observedStatus: "CONSUMED",
      observedUseCount: 1,
      reusePolicy: "ONE_TIME",
      maxUses: null,
    }).ok,
    false,
  );
  assert.equal(
    planAuthorizationConsumption({
      authorizationId: "a",
      observedStatus: "REVOKED",
      observedUseCount: 0,
      reusePolicy: "ONE_TIME",
      maxUses: null,
    }).ok,
    false,
  );
});

test("bounded reuse records intermediate uses without full consume until max", () => {
  const first = planAuthorizationConsumption({
    authorizationId: "a",
    observedStatus: "APPROVED",
    observedUseCount: 0,
    reusePolicy: "BOUNDED",
    maxUses: 2,
  });
  assert.equal(first.ok, true);
  if (first.ok) {
    assert.equal(first.nextStatus, "APPROVED");
    assert.equal(first.consumeFully, false);
  }
  const last = planAuthorizationConsumption({
    authorizationId: "a",
    observedStatus: "APPROVED",
    observedUseCount: 1,
    reusePolicy: "BOUNDED",
    maxUses: 2,
  });
  assert.equal(last.ok, true);
  if (last.ok) {
    assert.equal(last.nextStatus, "CONSUMED");
    assert.equal(last.consumeFully, true);
  }
});
