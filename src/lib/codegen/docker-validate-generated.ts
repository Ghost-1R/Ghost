/**
 * Restricted Docker validation for materialized codegen output.
 * Allowlisted argv only — never model-generated shell commands.
 * Network none. Non-root. Caps enforced via existing docker-safeguards.
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { buildDockerRunArgv } from "@/lib/agent-runtime/docker-argv";
import { buildDockerExecutionSpec, probeDockerAvailability } from "@/lib/agent-runtime/docker-safeguards";
import { PILOT_IMAGE, PILOT_USER } from "@/lib/agent-runtime/pilot-config";
import { createCodeWorkspaceContract } from "@/lib/agent-runtime/workspace";
import { redactSecrets } from "@/lib/security/redact";

export type GeneratedDockerValidation =
  | {
      ok: true;
      passed: boolean;
      realContainerExecution: boolean;
      exitCode: number | null;
      stdout: string;
      stderr: string;
      durationMs: number;
      contentSha256: string;
      testRelativePath: string;
      detail: string;
    }
  | { ok: false; reason: string; message: string; contentSha256: string | null };

/** Only these relative test entrypoints may run inside Docker. */
export const CODEGEN_DOCKER_TEST_ALLOWLIST = [
  "generated/pilot-03-vehicle-comparison/test.mjs",
  "generated/vehicle-comparison/test.mjs",
] as const;

function forceRemove(name: string) {
  spawnSync("docker", ["rm", "-f", name], { encoding: "utf8", timeout: 15_000 });
}

function hashWorkspaceFiles(hostPath: string, relativePaths: string[]): string {
  const h = createHash("sha256");
  for (const rel of relativePaths.sort()) {
    const abs = path.join(hostPath, rel);
    if (!existsSync(abs)) continue;
    h.update(rel);
    h.update(readFileSync(abs));
  }
  return h.digest("hex");
}

/**
 * Run allowlisted node test for generated files inside restricted Docker.
 * If Docker unavailable, returns ok with passed=false and realContainerExecution=false (not VERIFIED).
 */
export function validateGeneratedInDocker(input: {
  taskId: string;
  ownerId: string;
  projectId: string;
  workspaceRoot: string;
  /** Relative path of test file under workspace host root. */
  testRelativePath: string;
  /** All materialized relative paths for hashing. */
  materializedPaths: string[];
  forceDryRun?: boolean;
  cleanupWorkspace?: boolean;
}): GeneratedDockerValidation {
  if (!(CODEGEN_DOCKER_TEST_ALLOWLIST as readonly string[]).includes(input.testRelativePath)) {
    return {
      ok: false,
      reason: "TEST_NOT_ALLOWLISTED",
      message: `Test path ${input.testRelativePath} is not on the codegen Docker allowlist.`,
      contentSha256: null,
    };
  }

  const contract = createCodeWorkspaceContract({
    taskId: input.taskId,
    ownerId: input.ownerId,
    projectId: input.projectId,
    workspaceRoot: input.workspaceRoot,
  });
  if (!contract.ok) {
    return { ok: false, reason: contract.reason, message: contract.message, contentSha256: null };
  }

  const hostPath = contract.contract.hostPath;
  const testAbs = path.join(hostPath, input.testRelativePath);
  if (!existsSync(testAbs)) {
    return {
      ok: false,
      reason: "TEST_MISSING",
      message: "Allowlisted test file was not materialized.",
      contentSha256: null,
    };
  }

  const contentSha256 = hashWorkspaceFiles(hostPath, input.materializedPaths);
  const docker = probeDockerAvailability();
  const spec = buildDockerExecutionSpec({
    workspace: contract.contract,
    image: PILOT_IMAGE,
    user: PILOT_USER,
  });
  if (!spec.ok) {
    return { ok: false, reason: spec.reason, message: spec.message, contentSha256 };
  }

  const containerName = `ghost-codegen-${input.taskId.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 24)}-${randomUUID().slice(0, 8)}`;
  const testInContainer = path.posix.join("/workspace", input.testRelativePath);
  // Container bind mounts workspace at /workspace — run allowlisted node test only.
  const command = ["node", testInContainer] as const;

  const argvPlan = buildDockerRunArgv({
    spec: {
      ...spec.spec,
      workdir: "/workspace",
    },
    containerName,
    command,
    durationMs: 30_000,
  });
  if (!argvPlan.ok) {
    return { ok: false, reason: argvPlan.reason, message: argvPlan.message, contentSha256 };
  }

  const canRun =
    docker.available && !input.forceDryRun && spec.spec.image === PILOT_IMAGE;

  if (!canRun) {
    if (input.cleanupWorkspace) {
      try {
        rmSync(hostPath, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    return {
      ok: true,
      passed: false,
      realContainerExecution: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      durationMs: 0,
      contentSha256,
      testRelativePath: input.testRelativePath,
      detail: docker.available
        ? "Docker dry-run / forceDryRun — not executed. Cannot label VERIFIED."
        : `Docker unavailable: ${docker.detail}. Cannot label VERIFIED.`,
    };
  }

  const started = Date.now();
  const result = spawnSync("docker", argvPlan.argv, {
    encoding: "utf8",
    timeout: 35_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  const durationMs = Date.now() - started;
  forceRemove(containerName);

  const stdout = redactSecrets((result.stdout ?? "").slice(0, 4000));
  const stderr = redactSecrets((result.stderr ?? "").slice(0, 4000));
  const exitCode = typeof result.status === "number" ? result.status : null;
  const passed = exitCode === 0 && !result.error;

  if (input.cleanupWorkspace) {
    try {
      rmSync(hostPath, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  return {
    ok: true,
    passed,
    realContainerExecution: true,
    exitCode,
    stdout,
    stderr,
    durationMs,
    contentSha256,
    testRelativePath: input.testRelativePath,
    detail: passed
      ? "Restricted Docker test passed (network=none)."
      : `Restricted Docker test failed (exit=${exitCode}).`,
  };
}
