import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { actionFingerprint } from "@/lib/inspector/approval";
import { approvalVoidReason } from "./approval-binding";
import { classifyOperationRisk, classifyPathRisk, raiseRisk } from "./change-risk";
import { evidenceFreshness } from "./freshness";
import { classifyRequirementScope, customerHandoff, derivePresentation, traceRequirement } from "./gate";
import { layoutIssues } from "./layout-issues";
import { appendEvidence, createOverride, listEvidence, outputHash } from "./ledger";
import { computePresentationReview, prepareApproval, prepareEvidence, prepareOverride, rejectedClientEvidence } from "./records";
import { remoteWriterStatus } from "./remote";
import { buildPresentationReview, regressionFindings } from "./review";
import { hashTreeContents } from "./tree";
import type { ApprovalRecord, EvidenceRecord } from "./types";

const ownerA = "18cc1011-3b62-4dba-8359-1b77c37f2118";
const ownerB = "d1b38554-5dae-4112-9e14-8baaa05181cf";
const projectId = "7f252953-ecab-4b5e-9762-5f3fe1c6a45d";
const commit = "e271572581a5d29107d4f66bfad9bba0b501bb13";
const tree = "abc123";

function evidence(checkType: EvidenceRecord["checkType"], status: EvidenceRecord["status"] = "passed"): EvidenceRecord {
  return {
    id: `${checkType}-${status}`,
    ownerId: ownerA,
    projectId,
    runId: "run-1",
    checkType,
    commitSha: commit,
    treeHash: tree,
    command: checkType,
    exitCode: status === "passed" ? 0 : 1,
    durationMs: 10,
    outputHash: "hash",
    logExcerpt: "ok",
    runner: "inspector",
    environment: "local",
    status,
    createdAt: "2026-09-29T06:00:00.000Z",
  };
}

function readyEvidence(): EvidenceRecord[] {
  return ["lint", "typecheck", "test", "build", "security", "customer_flows", "responsive", "requirements"].map((check) =>
    evidence(check as EvidenceRecord["checkType"]),
  );
}

test("tree hash changes with content and does not read secret files", () => {
  const first = hashTreeContents([
    { path: "src/app.tsx", content: Buffer.from("one") },
    { path: ".env.local", content: Buffer.from("OPENAI_API_KEY=sk-test-secret-value-xxxx") },
  ]);
  const second = hashTreeContents([
    { path: "src/app.tsx", content: Buffer.from("two") },
    { path: ".env.local", content: Buffer.from("OPENAI_API_KEY=sk-test-secret-value-xxxx") },
  ]);
  const secretOnly = hashTreeContents([{ path: ".env.local", content: Buffer.from("OPENAI_API_KEY=sk-other") }]);
  assert.notEqual(first, second);
  assert.equal(first.includes("sk-test"), false);
  assert.equal(secretOnly, hashTreeContents([]));
});

