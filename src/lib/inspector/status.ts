import type { InspectionResult, InspectionStatus } from "./types";

export function treeStamp(commit: string, changedFiles: string[]): string {
  return `${commit}\n${[...changedFiles].sort().join("\n")}`;
}

export function isStale(
  result: Pick<InspectionResult, "commit" | "treeStamp">,
  current: { commit: string; treeStamp: string },
): boolean {
  if (!result.commit || !result.treeStamp) {
    return true;
  }
  return result.treeStamp !== current.treeStamp;
}

export function staleSummary(
  result: Pick<InspectionResult, "name" | "status" | "commit" | "workingTree">,
  current: { commit: string; workingTree: "clean" | "dirty" },
): string {
  const recorded = result.commit ? result.commit.slice(0, 7) : "unknown";
  return `${result.name} was ${result.status} at commit ${recorded} with working tree ${result.workingTree ?? "unknown"}. The current repository is ${current.commit.slice(0, 7)} with working tree ${current.workingTree}. That earlier result does not verify the current tree.`;
}

export function deploymentStatus(input: { provider: string | null; buildVerified: boolean }): InspectionStatus {
  if (input.provider && input.buildVerified) {
    return "NOT_VERIFIED";
  }
  return "NOT_VERIFIED";
}

export function databaseDistinction(input: { migrationFileExists: boolean; remoteSupported: boolean }): {
  fileStatus: InspectionStatus;
  remoteStatus: InspectionStatus;
} {
  return {
    fileStatus: input.migrationFileExists ? "OBSERVED" : "NOT_VERIFIED",
    remoteStatus: input.remoteSupported ? "VERIFIED" : "NOT_VERIFIED",
  };
}

export function authSignupStatus(input: { accountAccepted: boolean; emailConfirmed: boolean }): InspectionStatus {
  if (input.accountAccepted && input.emailConfirmed) {
    return "VERIFIED";
  }
  return "NOT_VERIFIED";
}
