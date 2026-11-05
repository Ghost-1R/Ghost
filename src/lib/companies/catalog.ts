import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { CATALOG_COMPANIES } from "@/lib/access/types";
import { slugify } from "@/lib/slug";

type Client = SupabaseClient<Database>;

export type CatalogCompany = {
  id: string;
  slug: string;
  name: string;
  kind: "OPERATING" | "INTERNAL";
  description: string;
};

/** Ensure the four founder catalog companies exist for this owner. Idempotent. */
export async function ensureCatalogCompanies(
  supabase: Client,
  ownerId: string,
): Promise<{ status: "ok"; companies: CatalogCompany[] } | { status: "error"; error: string }> {
  const companies: CatalogCompany[] = [];

  for (const entry of CATALOG_COMPANIES) {
    const { data: existing, error: selectError } = await supabase
      .from("companies")
      .select("id, slug, name, kind, description")
      .eq("owner_id", ownerId)
      .eq("slug", entry.slug)
      .maybeSingle();

    if (selectError) {
      return { status: "error", error: selectError.message };
    }

    if (existing?.id) {
      const { error: updateError } = await supabase
        .from("companies")
        .update({
          name: entry.name,
          description: entry.description,
          kind: entry.kind,
          site_url: entry.siteUrl,
          is_catalog: true,
        })
        .eq("id", existing.id);

      if (updateError) {
        return { status: "error", error: updateError.message };
      }

      companies.push({
        id: existing.id,
        slug: entry.slug,
        name: entry.name,
        kind: entry.kind,
        description: entry.description,
      });
      continue;
    }

    const { data: created, error: insertError } = await supabase
      .from("companies")
      .insert({
        owner_id: ownerId,
        name: entry.name,
        slug: entry.slug,
        description: entry.description,
        kind: entry.kind,
        site_url: entry.siteUrl,
        is_catalog: true,
      })
      .select("id, slug, name, kind, description")
      .single();

    if (insertError || !created) {
      return { status: "error", error: insertError?.message ?? "Company was not created." };
    }

    companies.push({
      id: created.id,
      slug: created.slug,
      name: created.name,
      kind: created.kind as "OPERATING" | "INTERNAL",
      description: created.description,
    });
  }

  return { status: "ok", companies };
}

function classifySlug(projectName: string): string {
  for (const entry of CATALOG_COMPANIES) {
    if (entry.slug === "internal") continue;
    if (entry.matchProject(projectName)) return entry.slug;
  }
  return "internal";
}

/**
 * Relink existing projects onto catalog companies without duplicating project rows.
 * Legacy "Workspace" shell companies are left in place but emptied when possible.
 */
export async function linkProjectsToCatalog(
  supabase: Client,
  ownerId: string,
): Promise<{ status: "ok"; moved: number } | { status: "error"; error: string }> {
  const catalog = await ensureCatalogCompanies(supabase, ownerId);
  if (catalog.status !== "ok") return catalog;

  const bySlug = new Map(catalog.companies.map((company) => [company.slug, company.id]));

  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, name, company_id, companies!inner(owner_id)")
    .eq("companies.owner_id", ownerId);

  if (error) {
    return { status: "error", error: error.message };
  }

  let moved = 0;
  for (const project of projects ?? []) {
    const targetSlug = classifySlug(project.name);
    const targetCompanyId = bySlug.get(targetSlug);
    if (!targetCompanyId || project.company_id === targetCompanyId) continue;

    const { error: updateError } = await supabase
      .from("projects")
      .update({ company_id: targetCompanyId })
      .eq("id", project.id);

    if (updateError) {
      return { status: "error", error: updateError.message };
    }
    moved += 1;
  }

  return { status: "ok", moved };
}

export async function ensureSiteLinks(
  supabase: Client,
  companyId: string,
  links: Array<{ label: string; url: string; connected?: boolean }>,
): Promise<void> {
  for (const link of links) {
    const { data: existing } = await supabase
      .from("company_site_links")
      .select("id")
      .eq("company_id", companyId)
      .eq("label", link.label)
      .maybeSingle();

    if (existing?.id) continue;

    await supabase.from("company_site_links").insert({
      company_id: companyId,
      label: link.label,
      url: link.url,
      connected: link.connected ?? false,
    });
  }
}

export function companyPathSlug(name: string): string {
  return slugify(name);
}
