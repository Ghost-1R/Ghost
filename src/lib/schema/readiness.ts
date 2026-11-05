import type { GhostClient } from "@/lib/auth/session";
import { isMissingRelation, loose } from "@/lib/db/loose";

export type SchemaFeature =
  | "companies_catalog"
  | "team"
  | "assignments"
  | "activity"
  | "day_plans"
  | "sales_map"
  | "underworld";

export type SchemaReadiness = {
  ready: boolean;
  feature: SchemaFeature;
  missing: string[];
  founderMessage: string;
  nextAction: string;
};

const FOUNDER_UNAVAILABLE =
  "Company setup is temporarily unavailable. The production database still needs the verified Companies/Team migration.";

const NEXT_ACTION =
  "Founder: complete a privileged Supabase backup + isolated restore for wzwrrleqfylhuxfbukfu, then apply the migration order in .ghost/founder-worker-experience/evidence/companies-team/HOSTED_MIGRATION_PLAYBOOK.md.";

type Probe = { label: string; run: (client: GhostClient) => Promise<string | null> };

async function probeSelect(
  client: GhostClient,
  table: string,
  columns: string,
): Promise<string | null> {
  const { error } = await loose(client).from(table).select(columns).limit(1);
  if (!error) return null;
  if (isMissingRelation(error.message) || /column .* does not exist|42703|PGRST205/i.test(error.message)) {
    return `${table} (${columns}): ${error.message.split("\n")[0]}`;
  }
  // Permission/unknown — fail closed for safety
  return `${table}: cannot verify (${error.message.split("\n")[0]})`;
}

const PROBES: Record<SchemaFeature, Probe[]> = {
  companies_catalog: [
    {
      label: "companies.kind",
      run: (c) => probeSelect(c, "companies", "id, kind, is_catalog, site_url"),
    },
    {
      label: "company_site_links",
      run: (c) => probeSelect(c, "company_site_links", "id, company_id"),
    },
  ],
  team: [
    {
      label: "company_memberships",
      run: (c) => probeSelect(c, "company_memberships", "id, company_id, user_id, role"),
    },
    {
      label: "project_memberships",
      run: (c) => probeSelect(c, "project_memberships", "id, project_id, user_id"),
    },
    {
      label: "team_invitations",
      run: (c) => probeSelect(c, "team_invitations", "id, company_id, email, token, status"),
    },
  ],
  assignments: [
    {
      label: "work_assignments",
      run: (c) => probeSelect(c, "work_assignments", "id, company_id, project_id, kind, status"),
    },
  ],
  activity: [
    {
      label: "project_activity_events",
      run: (c) => probeSelect(c, "project_activity_events", "id, company_id, action, summary"),
    },
  ],
  day_plans: [
    {
      label: "founder_day_plans",
      run: (c) => probeSelect(c, "founder_day_plans", "id, owner_id, plan_date"),
    },
  ],
  sales_map: [
    {
      label: "company_orders",
      run: (c) => probeSelect(c, "company_orders", "id, company_id"),
    },
    {
      label: "zip_centroids",
      run: (c) => probeSelect(c, "zip_centroids", "zip"),
    },
    {
      label: "company_map_grants",
      run: (c) => probeSelect(c, "company_map_grants", "id, company_id, user_id"),
    },
  ],
  underworld: [
    {
      label: "underworld_goals",
      run: (c) => probeSelect(c, "underworld_goals", "id, project_id, status"),
    },
    {
      label: "underworld_plans",
      run: (c) => probeSelect(c, "underworld_plans", "id, goal_id, status"),
    },
    {
      label: "underworld_steps",
      run: (c) => probeSelect(c, "underworld_steps", "id, plan_id, role, status"),
    },
  ],
};

export async function checkSchemaFeature(
  client: GhostClient,
  feature: SchemaFeature,
): Promise<SchemaReadiness> {
  const missing: string[] = [];
  for (const probe of PROBES[feature]) {
    const result = await probe.run(client);
    if (result) missing.push(result);
  }
  const ready = missing.length === 0;
  return {
    ready,
    feature,
    missing,
    founderMessage: ready ? "" : FOUNDER_UNAVAILABLE,
    nextAction: ready ? "" : NEXT_ACTION,
  };
}

export async function requireSchemaFeature(
  client: GhostClient,
  feature: SchemaFeature,
): Promise<{ ok: true } | { ok: false; readiness: SchemaReadiness }> {
  const readiness = await checkSchemaFeature(client, feature);
  if (!readiness.ready) {
    console.error("[schema-readiness]", feature, readiness.missing.join(" | "));
    return { ok: false, readiness };
  }
  return { ok: true };
}

export const SCHEMA_UNAVAILABLE_USER_ERROR =
  "Company setup is temporarily unavailable. Ask the founder to finish the production database migration, then try again.";
