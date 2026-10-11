import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCarRentalFixtureManifest,
  resolveCarRentalFixtureSource,
  CAR_RENTAL_PILOT_COMMANDS,
} from "./car-rental-fixture";
import { PILOT_02_SOURCE_ATTRIBUTION, PILOT_02_OBJECTIVE } from "./task-contract";

test("car rental validation fixture is present and attributed as Cursor-prepared sample", () => {
  const source = resolveCarRentalFixtureSource();
  const manifest = buildCarRentalFixtureManifest(source);
  assert.equal(manifest.fixtureId, "car-rental-validate");
  assert.ok(manifest.fileCount >= 6);
  assert.ok(manifest.files.some((f) => f.relativePath === "site/index.html"));
  assert.equal(manifest.attribution, "CURSOR_PREPARED_SAMPLE_PLUS_VALIDATION_SCRIPTS");
  assert.equal(PILOT_02_SOURCE_ATTRIBUTION.carRentalSample, "CURSOR_PREPARED");
  assert.equal(PILOT_02_SOURCE_ATTRIBUTION.autonomousCodeGeneration, "NOT_IMPLEMENTED");
  assert.match(PILOT_02_OBJECTIVE, /Validate the previously prepared car rental sample/i);
});

test("car rental pilot commands are argv-only allowlist", () => {
  assert.deepEqual(CAR_RENTAL_PILOT_COMMANDS.validate, ["node", "./validate.mjs"]);
  assert.deepEqual(CAR_RENTAL_PILOT_COMMANDS.build, ["node", "./build.mjs"]);
  for (const command of Object.values(CAR_RENTAL_PILOT_COMMANDS)) {
    assert.ok(command.every((part) => !/[;&|`$]/.test(part)));
  }
});
