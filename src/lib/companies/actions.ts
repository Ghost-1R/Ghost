"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { isCompanyOwner } from "@/lib/access/permissions";
import { getAccessContext } from "@/lib/access/session-access";
import { CATALOG_COMPANIES } from "@/lib/access/types";
import { getSession } from "@/lib/auth/session";
import { ensureCatalogCompanies, ensureSiteLinks, linkProjectsToCatalog } from "@/lib/companies/catalog";
import { recordActivitySoft } from "@/lib/team/activity";

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Create the four catalog companies (idempotent) and relink existing projects onto them. */
export async function ensureCatalogAction(_previous: ActionState): Promise<ActionState> {
  void _previous;
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }

  const catalog = await ensureCatalogCompanies(session.supabase, session.user.id);
  if (catalog.status !== "ok") {
    return { error: catalog.error, notice: null };
  }

  const linked = await linkProjectsToCatalog(session.supabase, session.user.id);
  if (linked.status !== "ok") {
    return { error: linked.error, notice: null };
  }

  // Seed known site URLs as UNCONNECTED links — Ghost has not verified any of them.
  for (const company of catalog.companies) {
    const entry = CATALOG_COMPANIES.find((item) => item.slug === company.slug);
    if (entry?.siteUrl) {
      await ensureSiteLinks(session.supabase, company.id, [
        { label: "Storefront", url: entry.siteUrl, connected: false },
      ]);
    }
  }

  revalidatePath("/companies");
  revalidatePath("/projects");
  revalidatePath("/team");

  return {
    error: null,
    notice:
      linked.moved > 0
        ? `Companies are set up. ${linked.moved} project${linked.moved === 1 ? "" : "s"} moved onto them.`
        : "Companies are set up. No projects needed to move.",
  };
}

export async function addSiteLinkAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }

  const companyId = readField(formData, "companyId");
  const label = readField(formData, "label");
  const rawUrl = readField(formData, "url");

  if (!companyId) return { error: "Company is required.", notice: null };
  if (label.length < 1 || label.length > 120) {
    return { error: "Label must be between 1 and 120 characters.", notice: null };
  }

  let url: string;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { error: "Site link must start with http:// or https://.", notice: null };
    }
    url = parsed.toString();
  } catch {
    return { error: "Enter a valid site URL.", notice: null };
  }

  const access = await getAccessContext(session.supabase, session.user.id, session.user.email);
  if (!isCompanyOwner(access, companyId)) {
    return { error: "Only the company owner can add site links.", notice: null };
  }

  // Ghost does not probe the site, so a new link is always recorded as unconnected.
  const { error } = await session.supabase
    .from("company_site_links")
    .insert({ company_id: companyId, label, url, connected: false });

  if (error) {
    return { error: error.message, notice: null };
  }

  await recordActivitySoft(session.supabase, {
    companyId,
    action: "site_link.added",
    summary: `Site link added: ${label}`,
    externalUnconnected: true,
  });

  revalidatePath(`/companies/${companyId}`);
  return { error: null, notice: `${label} added as unconnected.` };
}
