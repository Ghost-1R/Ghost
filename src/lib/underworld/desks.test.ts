import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deskActivityLabel,
  deskMonitorActivity,
  preferredCrewForDepartment,
} from "./desks";

test("desk monitor activity maps run and approval states", () => {
  assert.equal(deskMonitorActivity({ taskStatus: "RUNNING" }), "active");
  assert.equal(deskMonitorActivity({ taskStatus: "CHECKPOINT" }), "active");
  assert.equal(deskMonitorActivity({ taskStatus: "QUEUED" }), "idle");
  assert.equal(
    deskMonitorActivity({ taskStatus: "BLOCKED", blockReason: "Need founder approval" }),
    "blocked",
  );
  assert.equal(
    deskMonitorActivity({ assignmentStatus: "IN_REVIEW", taskStatus: "SUCCEEDED" }),
    "awaiting_approval",
  );
  assert.equal(deskActivityLabel("active"), "Run in progress");
});

test("department preference keeps two engineering workers distinct", () => {
  assert.equal(preferredCrewForDepartment("engineering", "AI"), "nova");
  assert.equal(preferredCrewForDepartment("planning", "HUMAN"), "atlas");
  assert.equal(preferredCrewForDepartment("review"), "sage");
  assert.equal(preferredCrewForDepartment("team"), "reed");
});
