import type { AuthorizationStatus, FounderActionAuthorization } from "./types";

export type ApprovalCenterBuckets = {
  pending: FounderActionAuthorization[];
  approved: FounderActionAuthorization[];
  rejected: FounderActionAuthorization[];
  expiredOrRevoked: FounderActionAuthorization[];
  consumed: FounderActionAuthorization[];
};

/** Bucket by effective status so expired PENDING/APPROVED appear under expired. */
export function bucketAuthorizations(
  rows: readonly FounderActionAuthorization[],
): ApprovalCenterBuckets {
  const buckets: ApprovalCenterBuckets = {
    pending: [],
    approved: [],
    rejected: [],
    expiredOrRevoked: [],
    consumed: [],
  };

  for (const row of rows) {
    const status: AuthorizationStatus = row.effectiveStatus;
    if (status === "PENDING") buckets.pending.push(row);
    else if (status === "APPROVED") buckets.approved.push(row);
    else if (status === "REJECTED") buckets.rejected.push(row);
    else if (status === "EXPIRED" || status === "REVOKED") buckets.expiredOrRevoked.push(row);
    else if (status === "CONSUMED") buckets.consumed.push(row);
    else buckets.expiredOrRevoked.push(row);
  }

  return buckets;
}
