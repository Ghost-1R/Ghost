import type { DockerExecutionSpec } from "./docker-safeguards";
import { PILOT_DEFAULT_LIMITS } from "./pilot-config";

export type DockerArgvDenial =
  | "UNSAFE_SPEC"
  | "COMMAND_INJECTION"
  | "FLAG_INJECTION"
  | "UNAUTHORIZED_MOUNT"
  | "DURATION_INVALID";

export type DockerArgvResult =
  | { ok: true; argv: string[]; durationMs: number }
  | { ok: false; reason: DockerArgvDenial; message: string };

const FORBIDDEN_FLAG = /^(--privileged|--network(?!=none)|--pid=host|--ipc=host|--uts=host|--userns=host|-v|--volume|--mount|--device|--cap-add)/i;

/**
 * Fixed container argv for a pilot job.
 * Commands are an allowlisted argv array — never a shell string.
 */
export function buildDockerRunArgv(input: {
  spec: DockerExecutionSpec;
  containerName: string;
  command: readonly string[];
  durationMs?: number;
}): DockerArgvResult {
  if (input.spec.privileged !== false) {
    return { ok: false, reason: "UNSAFE_SPEC", message: "Privileged spec rejected." };
  }
  if (input.spec.networkMode !== "none") {
    return { ok: false, reason: "UNSAFE_SPEC", message: "Network must be none." };
  }
  if (input.spec.user === "root" || input.spec.user === "0" || input.spec.user.startsWith("0:")) {
    return { ok: false, reason: "UNSAFE_SPEC", message: "Non-root user required." };
  }
  if (input.spec.binds.some((b) => /docker\.sock|\.env|\/etc\//i.test(b))) {
    return { ok: false, reason: "UNAUTHORIZED_MOUNT", message: "Forbidden bind mount." };
  }
  if (input.spec.binds.length !== 1) {
    return { ok: false, reason: "UNAUTHORIZED_MOUNT", message: "Exactly one workspace bind is allowed." };
  }

  const durationMs = input.durationMs ?? PILOT_DEFAULT_LIMITS.durationMs;
  if (!Number.isFinite(durationMs) || durationMs < 1_000 || durationMs > 120_000) {
    return { ok: false, reason: "DURATION_INVALID", message: "Duration must be between 1s and 120s." };
  }

  if (input.command.length === 0) {
    return { ok: false, reason: "COMMAND_INJECTION", message: "Command argv is required." };
  }
  for (const part of input.command) {
    if (!part || /[;&|`$<>]/.test(part) || part.includes("\n")) {
      return {
        ok: false,
        reason: "COMMAND_INJECTION",
        message: "Command contains shell metacharacters; argv-only execution required.",
      };
    }
    if (FORBIDDEN_FLAG.test(part)) {
      return { ok: false, reason: "FLAG_INJECTION", message: "Docker/flag injection rejected." };
    }
  }

  if (/[;&|`$]/.test(input.containerName) || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(input.containerName)) {
    return { ok: false, reason: "FLAG_INJECTION", message: "Invalid container name." };
  }

  const memoryMb = Math.max(32, Math.floor(input.spec.resourceCaps.memoryBytes / (1024 * 1024)));
  const cpus = Math.max(0.1, input.spec.resourceCaps.nanoCpus / 1_000_000_000);

  const argv: string[] = [
    "run",
    "--rm",
    "--name",
    input.containerName,
    "--user",
    input.spec.user,
    "--network",
    "none",
    "--read-only",
    "--security-opt",
    "no-new-privileges:true",
    "--cap-drop",
    "ALL",
    "--memory",
    `${memoryMb}m`,
    "--memory-swap",
    `${memoryMb}m`,
    "--cpus",
    String(cpus),
    "--pids-limit",
    String(input.spec.resourceCaps.pidsLimit),
    "--workdir",
    input.spec.workdir,
  ];

  for (const [mount, opts] of Object.entries(input.spec.tmpfs)) {
    argv.push("--tmpfs", `${mount}:${opts}`);
  }

  for (const bind of input.spec.binds) {
    // Expected form: host:container[:opts]
    const match = bind.match(/^([^:]+):([^:]+)(?::([^:]+))?$/);
    if (!match) {
      return { ok: false, reason: "UNAUTHORIZED_MOUNT", message: "Bind mount format invalid." };
    }
    const [, source, target] = match;
    argv.push(
      "--mount",
      `type=bind,source=${source},target=${target},bind-propagation=rprivate`,
    );
  }

  for (const [key, value] of Object.entries(input.spec.env)) {
    if (/[^\w]/.test(key) || value.includes("\n")) {
      return { ok: false, reason: "FLAG_INJECTION", message: "Invalid environment entry." };
    }
    argv.push("--env", `${key}=${value}`);
  }

  argv.push(input.spec.image);
  argv.push(...input.command);

  // Reject any accidental privileged/network injection in assembled argv.
  if (argv.some((part) => part === "--privileged" || part === "--network=host")) {
    return { ok: false, reason: "FLAG_INJECTION", message: "Unsafe docker flag in argv." };
  }

  return { ok: true, argv, durationMs };
}
