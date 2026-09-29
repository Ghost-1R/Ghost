import assert from "node:assert/strict";
import test from "node:test";
import { detectStateDrift, parseGhostMarkdown } from "./drift";
import { exportProjectState } from "./export-state";
import type { GhostContext } from "./types";

test("markdown milestone and status are read without rewriting", () => {
  const snapshot = parseGhostMarkdown(`## Current Milestone\n\nAlpha Foundation\n\n## Status\n\nBUILDING\n\nProduction:\nNOT_DEPLOYED\n`);
  assert.deepEqual(snapshot, {
    milestone: "Alpha Foundation",
    status: "BUILDING",
    production: "NOT_DEPLOYED",
  });
});

test("drift reports disagreement and does not choose a winner", () => {
  const report = detectStateDrift(
    { milestone: "Alpha Foundation", status: "BUILDING", production: "NOT_DEPLOYED" },
    { milestone: "Project Brain", status: "BUILDING", production: null },
  );

  assert.equal(report.drifted, true);
  assert.deepEqual(
    report.fields.map((field) => field.field),
    ["milestone", "production"],
  );
});

test("export preview contains state and no completion percentage", () => {
  const context: GhostContext = {
    scope: "project",
    project: {
      id: "1",
      name: "GHOST",
      description: "Second mind",
      status: "BUILDING",
      currentMilestone: "Project Brain",
      repositoryProvider: null,
      repositoryUrl: null,
      repositoryBranch: null,
      repositoryCommit: null,
    },
    projects: [],
    milestone: { title: "Project Brain", status: "BUILDING" },
    requirements: [{ title: "Records", content: "Use records." }],
    decisions: [],
    constraints: [],
    blockers: [{ title: "Signup", content: "Rate limit" }],
    nextActions: [{ title: "Ask", content: "From records" }],
    verification: [
      { category: "PRODUCTION", target: "Production", state: "NOT_VERIFIED", supported: false, checkedAt: null },
    ],
    founderRules: [],
    truncated: false,
  };

  const exported = exportProjectState(context);
  assert.match(exported.markdown, /Project Brain/);
  assert.equal(exported.markdown.includes("%"), false);
  assert.equal(exported.json.includes("NOT_VERIFIED"), true);
});
