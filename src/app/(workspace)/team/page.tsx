import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { InviteForm } from "@/components/team/invite-form";
import { EmptyState, ErrorState, Panel } from "@/components/ui/panel";
import { getAccessContext } from "@/lib/access/session-access";
import { isFounder } from "@/lib/access/permissions";
import { getSession } from "@/lib/auth/session";
import { loadCompaniesForUser } from "@/lib/companies/queries";
import { formatTimestamp } from "@/lib/format";
import { revokeInvitationForm, revokeMembershipForm } from "@/lib/team/actions";
import { listInvitations, listMemberships } from "@/lib/team/queries";

export const metadata: Metadata = {
  title: "Team",
};

const ROLE_LABEL = { PROJECT_ADMIN: "Project admin", TEAM_MEMBER: "Team member" } as const;

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const session = await getSession();
  if (session.status !== "authenticated") redirect("/login");

  const access = await getAccessContext(session.supabase, session.user.id, session.user.email);
  if (!isFounder(access)) redirect("/team/my-work");

  const { notice, error } = await searchParams;

  const [companiesResult, invitations, memberships, projects] = await Promise.all([
    loadCompaniesForUser(session.supabase, session.user.id),
    listInvitations(session.supabase),
    listMemberships(session.supabase),
    session.supabase.from("projects").select("id, name, company_id").order("name", { ascending: true }),
  ]);

  const owned =
    companiesResult.status === "ok"
      ? companiesResult.data.filter((company) => company.isOwner && (company.isCatalog || company.projectCount > 0))
      : [];
  const companyName = new Map(
    companiesResult.status === "ok" ? companiesResult.data.map((company) => [company.id, company.name]) : [],
  );
  const projectName = new Map((projects.data ?? []).map((project) => [project.id, project.name]));
  const pending = invitations.status === "ok" ? invitations.data.filter((row) => row.status === "PENDING") : [];

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Team</p>
          <h1>Who can see what.</h1>
          <p className="quiet">Invite people to a company and the projects they work on. You can revoke access any time.</p>
        </div>
        <Link className="button-secondary" href="/team/my-work">
          My Work
        </Link>
      </div>

      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? <ErrorState message={error} /> : null}

      <Panel title="Invite a teammate">
        {owned.length === 0 ? (
          <EmptyState>
            Set up your companies first. <Link href="/companies">Open Companies</Link>
          </EmptyState>
        ) : (
          <InviteForm
            companies={owned.map((company) => ({ id: company.id, name: company.name }))}
            projects={(projects.data ?? []).map((project) => ({
              id: project.id,
              name: project.name,
              companyId: project.company_id,
            }))}
          />
        )}
      </Panel>

      <Panel title="Members">
        {memberships.status === "error" ? <ErrorState message={memberships.message} /> : null}
        {memberships.status === "ok" && memberships.data.length === 0 ? (
          <EmptyState>No teammates yet. Accepted invitations appear here.</EmptyState>
        ) : null}
        {memberships.status === "ok" && memberships.data.length > 0 ? (
          <ul className="projects-index-list">
            {memberships.data.map((member) => (
              <li key={member.id}>
                <div className="projects-index-row">
                  <div>
                    <p>
                      {member.displayName ?? `Teammate ${member.userId.slice(0, 8)}`}{" "}
                      <span className="badge badge-neutral">{ROLE_LABEL[member.role]}</span>
                    </p>
                    <ul className="meta">
                      <li>{companyName.get(member.companyId) ?? "Company"}</li>
                      <li>{member.projectNames.length > 0 ? member.projectNames.join(", ") : "No projects assigned"}</li>
                      <li>Joined {formatTimestamp(member.createdAt)}</li>
                    </ul>
                  </div>
                  <form action={revokeMembershipForm}>
                    <input type="hidden" name="membershipId" value={member.id} />
                    <button className="button-secondary" type="submit">
                      Revoke
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <Panel title="Pending invitations">
        {invitations.status === "error" ? <ErrorState message={invitations.message} /> : null}
        {invitations.status === "ok" && pending.length === 0 ? (
          <EmptyState>No pending invitations.</EmptyState>
        ) : null}
        {pending.length > 0 ? (
          <ul className="projects-index-list">
            {pending.map((invite) => (
              <li key={invite.id}>
                <div className="projects-index-row">
                  <div>
                    <p>
                      {invite.email} <span className="badge badge-neutral">{ROLE_LABEL[invite.role]}</span>
                    </p>
                    <ul className="meta">
                      <li>{companyName.get(invite.companyId) ?? "Company"}</li>
                      <li>
                        {invite.projectIds.length > 0
                          ? invite.projectIds.map((id) => projectName.get(id) ?? "Project").join(", ")
                          : "All company projects"}
                      </li>
                      <li>Expires {formatTimestamp(invite.expiresAt)}</li>
                      <li>
                        <Link href={`/invites/${invite.token}`}>Invite link</Link>
                      </li>
                    </ul>
                  </div>
                  <form action={revokeInvitationForm}>
                    <input type="hidden" name="invitationId" value={invite.id} />
                    <button className="button-secondary" type="submit">
                      Revoke
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <Panel title="Preview a role">
        <p className="quiet">See what each role gets before you invite anyone. Previews change nothing.</p>
        <ul className="meta">
          <li>
            <Link href="/team/my-work?preview=TEAM_MEMBER">Team member view</Link>
          </li>
          <li>
            <Link href="/team/my-work?preview=PROJECT_ADMIN">Project admin view</Link>
          </li>
        </ul>
      </Panel>
    </div>
  );
}