test("evidence is append-only and clients or the model cannot write it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ghost-presentation-"));
  try {
    const input = {
      ownerId: ownerA,
      projectId,
      runId: "run-1",
      checkType: "lint" as const,
      commitSha: commit,
      treeHash: tree,
      command: "npm run lint",
      exitCode: 0,
      durationMs: 5,
      output: "authorization: Bearer sk-test-secret-value-xxxx\n" + "x".repeat(800),
      environment: "local" as const,
      status: "passed" as const,
      createdAt: "2026-09-29T06:00:00.000Z",
    };
    assert.equal(await appendEvidence(root, "client", input), null);
    assert.equal(await appendEvidence(root, "llm", input), null);
    assert.equal((await listEvidence(root, ownerA)).length, 0);
    const first = await appendEvidence(root, "runner", input);
    const second = await appendEvidence(root, "runner", { ...input, runId: "run-2", status: "failed" });
    const rows = await listEvidence(root, ownerA);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.id, first?.id);
    assert.equal(rows[1]?.id, second?.id);
    assert.equal(rows[0]?.logExcerpt.includes("sk-test-secret-value-xxxx"), false);
    assert.ok((rows[0]?.logExcerpt.length ?? 0) < 600);
    assert.equal(rows[0]?.outputHash, outputHash(input.output));
    assert.equal((await listEvidence(root, ownerB)).length, 0);
    const raw = await readFile(path.join(root, `${ownerA}.json`), "utf8");
    assert.equal(raw.includes("sk-test-secret-value-xxxx"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("freshness follows commit and tree hash", () => {
  const row = evidence("build");
  assert.equal(evidenceFreshness(row, { commitSha: commit, treeHash: tree }), "fresh");
  assert.equal(evidenceFreshness(row, { commitSha: "other", treeHash: tree }), "stale");
  assert.equal(evidenceFreshness(row, { commitSha: commit, treeHash: "other" }), "stale");
});

test("risk is deterministic, unknown is high, and the model cannot lower it", () => {
  assert.equal(classifyOperationRisk("docs", ["README.md"]), "SAFE");
  assert.equal(classifyOperationRisk("refactor", ["src/lib/foo.ts"]), "CAUTION");
  assert.equal(classifyPathRisk(["supabase/migrations/20260929180000_presentation_gate.sql"]), "HIGH");
  assert.equal(classifyOperationRisk("payment", ["src/ui.tsx"]), "HIGH");
  assert.equal(classifyOperationRisk("surprise-operation", ["README.md"]), "HIGH");
  assert.equal(raiseRisk("HIGH", "SAFE"), "HIGH");
  assert.equal(raiseRisk("CAUTION", "HIGH"), "HIGH");
});

test("approval is void when the commit, fingerprint, or expiry changes", () => {
  const parameters = { migration: "20260929180000_presentation_gate.sql" };
  const approval: ApprovalRecord = {
    id: "approval-1",
    ownerId: ownerA,
    projectId,
    operation: "migration",
    target: "20260929180000_presentation_gate.sql",
    commitSha: commit,
    riskLevel: "HIGH",
    evidenceIdsShown: ["lint-passed"],
    approvedBy: ownerA,
    approvedAt: "2026-09-29T06:00:00.000Z",
    expiresAt: "2026-09-29T07:00:00.000Z",
    fingerprint: actionFingerprint({
      actionType: "migration",
      target: "20260929180000_presentation_gate.sql",
      parameters,
      projectId,
    }),
  };
  const base = { operation: "migration", target: approval.target, parameters, projectId, commitSha: commit };
  assert.equal(approvalVoidReason(approval, base, "2026-09-29T06:30:00.000Z"), null);
  assert.equal(approvalVoidReason(approval, { ...base, commitSha: "other" }, "2026-09-29T06:30:00.000Z"), "commit");
  assert.equal(
    approvalVoidReason(approval, { ...base, parameters: { migration: "other.sql" } }, "2026-09-29T06:30:00.000Z"),
    "fingerprint",
  );
  assert.equal(approvalVoidReason(approval, base, "2026-09-29T08:00:00.000Z"), "expired");
  assert.equal(createOverride({ ownerId: ownerA, projectId, reason: "short", founderId: ownerA, target: "x", commitSha: commit, affectedChecks: [] }), null);
  assert.ok(createOverride({ ownerId: ownerA, projectId, reason: "Founder accepts this local gap.", founderId: ownerA, target: "responsive", commitSha: commit, affectedChecks: ["responsive"] }));
});

test("presentation is ready only when required fresh evidence exists", () => {
  const current = { commitSha: commit, treeHash: tree };
  const ready = derivePresentation({
    evidence: readyEvidence(),
    current,
    environment: "local",
    presentingProduction: false,
    findings: [],
    traceability: [],
  });
  assert.equal(ready.result, "READY");
  const gaps = derivePresentation({
    evidence: readyEvidence(),
    current,
    environment: "local",
    presentingProduction: false,
    findings: [
      {
        severity: "LOW",
        category: "accessibility",
        description: "Optional contrast audit was not run.",
        evidence: "No contrast evidence.",
        recommendedFix: "Run the optional audit later.",
        verificationNeeded: "Optional.",
      },
    ],
    traceability: [],
  });
  assert.equal(gaps.result, "READY_WITH_GAPS");
  const failed = derivePresentation({
    evidence: readyEvidence(),
    current,
    environment: "local",
    presentingProduction: false,
    findings: [],
    traceability: [{ requirement: "Disposable presentation requirement", implementationEvidence: null, verificationEvidence: null, status: "FAIL" }],
  });
  assert.equal(failed.result, "NOT_READY");
  const stale = derivePresentation({
    evidence: readyEvidence(),
    current: { commitSha: "other", treeHash: tree },
    environment: "local",
    presentingProduction: false,
    findings: [],
    traceability: [],
  });
  assert.equal(stale.result, "NOT_READY");
  assert.ok(stale.stale.includes("build"));
  const security = derivePresentation({
    evidence: readyEvidence().filter((row) => row.checkType !== "security"),
    current,
    environment: "local",
    presentingProduction: false,
    findings: [],
    traceability: [],
  });
  assert.equal(security.result, "NOT_READY");
  const production = derivePresentation({
    evidence: readyEvidence(),
    current,
    environment: "production",
    presentingProduction: true,
    findings: [],
    traceability: [],
  });
  assert.equal(production.result, "NOT_READY");
  assert.ok(production.missing.includes("prod_health"));
});

test("a fixed bug without regression evidence blocks a ready presentation", () => {
  const findings = regressionFindings([{ title: "Checkout total" }], []);
  assert.equal(findings[0]?.severity, "HIGH");
  const review = buildPresentationReview({
    ownerId: ownerA,
    projectId,
    commitSha: commit,
    treeHash: tree,
    environment: "local",
    presentingProduction: false,
    evidence: readyEvidence(),
    requirements: [],
    resolvedBugs: [{ title: "Checkout total" }],
  });
  assert.equal(review.result, "NOT_READY");
  assert.match(review.fixQueue[0]?.description ?? "", /Checkout total/);
});

test("responsive layout issues come from rendered measurements", () => {
  const clean = layoutIssues({
    viewport: "mobile",
    path: "/dashboard",
    landed: "/dashboard",
    overflow: false,
    clipped: [],
    menuVisible: true,
    navVisible: 0,
    textLength: 80,
    email: false,
    password: false,
    signIn: false,
    ask: false,
  }, "app");
  assert.equal(clean.length, 0);
  const overflow = layoutIssues({
    viewport: "desktop",
    path: "/login",
    landed: "/login",
    overflow: true,
    clipped: ["Sign in"],
    menuVisible: false,
    navVisible: 0,
    textLength: 40,
    email: true,
    password: true,
    signIn: true,
    ask: false,
  }, "login");
  assert.match(overflow.join(" "), /horizontal overflow/);
  assert.match(overflow.join(" "), /clipped controls/);
});

test("future requirements stay visible and do not become verified", () => {
  assert.equal(classifyRequirementScope("Future Inspector", "Automated inspection is not part of this milestone."), "future");
  assert.equal(classifyRequirementScope("Project Brain", "Answer what we are building."), "current");
  const deferred = traceRequirement({
    title: "Future Inspector",
    scope: "future",
    implementationEvidence: "src/lib/inspector",
    verificationEvidence: "npm test",
  });
  assert.equal(deferred.status, "FUTURE_SCOPE");
  assert.equal(deferred.implementationEvidence, null);
  const requiredLater = traceRequirement({
    title: "Future Inspector",
    scope: "future",
    requiredNow: true,
  });
  assert.equal(requiredLater.status, "NOT_VERIFIED");
  const current = { commitSha: commit, treeHash: tree };
  const review = derivePresentation({
    evidence: readyEvidence(),
    current,
    environment: "local",
    presentingProduction: false,
    findings: [],
    traceability: [deferred],
  });
  assert.equal(review.result, "READY");
  assert.match(review.gaps.join(" "), /Future scope: Future Inspector/);
  const observed = derivePresentation({
    evidence: readyEvidence(),
    current,
    environment: "local",
    presentingProduction: false,
    findings: [],
    traceability: [{ requirement: "Project Brain", implementationEvidence: "queries.ts", verificationEvidence: null, status: "OBSERVED" }],
  });
  assert.equal(observed.result, "NOT_READY");
});

test("customer handoff is withheld unless the current review is ready", () => {
  assert.equal(customerHandoff({ result: "NOT_READY", current: true, built: [], completedRequirements: [], flows: [], responsive: [], deployment: null, limitations: [], demo: [] }), null);
  const summary = customerHandoff({
    result: "READY",
    current: true,
    built: ["Project brain"],
    completedRequirements: ["Requirements"],
    flows: ["Sign in"],
    responsive: ["mobile", "tablet", "desktop"],
    deployment: null,
    limitations: ["password=hunter2"],
    demo: ["Open the project"],
  });
  assert.match(summary ?? "", /Project brain/);
  assert.equal(summary?.includes("hunter2"), false);
});

test("the presentation migration does not grant clients evidence writes", async () => {
  const sql = await readFile(path.join(process.cwd(), "supabase/migrations/20260929180000_presentation_gate.sql"), "utf8");
  assert.match(sql, /inspection_evidence_select/);
  assert.equal(/create policy inspection_evidence_insert/i.test(sql), false);
  assert.equal(/for update/i.test(sql), false);
  assert.equal(/for delete/i.test(sql), false);
  assert.equal(/for insert/i.test(sql), false);
  assert.match(sql, /grant select on public\.inspection_evidence to authenticated/);
  assert.match(sql, /grant select, insert on public\.inspection_evidence to service_role/);
  assert.equal(/grant insert on public\.inspection_evidence to authenticated/i.test(sql), false);
  assert.equal(/grant insert on public\.inspection_evidence to anon/i.test(sql), false);
  assert.match(sql, /force row level security/);
  assert.equal(/on delete cascade/i.test(sql), false);
  assert.match(sql, /on delete restrict/);
  assert.match(sql, /before update or delete on public\.inspection_evidence/);
  assert.match(sql, /before truncate on public\.inspection_evidence/);
  assert.match(sql, /disable trigger inspection_evidence_append_only/);
  assert.equal(/security definer/i.test(sql), true);
});

test("evidence, approval, override, and presentation results stay server-owned", () => {
  const runner = prepareEvidence({
    writer: "runner",
    ownerId: ownerA,
    projectId,
    runId: "11111111-1111-4111-8111-111111111111",
    checkType: "lint",
    commitSha: commit,
    treeHash: "a".repeat(64),
    command: "npm run lint",
    exitCode: 0,
    durationMs: 5,
    output: "authorization: Bearer sk-test-secret-value-xxxx",
    environment: "local",
    status: "passed",
    createdAt: "2026-09-29T06:00:00.000Z",
  });
  assert.equal(runner.ok, true);
  if (runner.ok) {
    assert.equal(runner.value.logExcerpt.includes("sk-test"), false);
    assert.equal(runner.value.outputHash, outputHash("authorization: Bearer sk-test-secret-value-xxxx"));
  }
  assert.equal(prepareEvidence({ ...evidenceDraft(), writer: "llm" }).ok, false);
  assert.match(rejectedClientEvidence(["status", "commitSha", "runner"]) ?? "", /not from the client/);
  assert.equal(rejectedClientEvidence(["projectId"]), null);
  assert.equal(prepareEvidence({ ...evidenceDraft(), writer: "client", claimedResult: "READY" }).ok, false);
  const known = ["22222222-2222-4222-8222-222222222222"];
  const lowered = prepareApproval({
    ownerId: ownerA,
    projectId,
    operation: "migration",
    target: "presentation_gate",
    commitSha: commit,
    parameters: { migration: "20260929180000" },
    suppliedRisk: "SAFE",
    evidenceIdsShown: known,
    knownEvidenceIds: known,
    approvedBy: ownerA,
    approvedAt: "2026-09-29T06:00:00.000Z",
    expiresAt: "2026-09-30T06:00:00.000Z",
    suppliedFingerprint: "not-the-fingerprint",
  });
  assert.equal(lowered.ok, false);
  const approved = prepareApproval({
    ownerId: ownerA,
    projectId,
    operation: "migration",
    target: "presentation_gate",
    commitSha: commit,
    parameters: { migration: "20260929180000" },
    suppliedRisk: "SAFE",
    evidenceIdsShown: known,
    knownEvidenceIds: known,
    approvedBy: ownerA,
    approvedAt: "2026-09-29T06:00:00.000Z",
    expiresAt: "2026-09-30T06:00:00.000Z",
  });
  assert.equal(approved.ok, true);
  if (approved.ok) {
    assert.equal(approved.value.riskLevel, "HIGH");
    assert.equal(
      approved.value.fingerprint,
      actionFingerprint({
        actionType: "migration",
        target: "presentation_gate",
        parameters: { migration: "20260929180000" },
        projectId,
      }),
    );
  }
  const rows = [evidence("lint")];
  const override = prepareOverride(
    {
      ownerId: ownerA,
      projectId,
      reason: "Founder records this gap.",
      founderId: ownerA,
      createdAt: "2026-09-29T06:00:00.000Z",
      target: "responsive",
      commitSha: commit,
      affectedChecks: ["responsive"],
    },
    rows,
  );
  assert.equal(override.ok, true);
  if (override.ok) {
    assert.equal(override.value.evidence, rows);
    assert.equal(override.value.evidence.length, 1);
  }
  assert.equal(
    prepareOverride(
      {
        ownerId: ownerA,
        projectId,
        reason: "short",
        founderId: ownerA,
        createdAt: "2026-09-29T06:00:00.000Z",
        target: "responsive",
        commitSha: commit,
        affectedChecks: ["responsive"],
      },
      rows,
    ).ok,
    false,
  );
  const review = computePresentationReview({
    ownerId: ownerA,
    projectId,
    commitSha: commit,
    treeHash: tree,
    environment: "local",
    presentingProduction: false,
    evidence: [],
    requirements: [],
    claimedResult: "READY",
  });
  assert.equal(review.result, "NOT_READY");
  assert.equal(remoteWriterStatus({ url: "https://example.supabase.co", serviceRoleKey: "" }), "NOT_CONFIGURED");
});

function evidenceDraft() {
  return {
    writer: "runner" as const,
    ownerId: ownerA,
    projectId,
    runId: "11111111-1111-4111-8111-111111111111",
    checkType: "lint",
    commitSha: commit,
    treeHash: "a".repeat(64),
    command: "npm run lint",
    exitCode: 0,
    durationMs: 5,
    output: "ok",
    environment: "local" as const,
    status: "passed",
    createdAt: "2026-09-29T06:00:00.000Z",
  };
}
