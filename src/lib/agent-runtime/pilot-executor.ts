import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { buildDockerRunArgv } from "./docker-argv";
import { buildDockerExecutionSpec, probeDockerAvailability } from "./docker-safeguards";
import { getIsolatedPilotGate, PILOT_DEFAULT_LIMITS, PILOT_IMAGE, PILOT_USER } from "./pilot-config";
import {
  getPilotCommand,
  materializeHarmlessFixture,
  type FixtureManifest,
  type PilotCommandName,
} from "./pilot-fixture";
import { createCodeWorkspaceContract } from "./workspace";

export type PilotScenarioResult = {
  scenario: PilotCommandName | "cleanup";
  classification: "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN";
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  containerName: string | null;
  dockerArgv: string[] | null;
  detail: string;
};

export type PilotRunReport = {
  pilotEnabled: boolean;
  dockerAvailable: boolean;
  realContainerExecution: boolean;
  workspaceRoot: string | null;
  workspacePath: string | null;
  image: string;
  imageDigest: string | null;
  fixture: FixtureManifest | null;
  securityChecks: Array<{ check: string; result: "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN"; detail: string }>;
  scenarios: PilotScenarioResult[];
  cleanup: PilotScenarioResult;
  startedAt: string;
  finishedAt: string;
};

