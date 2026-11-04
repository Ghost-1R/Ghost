import type { GhostClient } from "@/lib/auth/session";
import { fromError, type QueryResult } from "@/lib/result";

export type ActiveProjectDetailCounts = {
  requirementCount: number;
  featureCount: number;
};

export type DashboardGroundedCounts = {
  verifiedItemCount: number;
  productionProjectCount: number;
};

/** Count VERIFIED verification records with a checked_at timestamp — never invents. */
export async function loadDashboardGroundedCounts(
  supabase: GhostClient,
  projectIds: string[],
): Promise<QueryResult<DashboardGroundedCounts>> {
  if (projectIds.length === 0) {
    return { status: "ok", data: { verifiedItemCount: 0, productionProjectCount: 0 } };
  }

  const [verified, production] = await Promise.all([
    supabase
      .from("verification_records")
      .select("id", { count: "exact", head: true })
      .in("project_id", projectIds)
      .eq("state", "VERIFIED")
      .not("checked_at", "is", null),
    supabase
      .from("deployment_environments")
      .select("project_id")
      .in("project_id", projectIds)
      .eq("environment_type", "PRODUCTION")
      .neq("application_url", ""),
  ]);

  if (verified.error) return fromError(verified.error);
  if (production.error) {
    // Deployment table may be absent on older DBs — omit production metric rather than invent.
    if (/relation .* does not exist|Could not find/i.test(production.error.message)) {
      return {
        status: "ok",
        data: { verifiedItemCount: verified.count ?? 0, productionProjectCount: 0 },
      };
    }
    return fromError(production.error);
  }

  const productionIds = new Set((production.data ?? []).map((row) => row.project_id));
  return {
    status: "ok",
    data: {
      verifiedItemCount: verified.count ?? 0,
      productionProjectCount: productionIds.size,
    },
  };
}

export async function loadActiveProductCounts(
  supabase: GhostClient,
  projectId: string,
): Promise<QueryResult<ActiveProjectDetailCounts>> {
  const architecture = await supabase
    .from("product_architectures")
    .select("id")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (architecture.error) {
    if (/relation .* does not exist|Could not find/i.test(architecture.error.message)) {
      return { status: "ok", data: { requirementCount: 0, featureCount: 0 } };
    }
    return fromError(architecture.error);
  }
  if (!architecture.data) {
    return { status: "ok", data: { requirementCount: 0, featureCount: 0 } };
  }

  const [requirements, features] = await Promise.all([
    supabase
      .from("product_requirements")
      .select("id", { count: "exact", head: true })
      .eq("architecture_id", architecture.data.id),
    supabase
      .from("product_features")
      .select("id", { count: "exact", head: true })
      .eq("architecture_id", architecture.data.id),
  ]);
  if (requirements.error) return fromError(requirements.error);
  if (features.error) return fromError(features.error);
  return {
    status: "ok",
    data: {
      requirementCount: requirements.count ?? 0,
      featureCount: features.count ?? 0,
    },
  };
}
