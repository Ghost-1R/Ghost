import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hourBucketKey,
  isWorkerOnDuty,
  onDutyWorker,
  scheduledIdempotencyKey,
} from "./schedule";

function etDate(isoLocalHint: string): Date {
  // Construct a UTC instant and assert duty via known ET offsets carefully:
  // Use fixed UTC times that map to ET hour buckets (EST = UTC-5 in winter).
  return new Date(isoLocalHint);
}

test("Will covers 8am–8pm ET and Bubba covers nights including weekends", () => {
  // 2026-11-07 is Saturday. 15:00 UTC = 10:00 EST → Will
  assert.equal(onDutyWorker(etDate("2026-11-07T15:00:00.000Z")), "will");
  assert.equal(isWorkerOnDuty("will", etDate("2026-11-07T15:00:00.000Z")), true);
  // 01:00 UTC = 20:00 EST previous calendar evening → Bubba
  assert.equal(onDutyWorker(etDate("2026-11-08T01:00:00.000Z")), "bubba");
  // 12:00 UTC = 07:00 EST → Bubba
  assert.equal(onDutyWorker(etDate("2026-11-08T12:00:00.000Z")), "bubba");
});

test("scheduled idempotency key is stable within the same ET hour", () => {
  const a = etDate("2026-11-07T15:10:00.000Z");
  const b = etDate("2026-11-07T15:50:00.000Z");
  assert.equal(hourBucketKey(a), hourBucketKey(b));
  assert.equal(scheduledIdempotencyKey(a), scheduledIdempotencyKey(b));
  assert.match(scheduledIdempotencyKey(a), /^lead-find:.*:will:schedule$/);
});
