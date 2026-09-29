import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { inspectGithubRepository } from "@/lib/repository/github";
import { readGitState } from "@/lib/repository/local-git";
import { commandAllowed, DISPOSABLE_FAILURE_CHECK, findSafeCheck } from "./checks";
import { sanitizeOutput } from "./sanitize";
import { authSignupStatus, databaseDistinction, deploymentStatus, treeStamp } from "./status";
import type { CheckDefinition, InspectionResult } from "./types";

const execFileAsync = promisify(execFile);

function platformCommand(command: readonly string[]): string[] {
  const [bin, ...args] = command;
  if (process.platform === "win32" && (bin === "npm" || bin === "npx")) {
    return [`${bin}.cmd`, ...args];
  }
  return [...command];
}

function quoteCmd(arg: string): string {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(arg)) {
    return arg;
  }
  return `"${arg.replaceAll('"', '""')}"`;
}

async function runCommand(check: CheckDefinition, cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (!check.command || !commandAllowed(check.command)) {
    throw new Error("That command is not allowlisted.");
  }
  const [bin, ...args] = platformCommand(check.command);
  if (!bin) {
    throw new Error("That command is not allowlisted.");
  }
  const command = bin.endsWith(".cmd") ? ["cmd.exe", ["/d", "/s", "/c", [bin, ...args.map(quoteCmd)].join(" ")]] as const : [bin, args] as const;
  try {
    const result = await execFileAsync(command[0], command[1], {
      cwd,
      windowsHide: true,
      timeout: check.timeoutMs,
      maxBuffer: 1_000_000,
      env: check.id === "build" ? { ...process.env, NODE_ENV: "production" } : process.env,
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failed = error as { code?: number | string; stdout?: string; stderr?: string };
    const exitCode = typeof failed.code === "number" ? failed.code : 1;
    return { exitCode, stdout: failed.stdout ?? "", stderr: failed.stderr ?? String(failed.code ?? "failed") };
  }
}

async function gitBinding(cwd: string): Promise<{ commit: string; workingTree: "clean" | "dirty"; treeStamp: string }> {
  const state = await readGitState(cwd);
  return {
    commit: state.commit,
    workingTree: state.workingTree,
    treeStamp: treeStamp(state.commit, state.changedFiles),
  };
}

function baseResult(
  check: CheckDefinition,
  ownerId: string,
  projectId: string | null,
  startedAt: string,
  binding: { commit: string | null; workingTree: "clean" | "dirty" | null; treeStamp: string | null },
): Omit<InspectionResult, "status" | "completedAt" | "exitCode" | "stdout" | "stderr" | "summary"> {
  return {
    id: randomUUID(),
    ownerId,
    projectId,
    checkId: check.id,
    checkType: check.type,
    name: check.name,
    risk: check.risk,
    startedAt,
    commit: binding.commit,
    workingTree: binding.workingTree,
    treeStamp: binding.treeStamp,
    scope: check.scope,
  };
}

export async function executeCheck(
  check: CheckDefinition,
  input: { ownerId: string; projectId: string | null; cwd: string },
): Promise<InspectionResult> {
  const startedAt = new Date().toISOString();
  const binding = check.scope === "local" ? await gitBinding(input.cwd).catch(() => null) : null;
  const bound = baseResult(check, input.ownerId, input.projectId, startedAt, {
    commit: binding?.commit ?? null,
    workingTree: binding?.workingTree ?? null,
    treeStamp: binding?.treeStamp ?? null,
  });

  if (check.command) {
    if (!commandAllowed(check.command)) {
      return {
        ...bound,
        status: "BLOCKED",
        completedAt: new Date().toISOString(),
        exitCode: null,
        stdout: "",
        stderr: "",
        summary: "The command is not allowlisted, so it was not executed.",
      };
    }
    const output = await runCommand(check, input.cwd);
    const passed = output.exitCode === check.expectedExit;
    return {
      ...bound,
      status: passed ? "VERIFIED" : "FAILED",
      completedAt: new Date().toISOString(),
      exitCode: output.exitCode,
      stdout: sanitizeOutput(output.stdout),
      stderr: sanitizeOutput(output.stderr),
      summary: passed
        ? `${check.name} exited 0 at commit ${bound.commit?.slice(0, 7) ?? "unknown"}. This does not prove deployment.`
        : `${check.name} failed with exit ${output.exitCode} at commit ${bound.commit?.slice(0, 7) ?? "unknown"}.`,
    };
  }

  return finishStaticCheck(check, bound, input.cwd);
}

async function finishStaticCheck(
  check: CheckDefinition,
  bound: Omit<InspectionResult, "status" | "completedAt" | "exitCode" | "stdout" | "stderr" | "summary">,
  cwd: string,
): Promise<InspectionResult> {
  const completedAt = new Date().toISOString();
  if (check.id === "git-status") {
    const state = await readGitState(cwd);
    return {
      ...bound,
      status: "VERIFIED",
      completedAt,
      exitCode: 0,
      stdout: sanitizeOutput(`${state.branch} ${state.commit} ${state.workingTree}`),
      stderr: "",
      commit: state.commit,
      workingTree: state.workingTree,
      treeStamp: treeStamp(state.commit, state.changedFiles),
      summary: `Branch ${state.branch}. Commit ${state.commit}. Working tree ${state.workingTree}.`,
    };
  }

  if (check.id === "repository-readme") {
    const info = await stat(path.join(cwd, "README.md")).catch(() => null);
    const exists = Boolean(info?.isFile());
    return {
      ...bound,
      status: exists ? "OBSERVED" : "NOT_VERIFIED",
      completedAt,
      exitCode: null,
      stdout: "",
      stderr: "",
      summary: exists
        ? "README.md exists in the working tree. File existence is OBSERVED, not verification of the product."
        : "README.md was not found.",
    };
  }

  if (check.id === "database") {
    const migration = path.join(cwd, "supabase", "migrations", "20260929015943_alpha_foundation.sql");
    const exists = Boolean((await stat(migration).catch(() => null))?.isFile());
    const distinction = databaseDistinction({ migrationFileExists: exists, remoteSupported: false });
    return {
      ...bound,
      status: distinction.fileStatus,
      completedAt,
      exitCode: null,
      stdout: "",
      stderr: "",
      summary:
        "Local migration files are OBSERVED. This check did not query or change the remote database. A stored verification record can remain VERIFIED_REMOTE only with its own evidence. Remote state was not re-proven here.",
    };
  }

  if (check.id === "auth-signup") {
    const raw = await readFile(path.join(cwd, ".ghost", "state.json"), "utf8").catch(() => "");
    const accepted = raw.includes("Create account was accepted");
    const confirmed = raw.includes("email confirmation is true");
    const status = authSignupStatus({ accountAccepted: accepted, emailConfirmed: confirmed });
    return {
      ...bound,
      status,
      completedAt,
      exitCode: null,
      stdout: "",
      stderr: "",
      summary: accepted
        ? "Account creation is OBSERVED. Email confirmation is not verified, so the full auth flow is NOT_VERIFIED."
        : "Sign-up confirmation is NOT_VERIFIED.",
    };
  }

  if (check.id === "deployment") {
    const status = deploymentStatus({ provider: null, buildVerified: false });
    return {
      ...bound,
      status,
      completedAt,
      exitCode: null,
      stdout: "",
      stderr: "",
      summary: "No deployment provider is configured. Production is NOT_VERIFIED. A successful build does not verify deployment.",
    };
  }

  if (check.id === "github-remote") {
    const remote = await inspectGithubRepository();
    return {
      ...bound,
      status: remote.available ? "OBSERVED" : "BLOCKED",
      completedAt,
      exitCode: null,
      stdout: "",
      stderr: "",
      summary: remote.available
        ? "GitHub responded to a read-only inspection. No write was performed."
        : "BLOCKED — GITHUB_AUTH_REQUIRED. Remote state was not inspected. No pull, push, or merge was performed.",
    };
  }

  return {
    ...bound,
    status: "NOT_VERIFIED",
    completedAt,
    exitCode: null,
    stdout: "",
    stderr: "",
    summary: "A model answer is not verification. This check does not call a model and does not create VERIFIED.",
  };
}

export async function runSafeCheck(
  id: string,
  input: { ownerId: string; projectId: string | null; cwd: string },
): Promise<InspectionResult | null> {
  const check = findSafeCheck(id);
  if (!check) {
    return null;
  }
  return executeCheck(check, input);
}

export async function runDisposableFailure(input: {
  ownerId: string;
  projectId: string | null;
  cwd: string;
}): Promise<InspectionResult> {
  return executeCheck(DISPOSABLE_FAILURE_CHECK, input);
}
