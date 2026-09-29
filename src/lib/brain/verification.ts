import type { BrainVerification } from "./types";

export function evidencePresent(evidence: unknown): boolean {
  if (evidence == null) {
    return false;
  }

  if (typeof evidence === "string") {
    return evidence.trim().length > 0;
  }

  if (Array.isArray(evidence)) {
    return evidence.length > 0;
  }

  if (typeof evidence === "object") {
    return Object.keys(evidence).length > 0;
  }

  return true;
}

export function isSupportedVerified(record: Pick<BrainVerification, "state" | "evidence" | "checkedAt">): boolean {
  return record.state === "VERIFIED" && evidencePresent(record.evidence) && Boolean(record.checkedAt);
}

export function displayVerificationState(record: Pick<BrainVerification, "state" | "evidence" | "checkedAt">): string {
  if (record.state === "VERIFIED" && !isSupportedVerified(record)) {
    return "NOT_VERIFIED";
  }

  return record.state;
}

export function groupVerification(records: BrainVerification[]) {
  const groups = {
    claimed: [] as BrainVerification[],
    observed: [] as BrainVerification[],
    verified: [] as BrainVerification[],
    failed: [] as BrainVerification[],
    notVerified: [] as BrainVerification[],
  };

  for (const record of records) {
    const state = displayVerificationState(record);
    if (state === "CLAIMED") {
      groups.claimed.push(record);
    } else if (state === "OBSERVED") {
      groups.observed.push(record);
    } else if (state === "VERIFIED") {
      groups.verified.push(record);
    } else if (state === "FAILED") {
      groups.failed.push(record);
    } else {
      groups.notVerified.push(record);
    }
  }

  return groups;
}
