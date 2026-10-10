import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import type { CodeWorkspaceContract } from "./workspace";

/**
 * Docker execution safeguards (Build 09.7).
 * Spec + validation only — does not start containers.
 * Runtime Docker invoke remains UNVERIFIED when Docker is unavailable.
 */

export type DockerResourceCaps = {
  memoryBytes: number;
  nanoCpus: number;
  pidsLimit: number;
  diskQuotaBytes: number | null;
};

export type DockerExecutionSpec = {
  image: string;
  user: string;
  workdir: string;
  networkMode: "none";
  readOnlyRootFilesystem: boolean;
  privileged: false;
  capDrop: ["ALL"];
  securityOpt: string[];
  binds: string[];
  tmpfs: Record<string, string>;
  env: Record<string, string>;
  resourceCaps: DockerResourceCaps;
  workspaceFingerprint: string;
};

export type DockerSpecDenial =
  | "MISSING_WORKSPACE"
  | "PRIVILEGED_FORBIDDEN"
  | "ROOT_USER_FORBIDDEN"
  | "NETWORK_FORBIDDEN"
  | "DOCKER_SOCK_FORBIDDEN"
  | "SECRET_IN_ENV"
  | "SECRET_IN_BIND"
  | "IMAGE_UNAPPROVED"
  | "CAPS_TOO_HIGH";

export type DockerSpecResult =
  | { ok: true; spec: DockerExecutionSpec; runtimeVerified: false }
  | { ok: false; reason: DockerSpecDenial; message: string };

export const DEFAULT_RESOURCE_CAPS: DockerResourceCaps = {
  memoryBytes: 512 * 1024 * 1024,
  nanoCpus: 1_000_000_000, // 1 CPU
  pidsLimit: 256,
  diskQuotaBytes: 2 * 1024 * 1024 * 1024,
};

/** Allowlisted images for agent jobs — empty means founder must approve per job later. */
export const APPROVED_AGENT_IMAGES = [
  "ghost-agent-runner:local",
] as const;

const SECRET_ENV_KEY = /^(?:.*(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|SERVICE_ROLE).*)$/i;
const SECRET_VALUE = /(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{8,}|gsk_[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{8,})/;

export function buildDockerExecutionSpec(input: {
  workspace: CodeWorkspaceContract;
  image: string;
  user?: string;
  env?: Record<string, string>;
  resourceCaps?: Partial<DockerResourceCaps>;
  allowUnlistedImage?: boolean;
}): DockerSpecResult {
  const user = (input.user ?? "10001:10001").trim();
  if (!user || user === "0" || user.startsWith("0:") || user === "root") {
    return {
      ok: false,
      reason: "ROOT_USER_FORBIDDEN",
      message: "Agent containers must run as a non-root user.",
    };
  }

  const image = input.image.trim();
  if (
    !input.allowUnlistedImage &&
    !(APPROVED_AGENT_IMAGES as readonly string[]).includes(image)
  ) {
    return {
      ok: false,
      reason: "IMAGE_UNAPPROVED",
      message: "Image is not on the approved agent-runner allowlist.",
    };
  }

  const caps: DockerResourceCaps = {
    ...DEFAULT_RESOURCE_CAPS,
    ...input.resourceCaps,
  };
  if (caps.memoryBytes > 2 * 1024 * 1024 * 1024 || caps.nanoCpus > 2_000_000_000 || caps.pidsLimit > 512) {
    return {
      ok: false,
      reason: "CAPS_TOO_HIGH",
      message: "Requested resource caps exceed Ghost agent limits.",
    };
  }

  const env = { ...(input.env ?? {}) };
  for (const [key, value] of Object.entries(env)) {
    if (SECRET_ENV_KEY.test(key) || SECRET_VALUE.test(value)) {
      return {
        ok: false,
        reason: "SECRET_IN_ENV",
        message: "Secrets must not be injected into agent container env from the app.",
      };
    }
  }

  const binds = [`${input.workspace.hostPath}:${input.workspace.containerPath}:rw`];
  for (const bind of binds) {
    if (bind.includes("docker.sock") || bind.includes("/etc/") || bind.includes(".env")) {
      return {
        ok: false,
        reason: "SECRET_IN_BIND",
        message: "Forbidden bind mount for agent execution.",
      };
    }
  }

  // runtimeVerified is always false here — Docker invoke is a separate, disabled path.
  return {
    ok: true,
    runtimeVerified: false,
    spec: {
      image,
      user,
      workdir: input.workspace.containerPath,
      networkMode: "none",
      readOnlyRootFilesystem: true,
      privileged: false,
      capDrop: ["ALL"],
      securityOpt: ["no-new-privileges:true"],
      binds,
      tmpfs: {
        "/tmp": "rw,noexec,nosuid,size=64m",
        "/run": "rw,noexec,nosuid,size=16m",
      },
      env: {
        HOME: "/tmp/ghost-home",
        GHOST_TASK_ID: input.workspace.taskId,
        GHOST_WORKSPACE: input.workspace.containerPath,
        ...env,
      },
      resourceCaps: caps,
      workspaceFingerprint: input.workspace.fingerprint,
    },
  };
}

/** Validate an externally assembled spec before any future invoke. */
export function assertDockerSpecSafe(spec: DockerExecutionSpec): DockerSpecResult {
  if (spec.privileged !== false) {
    return { ok: false, reason: "PRIVILEGED_FORBIDDEN", message: "Privileged mode is forbidden." };
  }
  if (spec.networkMode !== "none") {
    return { ok: false, reason: "NETWORK_FORBIDDEN", message: "Agent network must be disabled." };
  }
  if (spec.user === "0" || spec.user.startsWith("0:") || spec.user === "root") {
    return { ok: false, reason: "ROOT_USER_FORBIDDEN", message: "Non-root user required." };
  }
  if (spec.binds.some((b) => b.includes("docker.sock"))) {
    return { ok: false, reason: "DOCKER_SOCK_FORBIDDEN", message: "Docker socket mount is forbidden." };
  }
  return {
    ok: true,
    runtimeVerified: false,
    spec,
  };
}

/**
 * Attempt to detect Docker. Never starts a container.
 * Returns availability only — invoke remains disabled.
 */
export function probeDockerAvailability(): {
  available: boolean;
  runtimeVerified: false;
  detail: string;
} {
  const pathEnv = process.env.PATH ?? "";
  const hasDockerOnPath = pathEnv.split(":").some((dir) => existsSync(`${dir}/docker`));
  if (!hasDockerOnPath) {
    return {
      available: false,
      runtimeVerified: false,
      detail: "Docker unavailable — safeguard specs are unit-tested; runtime invoke UNVERIFIED.",
    };
  }
  const info = spawnSync("docker", ["info"], { encoding: "utf8", timeout: 3000 });
  const daemonUp = info.status === 0;
  return {
    available: daemonUp,
    runtimeVerified: false,
    detail: daemonUp
      ? "Docker daemon reachable — container invoke still disabled in this build."
      : "Docker binary present but daemon unavailable — runtime invoke UNVERIFIED.",
  };
}

/** Hard refuse to run containers in Builds 09.6–09.8. */
export function invokeDockerExecution(_spec: DockerExecutionSpec): never {
  void _spec;
  throw new Error(
    "DOCKER_INVOKE_DISABLED: container execution is not activated. Spec validation only.",
  );
}
