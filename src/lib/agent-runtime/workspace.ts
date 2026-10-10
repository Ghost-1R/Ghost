import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";

/**
 * Isolated code workspace contract (Build 09.7).
 * Defines where an agent task may read/write — never the host app root as writable root.
 * Secrets must live outside the workspace mount.
 */

export const WORKSPACE_ROOT_ENV = "GHOST_AGENT_WORKSPACE_ROOT";

export type WorkspaceIsolationMode = "TASK_SUBDIR" | "EPHEMERAL_DIR";

export type CodeWorkspaceContract = {
  workspaceId: string;
  taskId: string;
  ownerId: string;
  projectId: string;
  /** Absolute path to the isolated workspace root (host path for bind mounts). */
  hostPath: string;
  /** In-container mount path — always /workspace for agent jobs. */
  containerPath: "/workspace";
  isolationMode: WorkspaceIsolationMode;
  readOnlyHostMounts: string[];
  writablePaths: string[];
  forbiddenPaths: string[];
  secretMountMode: "NONE" | "TMPFS_ENV_ONLY";
  fingerprint: string;
};

export type WorkspaceContractDenial =
  | "MISSING_TASK_ID"
  | "MISSING_OWNER"
  | "MISSING_PROJECT"
  | "INVALID_ROOT"
  | "PATH_ESCAPE"
  | "HOST_ROOT_FORBIDDEN"
  | "SECRET_PATH_IN_WORKSPACE"
  | "SYMLINK_ESCAPE";

export type WorkspaceContractResult =
  | { ok: true; contract: CodeWorkspaceContract }
  | { ok: false; reason: WorkspaceContractDenial; message: string };

const FORBIDDEN_BASENAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  "credentials.json",
  "service-account.json",
  "id_rsa",
  "id_ed25519",
]);

function isAbsolutePosix(p: string): boolean {
  return p.startsWith("/");
}

function resolveUnderRoot(root: string, candidate: string): string | null {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, candidate);
  const rel = path.relative(resolvedRoot, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return resolved;
}

/**
 * Build an isolated workspace contract for a bound agent task.
 * Host app process.cwd() is never accepted as the writable workspace root.
 */
export function createCodeWorkspaceContract(input: {
  taskId: string;
  ownerId: string;
  projectId: string;
  workspaceRoot?: string;
  isolationMode?: WorkspaceIsolationMode;
  at?: string;
}): WorkspaceContractResult {
  if (!input.taskId.trim()) {
    return { ok: false, reason: "MISSING_TASK_ID", message: "taskId is required." };
  }
  if (!input.ownerId.trim()) {
    return { ok: false, reason: "MISSING_OWNER", message: "ownerId is required." };
  }
  if (!input.projectId.trim()) {
    return { ok: false, reason: "MISSING_PROJECT", message: "projectId is required." };
  }

  const configuredRoot =
    input.workspaceRoot?.trim() ||
    process.env[WORKSPACE_ROOT_ENV]?.trim() ||
    "";

  if (!configuredRoot || !isAbsolutePosix(configuredRoot)) {
    return {
      ok: false,
      reason: "INVALID_ROOT",
      message: `${WORKSPACE_ROOT_ENV} must be an absolute path outside the application root.`,
    };
  }

  const appRoot = path.resolve(process.cwd());
  const resolvedRoot = path.resolve(configuredRoot);
  if (resolvedRoot === appRoot || resolvedRoot.startsWith(`${appRoot}${path.sep}`)) {
    return {
      ok: false,
      reason: "HOST_ROOT_FORBIDDEN",
      message: "Agent workspace root cannot be the Ghost application directory.",
    };
  }

  const workspaceId = randomUUID();
  const hostPath = path.join(resolvedRoot, input.ownerId, input.projectId, input.taskId);
  const under = resolveUnderRoot(resolvedRoot, path.join(input.ownerId, input.projectId, input.taskId));
  if (!under || under !== hostPath) {
    return { ok: false, reason: "PATH_ESCAPE", message: "Workspace path escaped the configured root." };
  }

  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        workspaceId,
        taskId: input.taskId,
        ownerId: input.ownerId,
        projectId: input.projectId,
        hostPath,
        isolationMode: input.isolationMode ?? "TASK_SUBDIR",
      }),
    )
    .digest("hex");

  return {
    ok: true,
    contract: {
      workspaceId,
      taskId: input.taskId,
      ownerId: input.ownerId,
      projectId: input.projectId,
      hostPath,
      containerPath: "/workspace",
      isolationMode: input.isolationMode ?? "TASK_SUBDIR",
      readOnlyHostMounts: [],
      writablePaths: [hostPath],
      forbiddenPaths: [
        appRoot,
        "/etc",
        "/var/run/docker.sock",
        "/root",
        "/home",
      ],
      secretMountMode: "TMPFS_ENV_ONLY",
      fingerprint,
    },
  };
}

/** Reject secret-like filenames inside a workspace write plan. */
export function assertWorkspacePathAllowed(
  contract: CodeWorkspaceContract,
  relativePath: string,
): { ok: true; absolutePath: string } | { ok: false; reason: WorkspaceContractDenial; message: string } {
  const base = path.basename(relativePath);
  if (FORBIDDEN_BASENAMES.has(base) || base.startsWith(".env")) {
    return {
      ok: false,
      reason: "SECRET_PATH_IN_WORKSPACE",
      message: "Secret or credential filenames are forbidden inside the agent workspace.",
    };
  }
  const absolute = resolveUnderRoot(contract.hostPath, relativePath);
  if (!absolute) {
    return { ok: false, reason: "PATH_ESCAPE", message: "Path escapes the isolated workspace." };
  }
  return { ok: true, absolutePath: absolute };
}

/**
 * Fail closed if any path component under the workspace is a symlink that resolves
 * outside the workspace host path (symlink escape).
 */
export function assertNoSymlinkEscape(
  workspaceHostPath: string,
  candidatePath: string,
): { ok: true } | { ok: false; reason: "SYMLINK_ESCAPE" | "PATH_ESCAPE"; message: string } {
  const root = path.resolve(workspaceHostPath);
  const candidate = path.resolve(candidatePath);
  const rel = path.relative(root, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { ok: false, reason: "PATH_ESCAPE", message: "Path escapes the isolated workspace." };
  }

  let current = root;
  const parts = rel.split(path.sep).filter(Boolean);
  for (const part of parts) {
    current = path.join(current, part);
    if (!existsSync(current)) continue;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      let real: string;
      try {
        real = realpathSync(current);
      } catch {
        return {
          ok: false,
          reason: "SYMLINK_ESCAPE",
          message: "Symlink could not be resolved inside the workspace.",
        };
      }
      const realRel = path.relative(root, real);
      if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
        return {
          ok: false,
          reason: "SYMLINK_ESCAPE",
          message: "Symlink resolves outside the isolated workspace.",
        };
      }
    }
  }
  return { ok: true };
}
