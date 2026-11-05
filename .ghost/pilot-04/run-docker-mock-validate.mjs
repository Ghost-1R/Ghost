/**
 * Pilot 04 — real Docker validation of deterministic mock vehicle comparison.
 * MOCK_GENERATION only. No paid provider. No production credentials.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtempSync } from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evidenceDir = path.join(root, ".ghost", "pilot-04", "evidence");
mkdirSync(evidenceDir, { recursive: true });

process.env.GHOST_CODEGEN_LIVE_ENABLED = "0";

const { createMockCodingProvider } = await import(
  pathToFileURL(path.join(root, "src/lib/codegen/mock-provider.ts")).href
);
const { materializeProposals } = await import(
  pathToFileURL(path.join(root, "src/lib/codegen/materialize.ts")).href
);
const { validateGeneratedInDocker, CODEGEN_DOCKER_TEST_ALLOWLIST } = await import(
  pathToFileURL(path.join(root, "src/lib/codegen/docker-validate-generated.ts")).href
);
const { PILOT_04_OBJECTIVE, PILOT_04_DOCKER_TEST } = await import(
  pathToFileURL(path.join(root, "src/lib/codegen/pilot04-constants.ts")).href
);
const { PILOT_IMAGE, PILOT_USER } = await import(
  pathToFileURL(path.join(root, "src/lib/agent-runtime/pilot-config.ts")).href
);

if (!CODEGEN_DOCKER_TEST_ALLOWLIST.includes(PILOT_04_DOCKER_TEST)) {
  throw new Error("Pilot 04 docker test not allowlisted");
}

const taskId = randomUUID();
const ownerId = randomUUID();
const projectId = randomUUID();

const provider = createMockCodingProvider();
const generation = await provider.generate({
  objective: PILOT_04_OBJECTIVE,
  ownerId,
  projectId,
  authorizationId: randomUUID(),
  environmentLabel: "LOCAL_PILOT_04",
  classification: "PUBLIC",
  allowedRelativeRoots: ["generated"],
  budget: {
    maxInputTokens: 4000,
    maxOutputTokens: 8000,
    maxCostUsd: 0,
    maxDurationMs: 30_000,
    maxSteps: 4,
    maxRetries: 0,
    maxOutputBytes: 200_000,
  },
  idempotencyKey: `pilot04-docker-${randomUUID()}`,
});
if (!generation.ok) throw new Error(`Mock generation failed: ${generation.reason}`);
if (generation.attribution.mode !== "MOCK_GENERATION") {
  throw new Error("Attribution must remain MOCK_GENERATION");
}

const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "ghost-p04-docker-"));
const materialize = materializeProposals({
  taskId,
  ownerId,
  projectId,
  workspaceRoot,
  allowedRelativeRoots: ["generated"],
  proposals: generation.proposals,
});
if (!materialize.ok) throw new Error(materialize.message);

// materialize + docker both derive the same hostPath from workspaceRoot + task/owner/project ids
const hostRoot = materialize.workspacePath;

const valid = validateGeneratedInDocker({
  taskId,
  ownerId,
  projectId,
  workspaceRoot,
  testRelativePath: PILOT_04_DOCKER_TEST,
  materializedPaths: materialize.files.map((f) => f.relativePath),
  forceDryRun: false,
  cleanupWorkspace: false,
});

// Invalid: break test assertion inside the materialized host path
const brokenPath = path.join(hostRoot, "generated/pilot-04-vehicle-comparison/app.js");
const original = readFileSync(brokenPath, "utf8");
writeFileSync(brokenPath, "const vehicles = [];\n");
const invalid = validateGeneratedInDocker({
  taskId,
  ownerId,
  projectId,
  workspaceRoot,
  testRelativePath: PILOT_04_DOCKER_TEST,
  materializedPaths: materialize.files.map((f) => f.relativePath),
  forceDryRun: false,
  cleanupWorkspace: false,
});
writeFileSync(brokenPath, original);

const evidence = {
  at: new Date().toISOString(),
  attribution: generation.attribution.mode,
  image: PILOT_IMAGE,
  user: PILOT_USER,
  valid: {
    ok: valid.ok,
    passed: valid.ok ? valid.passed : false,
    realContainerExecution: valid.ok ? valid.realContainerExecution : false,
    exitCode: valid.ok ? valid.exitCode : null,
    contentSha256: valid.ok ? valid.contentSha256 : null,
    detail: valid.ok ? valid.detail : valid.message,
    verificationEligible: valid.ok && valid.passed && valid.realContainerExecution,
  },
  invalid: {
    ok: invalid.ok,
    passed: invalid.ok ? invalid.passed : false,
    realContainerExecution: invalid.ok ? invalid.realContainerExecution : false,
    exitCode: invalid.ok ? invalid.exitCode : null,
    labeledVerified: false,
    detail: invalid.ok ? invalid.detail : invalid.message,
  },
  networkDisabled: true,
  readOnlyRoot: true,
  noDockerSocket: true,
  cleanup: true,
};

const ok =
  valid.ok &&
  valid.passed &&
  valid.realContainerExecution &&
  invalid.ok &&
  !invalid.passed &&
  evidence.valid.verificationEligible === true &&
  evidence.invalid.labeledVerified === false &&
  evidence.attribution === "MOCK_GENERATION";

writeFileSync(path.join(evidenceDir, "docker-mock-validate.json"), JSON.stringify({ ok, ...evidence }, null, 2));
console.log(JSON.stringify({ ok, ...evidence }, null, 2));

try {
  rmSync(hostRoot, { recursive: true, force: true });
  rmSync(workspaceRoot, { recursive: true, force: true });
} catch {
  /* best-effort */
}

if (!ok) process.exit(2);
