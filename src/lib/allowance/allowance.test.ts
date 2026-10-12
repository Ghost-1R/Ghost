import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { MemoryAllowanceLedger } from "./memory-store";
import { availableCents, centsToUsdDisplay } from "./types";

test("available cents and display", () => {
  assert.equal(availableCents({ allowanceCents: 2000, chargedCents: 300, reservedCents: 200 }), 1500);
  assert.equal(centsToUsdDisplay(1500), "$15.00");
});

test("reserve / reconcile / release and fail closed", () => {
  const ledger = new MemoryAllowanceLedger();
  const ownerId = randomUUID();
  const projectId = randomUUID();
  const other = randomUUID();

  assert.equal(ledger.setAllowance({ ownerId, projectId, allowanceCents: 2000 }).ok, true);

  const cross = ledger.reserve({
    ownerId: other,
    projectId,
    taskKey: "task-cross-01",
    estimatedCents: 100,
    idempotencyKey: "idem-cross",
  });
  assert.equal(cross.ok, false);

  const a = ledger.reserve({
    ownerId,
    projectId,
    taskKey: "task-a-0001",
    estimatedCents: 200,
    idempotencyKey: "idem-a",
  });
  assert.equal(a.ok, true);
  if (!a.ok) return;
  assert.equal(a.snapshot.availableCents, 1800);

  const dup = ledger.reserve({
    ownerId,
    projectId,
    taskKey: "task-a-0001",
    estimatedCents: 100,
    idempotencyKey: "idem-a2",
  });
  assert.equal(dup.ok, false);

  const idem = ledger.reserve({
    ownerId,
    projectId,
    taskKey: "task-b-0001",
    estimatedCents: 100,
    idempotencyKey: "idem-a",
  });
  assert.equal(idem.ok, true);
  if (idem.ok) assert.equal(idem.reservation.id, a.reservation.id);

  const over = ledger.reserve({
    ownerId,
    projectId,
    taskKey: "task-huge-01",
    estimatedCents: 5000,
    idempotencyKey: "idem-huge",
  });
  assert.equal(over.ok, false);

  const concurrent = [
    ledger.reserve({
      ownerId,
      projectId,
      taskKey: "task-c1-0001",
      estimatedCents: 1000,
      idempotencyKey: "idem-c1",
    }),
    ledger.reserve({
      ownerId,
      projectId,
      taskKey: "task-c2-0001",
      estimatedCents: 1000,
      idempotencyKey: "idem-c2",
    }),
  ];
  const wins = concurrent.filter((r) => r.ok);
  // 1800 available after first reserve of 200 → only one 1000 reserve fits fully; second may also fit (800 left? wait 1800-1000=800, second 1000 fails)
  assert.equal(wins.length, 1);

  const snap = ledger.snapshot(ownerId, projectId)!;
  const open = a.reservation;
  const exceed = ledger.reconcile({
    ownerId,
    reservationId: open.id,
    actualCents: open.estimatedCents + 1,
    idempotencyKey: "charge-bad",
  });
  assert.equal(exceed.ok, false);

  const charged = ledger.reconcile({
    ownerId,
    reservationId: open.id,
    actualCents: 50,
    idempotencyKey: "charge-a",
  });
  assert.equal(charged.ok, true);
  if (charged.ok) {
    assert.equal(charged.snapshot.chargedCents, 50);
  }

  const again = ledger.reconcile({
    ownerId,
    reservationId: open.id,
    actualCents: 50,
    idempotencyKey: "charge-a",
  });
  assert.equal(again.ok, true);

  // New reserve then release
  const r2 = ledger.reserve({
    ownerId,
    projectId,
    taskKey: "task-rel-0001",
    estimatedCents: 100,
    idempotencyKey: "idem-rel",
  });
  assert.equal(r2.ok, true);
  if (!r2.ok) return;
  const released = ledger.release({
    ownerId,
    reservationId: r2.reservation.id,
    idempotencyKey: "rel-1",
  });
  assert.equal(released.ok, true);
  assert.ok(ledger.listEvents(ownerId, projectId).length >= 3);
  void snap;
});