function redact(text: string): string {
  return text
    .replace(/(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{8,}|gsk_[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{8,})/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .slice(0, 8000);
}

function runDockerArgv(
  argv: string[],
  durationMs: number,
): { exitCode: number | null; timedOut: boolean; stdout: string; stderr: string; durationMs: number } {
  const started = Date.now();
  const result = spawnSync("docker", argv, {
    encoding: "utf8",
    timeout: durationMs,
    maxBuffer: 2 * 1024 * 1024,
  });
  const elapsed = Date.now() - started;
  const timedOut = Boolean(result.error && /TIMEDOUT|ETIMEOUT/i.test(String(result.error)));
  return {
    exitCode: typeof result.status === "number" ? result.status : null,
    timedOut,
    stdout: redact(result.stdout ?? ""),
    stderr: redact(`${result.stderr ?? ""}${result.error ? `\n${result.error.message}` : ""}`),
    durationMs: elapsed,
  };
}

function forceRemoveContainer(name: string): { ok: boolean; detail: string } {
  if (!name) return { ok: true, detail: "No container to remove." };
  const result = spawnSync("docker", ["rm", "-f", name], { encoding: "utf8", timeout: 15_000 });
  if (result.status === 0 || /No such container/i.test(result.stderr ?? "")) {
    return { ok: true, detail: `Removed or absent: ${name}` };
  }
  return { ok: false, detail: redact(result.stderr || result.stdout || "docker rm failed") };
}

/**
 * Build 09.9 isolated pilot runner.
 * Disabled by default. When Docker is unavailable, returns NOT_RUN/BLOCKED
 * classifications — never fabricates a successful container execution.
 */
export function runIsolatedPilot(input?: {
  workspaceRoot?: string;
  ownerId?: string;
  projectId?: string;
  taskId?: string;
  /** Force dry-run even if Docker appears available (tests). */
  forceDryRun?: boolean;
}): PilotRunReport {
  const startedAt = new Date().toISOString();
  const securityChecks: PilotRunReport["securityChecks"] = [];
  const scenarios: PilotScenarioResult[] = [];

  const gate = getIsolatedPilotGate();
  securityChecks.push({
    check: "PILOT_GATE",
    result: gate.ok ? "PASS" : "BLOCKED",
    detail: gate.ok ? "Pilot flag enabled." : gate.reason,
  });

  const docker = probeDockerAvailability();
  securityChecks.push({
    check: "DOCKER_AVAILABLE",
    result: docker.available ? "PASS" : "BLOCKED",
    detail: docker.detail,
  });

  const ownerId = input?.ownerId ?? "00000000-0000-4000-8000-000000000001";
  const projectId = input?.projectId ?? "00000000-0000-4000-8000-000000000002";
  const taskId = input?.taskId ?? randomUUID();
  const workspaceRoot =
    input?.workspaceRoot?.trim() ||
    process.env.GHOST_AGENT_WORKSPACE_ROOT?.trim() ||
    "";

  const emptyCleanup = (): PilotScenarioResult => ({
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

  if (!gate.ok) {
    return {
      pilotEnabled: false,
      dockerAvailable: docker.available,
      realContainerExecution: false,
      workspaceRoot: workspaceRoot || null,
      workspacePath: null,
      image: PILOT_IMAGE,
      imageDigest: null,
      fixture: null,
      securityChecks,
      scenarios: [],
      cleanup: emptyCleanup(),
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  const workspace = createCodeWorkspaceContract({
    taskId,
    ownerId,
    projectId,
    workspaceRoot: workspaceRoot || undefined,
  });
  if (!workspace.ok) {
    securityChecks.push({
      check: "WORKSPACE_CONTRACT",
      result: "FAIL",
      detail: `${workspace.reason}: ${workspace.message}`,
    });
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
      cleanup: emptyCleanup(),
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }
  securityChecks.push({
    check: "WORKSPACE_CONTRACT",
    result: "PASS",
    detail: `hostPath=${workspace.contract.hostPath}`,
  });

  const materialize = materializeHarmlessFixture(workspace.contract);
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
        detail: "No fixture workspace to clean.",
      },
      startedAt,
      finishedAt: new Date().toISOString(),
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
      // Bind the fixture subdirectory as the container /workspace
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

  if (!specResult.ok || specResult.spec.image !== PILOT_IMAGE) {
    securityChecks.push({
      check: "DOCKER_SPEC",
      result: "FAIL",
      detail: specResult.ok ? "Image mismatch" : `${specResult.reason}: ${specResult.message}`,
    });
  } else {
    securityChecks.push({
      check: "DOCKER_SPEC",
      result: "PASS",
      detail: `user=${specResult.spec.user} network=${specResult.spec.networkMode} privileged=${specResult.spec.privileged}`,
    });
  }

  const canExecute =
    docker.available &&
    !input?.forceDryRun &&
    specResult.ok &&
    specResult.spec.image === PILOT_IMAGE;

  securityChecks.push({
    check: "REAL_CONTAINER_EXECUTION",
    result: canExecute ? "PASS" : "NOT_RUN",
    detail: canExecute
      ? "Docker available and pilot gate open — will invoke containers."
      : "Container execution NOT RUN (Docker unavailable, dry-run, or unsafe spec).",
  });

  const scenarioNames: PilotCommandName[] = ["validate", "build", "test", "testFail", "timeout"];
  let imageDigest: string | null = null;

  if (!canExecute || !specResult.ok) {
    for (const name of scenarioNames) {
      const command = getPilotCommand(name);
      const argvPlan = specResult.ok
        ? buildDockerRunArgv({
            spec: specResult.spec,
            containerName: `ghost-pilot-${name}-${taskId.slice(0, 8)}`,
            command,
            durationMs: name === "timeout" ? 3_000 : PILOT_DEFAULT_LIMITS.durationMs,
          })
        : null;
      scenarios.push({
        scenario: name,
        classification: "NOT_RUN",
        exitCode: null,
        timedOut: false,
        stdout: "",
        stderr: "",
        durationMs: 0,
        containerName: null,
        dockerArgv: argvPlan && argvPlan.ok ? argvPlan.argv : null,
        detail:
          argvPlan && !argvPlan.ok
            ? `Argv blocked: ${argvPlan.reason}`
            : "Real container execution unavailable — argv planned only.",
      });
    }
  } else {
    // Resolve image digest if possible (best-effort).
    const inspect = spawnSync("docker", ["image", "inspect", "--format", "{{index .RepoDigests 0}}", PILOT_IMAGE], {
      encoding: "utf8",
      timeout: 15_000,
    });
    if (inspect.status === 0 && inspect.stdout.trim()) {
      imageDigest = inspect.stdout.trim();
    }

    for (const name of scenarioNames) {
      const command = getPilotCommand(name);
      const containerName = `ghost-pilot-${name}-${taskId.slice(0, 8)}`;
      const durationMs = name === "timeout" ? 3_000 : PILOT_DEFAULT_LIMITS.durationMs;
      const argvPlan = buildDockerRunArgv({
        spec: specResult.spec,
        containerName,
        command,
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
      if (name === "testFail") {
        classification = run.exitCode !== 0 && !run.timedOut ? "PASS" : "FAIL";
      } else if (name === "timeout") {
        classification = run.timedOut || run.exitCode === 137 || run.exitCode === 124 ? "PASS" : "FAIL";
      } else {
        classification = run.exitCode === 0 && !run.timedOut ? "PASS" : "FAIL";
      }

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
        detail:
          classification === "PASS"
            ? "Scenario met expected outcome."
            : `Unexpected outcome exit=${run.exitCode} timedOut=${run.timedOut}`,
      });
    }
  }

  // Cleanup workspace
  let cleanup: PilotScenarioResult;
  try {
    if (existsSync(workspace.contract.hostPath)) {
      rmSync(workspace.contract.hostPath, { recursive: true, force: true });
    }
    const gone = !existsSync(workspace.contract.hostPath);
    cleanup = {
      scenario: "cleanup",
      classification: gone ? "PASS" : "FAIL",
      exitCode: gone ? 0 : 1,
      timedOut: false,
      stdout: "",
      stderr: "",
      durationMs: 0,
      containerName: null,
      dockerArgv: null,
      detail: gone
        ? `Workspace removed: ${workspace.contract.hostPath}`
        : `Workspace still present: ${workspace.contract.hostPath}`,
    };
  } catch (error) {
    cleanup = {
      scenario: "cleanup",
      classification: "FAIL",
      exitCode: 1,
      timedOut: false,
      stdout: "",
      stderr: redact(error instanceof Error ? error.message : String(error)),
      durationMs: 0,
      containerName: null,
      dockerArgv: null,
      detail: "Cleanup threw.",
    };
  }
  securityChecks.push({
    check: "CLEANUP",
    result: cleanup.classification === "PASS" ? "PASS" : "FAIL",
    detail: cleanup.detail,
  });

  return {
    pilotEnabled: true,
    dockerAvailable: docker.available,
    realContainerExecution: canExecute,
    workspaceRoot,
    workspacePath: workspace.contract.hostPath,
    image: PILOT_IMAGE,
    imageDigest,
    fixture: materialize.manifest,
    securityChecks,
    scenarios,
    cleanup,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

export function summarizePilotReport(report: PilotRunReport): {
  overall: "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN" | "PARTIAL";
  evidenceSha256: string;
} {
  const payload = JSON.stringify(report);
  const evidenceSha256 = createHash("sha256").update(payload).digest("hex");
  if (!report.pilotEnabled) {
    return { overall: "BLOCKED", evidenceSha256 };
  }
  if (!report.realContainerExecution) {
    const argvReady = report.scenarios.every((s) => s.dockerArgv != null || s.classification === "NOT_RUN");
    return { overall: argvReady ? "NOT_RUN" : "FAIL", evidenceSha256 };
  }
  const failed = [...report.scenarios, report.cleanup].some((s) => s.classification === "FAIL");
  return { overall: failed ? "FAIL" : "PASS", evidenceSha256 };
}

/** Reject malicious command names — only allowlisted pilot commands. */
export function resolvePilotCommandOrReject(
  name: string,
): { ok: true; command: readonly string[] } | { ok: false; reason: string } {
  if (!(name in PILOT_COMMANDS_SAFE)) {
    return { ok: false, reason: "COMMAND_NOT_ALLOWLISTED" };
  }
  return { ok: true, command: getPilotCommand(name as PilotCommandName) };
}

const PILOT_COMMANDS_SAFE: Record<string, true> = {
  validate: true,
  build: true,
  test: true,
  testFail: true,
  timeout: true,
};

export function pilotWorkspaceParentSafe(root: string, appRoot = process.cwd()): boolean {
  const resolved = path.resolve(root);
  const app = path.resolve(appRoot);
  return resolved !== app && !resolved.startsWith(`${app}${path.sep}`);
}
