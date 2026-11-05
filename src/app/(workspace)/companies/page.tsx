import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState, ErrorState } from "@/components/ui/panel";
import { getAccessContext, hasFounderSurface } from "@/lib/access/session-access";
import { CATALOG_COMPANIES } from "@/lib/access/types";
import { getSession } from "@/lib/auth/session";
import { ensureCatalogAction } from "@/lib/companies/actions";
import { loadCompaniesForUser, type CompanySummary } from "@/lib/companies/queries";
import { checkSchemaFeature } from "@/lib/schema/readiness";

export const metadata: Metadata = {
  title: "Companies",
};

function CompanyList({ companies }: { companies: CompanySummary[] }) {
  return (
    <ul className="projects-index-list">
      {companies.map((company) => (
        <li key={company.id}>
          <article>
            <div className="projects-index-row">
              <h3>
                <Link href={`/companies/${company.id}`}>{company.name}</Link>
              </h3>
              {company.siteUrl ? <span className="badge badge-warn">Site not connected</span> : null}
            </div>
            <p className="quiet">{company.description || "No description recorded."}</p>
            <ul className="meta">
              <li>
                {company.projectCount} project{company.projectCount === 1 ? "" : "s"}
              </li>
              <li>
                {company.memberCount} teammate{company.memberCount === 1 ? "" : "s"}
              </li>
            </ul>
          </article>
        </li>
      ))}
    </ul>
  );
}

export default async function CompaniesPage() {
  const session = await getSession();
  if (session.status !== "authenticated") redirect("/login");

  const [access, result, catalogSchema] = await Promise.all([
    getAccessContext(session.supabase, session.user.id, session.user.email),
    loadCompaniesForUser(session.supabase, session.user.id),
    checkSchemaFeature(session.supabase, "companies_catalog"),
  ]);
  const founderSurface = hasFounderSurface(access);

  const shown =
    result.status === "ok"
      ? result.data.filter((company) => company.isCatalog || company.projectCount > 0 || !founderSurface)
      : [];
  const operating = shown.filter((company) => company.kind === "OPERATING");
  const internal = shown.filter((company) => company.kind === "INTERNAL");
  const catalogCount = shown.filter((company) => company.isCatalog).length;
  const needsSetup = founderSurface && catalogSchema.ready && catalogCount < CATALOG_COMPANIES.length;
  const schemaBlocked = founderSurface && !catalogSchema.ready;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Companies</p>
          <h1>Where the work lives.</h1>
          <p className="quiet">Operating companies first, then Ghost&apos;s own internal work.</p>
        </div>
      </div>

      {result.status === "error" ? <ErrorState message={result.message} /> : null}

      {schemaBlocked ? (
        <section className="notice" role="status" aria-label="Company setup unavailable">
          <p>
            <strong>Company setup is temporarily unavailable.</strong> The production database still needs the
            verified Companies/Team migration before catalog companies can be created.
          </p>
          <p className="quiet">
            Next action: finish a privileged backup and isolated restore for project{" "}
            <code>wzwrrleqfylhuxfbukfu</code>, then apply the hosted migration playbook.
          </p>
        </section>
      ) : null}

      {needsSetup ? (
        <ActionForm action={ensureCatalogAction} submitLabel="Set up companies">
          <p className="quiet">
            Creates Ivoire Market, IM Distributors, Badger United, and Internal, then files your existing projects
            under them. Safe to run again.
          </p>
        </ActionForm>
      ) : null}

      {result.status === "ok" && shown.length === 0 ? (
        <EmptyState>No companies are visible to you yet.</EmptyState>
      ) : null}

      {operating.length > 0 ? (
        <section className="stack" aria-labelledby="companies-operating">
          <h2 id="companies-operating" className="group-heading">
            Operating
          </h2>
          <CompanyList companies={operating} />
        </section>
      ) : null}

      {internal.length > 0 ? (
        <section className="stack" aria-labelledby="companies-internal">
          <h2 id="companies-internal" className="group-heading">
            Internal
          </h2>
          <CompanyList companies={internal} />
        </section>
      ) : null}
    </div>
  );
}
