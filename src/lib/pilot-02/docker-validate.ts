/**
 * Restricted Docker validation for the car-rental fixture.
 * Reuses Ghost pilot executor safeguards. Does not activate general workers.
 * Does not claim Ghost generated the car rental source.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { buildDockerRunArgv } from "@/lib/agent-runtime/docker-argv";
import { buildDockerExecutionSpec, probeDockerAvailability } from "@/lib/agent-runtime/docker-safeguards";
import { getIsolatedPilotGate, PILOT_DEFAULT_LIMITS, PILOT_IMAGE, PILOT_USER } from "@/lib/agent-runtime/pilot-config";
import type { FixtureManifest } from "@/lib/agent-runtime/pilot-fixture";
import type { PilotRunReport, PilotScenarioResult } from "@/lib/agent-runtime/pilot-executor";
import { createCodeWorkspaceContract } from "@/lib/agent-runtime/workspace";
import { CAR_RENTAL_PILOT_COMMANDS, materializeCarRentalFixture, type CarRentalPilotCommand } from "./car-rental-fixture";
import { PILOT_02_ID, PILOT_02_SOURCE_ATTRIBUTION } from "./task-contract";

function redact(text: string): string {
  return text
    .replace(/(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{8,}|gsk_[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{8,})/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .slice(0, 8000);
}

function runDockerArgv(argv: string[], durationMs: number) {
  const started = Date.now();
  const result = spawnSync("docker", argv, {
    encoding: "utf8",
    timeout: durationMs,
    maxBuffer: 2 * 1024 * 1024,
  });
  const timedOut = Boolean(result.error && /TIMEDOUT|ETIMEOUT/i.test(String(result.error)));
  return {
    exitCode: typeof result.status === "number" ? result.status : null,
    timedOut,
    stdout: redact(result.stdout ?? ""),
    stderr: redact(`${result.stderr ?? ""}${result.error ? `\n${result.error.message}` : ""}`),
    durationMs: Date.now() - started,
  };
}

function forceRemoveContainer(name: string) {
  spawnSync("docker", ["rm", "-f", name], { encoding: "utf8", timeout: 15_000 });
}

export type CarRentalValidationReport = PilotRunReport & {
  attribution: typeof PILOT_02_SOURCE_ATTRIBUTION;
  purpose: "FIXTURE_VALIDATION_CAPABILITY_PROOF";
  note: string;
};

export function runCarRentalValidationPilot(input?: {
  workspaceRoot?: string;
  forceDryRun?: boolean;
}): CarRentalValidationReport {
  const startedAt = new Date().toISOString();
  const securityChecks: PilotRunReport["securityChecks"] = [];
  const scenarios: PilotScenarioResult[] = [];
  const gate = getIsolatedPilotGate();
  const docker = probeDockerAvailability();
  securityChecks.push({
    check: "PILOT_GATE",
    result: gate.ok ? "PASS" : "BLOCKED",
    detail: gate.ok ? "Pilot flag enabled." : gate.reason,
  });
  securityChecks.push({
    check: "DOCKER_AVAILABLE",
    result: docker.available ? "PASS" : "BLOCKED",
    detail: docker.detail,
  });

  const empty = (): PilotScenarioResult => ({
    scenario: "cleanup",
    classification: "NOT_RUN",
    exitCode: null,
    timedOut: false,
    stdout: "",
    stderr: "",
    durationMs: 0,
    containerName: null,
    dockerArgv: null,
    detail: "Cleanup not required.",
  });

  const baseNote =
    "Car rental HTML/CSS/JS is Cursor-prepared. This run only validates the predefined fixture under restricted Docker.";

  if (!gate.ok) {
    return {
      pilotEnabled: false,
      dockerAvailable: docker.available,
      realContainerExecution: false,
      workspaceRoot: input?.workspaceRoot ?? null,
      workspacePath: null,
      image: PILOT_IMAGE,
      imageDigest: null,
      fixture: null,
      securityChecks,
      scenarios: [],
      cleanup: empty(),
      startedAt,
      finishedAt: new Date().toISOString(),
      attribution: PILOT_02_SOURCE_ATTRIBUTION,
      purpose: "FIXTURE_VALIDATION_CAPABILITY_PROOF",
      note: baseNote,
    };
  }

  const ownerId = "00000000-0000-4000-8000-0000000000c2";
  const projectId = "00000000-0000-4000-8000-0000000000d2";
  const taskId = PILOT_02_ID;
  const workspaceRoot = input?.workspaceRoot?.trim() || process.env.GHOST_AGENT_WORKSPACE_ROOT?.trim() || "";
  const workspace = createCodeWorkspaceContract({
    taskId,
    ownerId,
    projectId,
    workspaceRoot: workspaceRoot || undefined,
  });
  if (!workspace.ok) {
    securityChecks.push({ check: "WORKSPACE_CONTRACT", result: "FAIL", detail: workspace.message });
    return {
      pilotEnabled: true,
      dockerAvailable: docker.available,
      realContainerExecution: false,
      workspaceRoot: workspaceRoot || null,
      workspacePath: null,
      image: PILOT_IMAGE,
      imageDigest: null,
      fixture: null,
      securityChecks,
      scenarios: [],
      cleanup: empty(),
      startedAt,
      finishedAt: new Date().toISOString(),
      attribution: PILOT_02_SOURCE_ATTRIBUTION,
      purpose: "FIXTURE_VALIDATION_CAPABILITY_PROOF",
      note: baseNote,
    };
  }
  securityChecks.push({
    check: "WORKSPACE_CONTRACT",
    result: "PASS",
    detail: workspace.contract.hostPath,
  });

  const materialize = materializeCarRentalFixture(workspace.contract);
  if (!materialize.ok) {
    securityChecks.push({
      check: "FIXTURE_MATERIALIZE",
      result: "FAIL",
      detail: `${materialize.reason}: ${materialize.message}`,
    });
    return {
      pilotEnabled: true,
      dockerAvailable: docker.available,
      realContainerExecution: false,
      workspaceRoot,
      workspacePath: workspace.contract.hostPath,
      image: PILOT_IMAGE,
      imageDigest: null,
      fixture: null,
      securityChecks,
      scenarios: [],
      cleanup: empty(),
      startedAt,
      finishedAt: new Date().toISOString(),
      attribution: PILOT_02_SOURCE_ATTRIBUTION,
      purpose: "FIXTURE_VALIDATION_CAPABILITY_PROOF",
      note: baseNote,
    };
  }
  securityChecks.push({
    check: "FIXTURE_MATERIALIZE",
    result: "PASS",
    detail: `sha256=${materialize.manifest.contentSha256} files=${materialize.manifest.fileCount}`,
  });

  const specResult = buildDockerExecutionSpec({
    workspace: {
      ...workspace.contract,
      hostPath: materialize.workspaceFixturePath,
      containerPath: "/workspace",
      writablePaths: [materialize.workspaceFixturePath],
    },
    image: PILOT_IMAGE,
    user: PILOT_USER,
    resourceCaps: {
      memoryBytes: PILOT_DEFAULT_LIMITS.memoryBytes,
      nanoCpus: PILOT_DEFAULT_LIMITS.nanoCpus,
      pidsLimit: PILOT_DEFAULT_LIMITS.pidsLimit,
      diskQuotaBytes: PILOT_DEFAULT_LIMITS.diskQuotaBytes,
    },
  });

  const canExecute =
    docker.available && !input?.forceDryRun && specResult.ok && specResult.spec.image === PILOT_IMAGE;
  securityChecks.push({
    check: "DOCKER_SPEC",
    result: specResult.ok ? "PASS" : "FAIL",
    detail: specResult.ok
      ? `user=${specResult.spec.user} network=${specResult.spec.networkMode}`
      : `${specResult.reason}: ${specResult.message}`,
  });
  securityChecks.push({
    check: "REAL_CONTAINER_EXECUTION",
    result: canExecute ? "PASS" : "NOT_RUN",
    detail: canExecute ? "Will invoke restricted containers." : "Container execution NOT RUN.",
  });

  const names = Object.keys(CAR_RENTAL_PILOT_COMMANDS) as CarRentalPilotCommand[];
  let imageDigest: string | null = null;

  if (canExecute && specResult.ok) {
    const inspect = spawnSync("docker", ["image", "inspect", "--format", "{{index .RepoDigests 0}}", PILOT_IMAGE], {
      encoding: "utf8",
      timeout: 15_000,
    });
    if (inspect.status === 0) imageDigest = inspect.stdout.trim() || null;

    for (const name of names) {
      const containerName = `ghost-p02-${name}-${randomUUID().slice(0, 8)}`;
      const durationMs = name === "timeout" ? 3_000 : PILOT_DEFAULT_LIMITS.durationMs;
      const argvPlan = buildDockerRunArgv({
        spec: specResult.spec,
        containerName,
        command: CAR_RENTAL_PILOT_COMMANDS[name],
        durationMs,
      });
      if (!argvPlan.ok) {
        scenarios.push({
          scenario: name,
          classification: "FAIL",
          exitCode: null,
          timedOut: false,
          stdout: "",
          stderr: "",
          durationMs: 0,
          containerName,
          dockerArgv: null,
          detail: `${argvPlan.reason}: ${argvPlan.message}`,
        });
        continue;
      }
      const run = runDockerArgv(argvPlan.argv, argvPlan.durationMs);
      forceRemoveContainer(containerName);
      let classification: PilotScenarioResult["classification"] = "FAIL";
      if (name === "testFail") classification = run.exitCode !== 0 && !run.timedOut ? "PASS" : "FAIL";
      else if (name === "timeout") {
        classification = run.timedOut || run.exitCode === 137 || run.exitCode === 124 ? "PASS" : "FAIL";
      } else classification = run.exitCode === 0 && !run.timedOut ? "PASS" : "FAIL";
      scenarios.push({
        scenario: name,
        classification,
        exitCode: run.exitCode,
        timedOut: run.timedOut,
        stdout: run.stdout,
        stderr: run.stderr,
        durationMs: run.durationMs,
        containerName,
        dockerArgv: argvPlan.argv,
        detail: classification === "PASS" ? "Scenario met expected outcome." : "Scenario failed.",
      });
    }
  }

  try {
    rmSync(workspace.contract.hostPath, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  return {
    pilotEnabled: true,
    dockerAvailable: docker.available,
    realContainerExecution: canExecute,
    workspaceRoot: workspaceRoot || null,
    workspacePath: workspace.contract.hostPath,
    image: PILOT_IMAGE,
    imageDigest,
    fixture: materialize.manifest as unknown as FixtureManifest,
    securityChecks,
    scenarios,
    cleanup: {
      scenario: "cleanup",
      classification: "PASS",
      exitCode: 0,
      timedOut: false,
      stdout: "",
      stderr: "",
      durationMs: 0,
      containerName: null,
      dockerArgv: null,
      detail: `Workspace removed: ${workspace.contract.hostPath}`,
    },
    startedAt,
    finishedAt: new Date().toISOString(),
    attribution: PILOT_02_SOURCE_ATTRIBUTION,
    purpose: "FIXTURE_VALIDATION_CAPABILITY_PROOF",
    note: baseNote,
  };
}
