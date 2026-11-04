import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState, ErrorState, Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { isCompanyOwner } from "@/lib/access/permissions";
import { getAccessContext } from "@/lib/access/session-access";
import { getSession } from "@/lib/auth/session";
import { addSiteLinkAction } from "@/lib/companies/actions";
import { loadCompanyDetail } from "@/lib/companies/queries";
import { formatTimestamp } from "@/lib/format";

export const metadata: Metadata = {
  title: "Company",
};

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (session.status !== "authenticated") redirect("/login");

  const [access, result] = await Promise.all([
    getAccessContext(session.supabase, session.user.id, session.user.email),
    loadCompanyDetail(session.supabase, session.user.id, id),
  ]);

  if (result.status === "error") {
    return (
      <div className="stack">
        <h1>Company</h1>
        <ErrorState message={result.message} />
      </div>
    );
  }
  if (!result.data) notFound();

  const { company, projects, openTaskCount, siteLinks, activity, activityAvailable, memberships } = result.data;
  const owner = isCompanyOwner(access, company.id);
  const siteLinked = siteLinks.some((link) => link.url === company.siteUrl);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">
            <Link href="/companies">Companies</Link> · {company.kind === "INTERNAL" ? "Internal" : "Operating"}
          </p>
          <h1>{company.name}</h1>
          <p className="quiet">{company.description || "No description recorded."}</p>
          <ul className="meta">
            <li>
              {projects.length} project{projects.length === 1 ? "" : "s"}
            </li>
            <li>
              {openTaskCount} open task{openTaskCount === 1 ? "" : "s"}
            </li>
            <li>
              {memberships.active} teammate{memberships.active === 1 ? "" : "s"}
            </li>
            {owner ? <li>{memberships.pendingInvitations} pending invite{memberships.pendingInvitations === 1 ? "" : "s"}</li> : null}
          </ul>
        </div>
        <div className="inline-fields">
          <Link className="button-secondary" href={`/companies/${company.id}/map`}>
            Sales Map
          </Link>
          <Link className="button-secondary" href="/files">
            Files
          </Link>
        </div>
      </div>

      <Panel title="Projects">
        {projects.length === 0 ? (
          <EmptyState>No projects are filed under this company yet.</EmptyState>
        ) : (
          <ul className="projects-index-list">
            {projects.map((project) => (
              <li key={project.id}>
                <div className="projects-index-row">
                  <h3>
                    <Link href={`/projects/${project.id}`}>{project.name}</Link>
                  </h3>
                  <StatusBadge status={project.status} />
                </div>
                <ul className="meta">
                  <li>{project.currentMilestone || "No milestone recorded."}</li>
                  <li>
                    {project.openTasks} open task{project.openTasks === 1 ? "" : "s"}
                  </li>
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Site links">
        <ul className="projects-index-list">
          {siteLinks.map((link) => (
            <li key={link.id}>
              <div className="projects-index-row">
                <span>
                  {link.label} — <span className="quiet">{link.url}</span>
                </span>
                <span className={`badge ${link.connected ? "badge-good" : "badge-warn"}`}>
                  {link.connected ? "Connected" : "Not connected"}
                </span>
              </div>
            </li>
          ))}
          {company.siteUrl && !siteLinked ? (
            <li>
              <div className="projects-index-row">
                <span>
                  Site — <span className="quiet">{company.siteUrl}</span>
                </span>
                <span className="badge badge-warn">Not connected</span>
              </div>
            </li>
          ) : null}
        </ul>
        {siteLinks.length === 0 && !company.siteUrl ? (
          <EmptyState>No site links yet. Ghost has not connected to any external site for this company.</EmptyState>
        ) : null}
        {owner ? (
          <ActionForm action={addSiteLinkAction} submitLabel="Add site link">
            <input type="hidden" name="companyId" value={company.id} />
            <div className="inline-fields">
              <label className="field">
                <span>Label</span>
                <input name="label" required maxLength={120} placeholder="Storefront" />
              </label>
              <label className="field">
                <span>URL</span>
                <input name="url" type="url" required placeholder="https://" />
              </label>
            </div>
            <p className="quiet">Ghost does not probe sites, so new links are saved as not connected.</p>
          </ActionForm>
        ) : null}
      </Panel>

      <Panel title="Recent activity">
        {!activityAvailable ? (
          <EmptyState>Activity is not available until the companies migration is applied.</EmptyState>
        ) : activity.length === 0 ? (
          <EmptyState>No activity recorded yet.</EmptyState>
        ) : (
          <ul className="projects-index-list">
            {activity.map((event) => (
              <li key={event.id}>
                <p>{event.summary}</p>
                <ul className="meta">
                  <li>{event.actorLabel || (event.actorKind === "PERSON" ? "Teammate" : event.actorKind)}</li>
                  <li>{formatTimestamp(event.createdAt)}</li>
                  {event.externalUnconnected ? <li>External source not connected</li> : null}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
