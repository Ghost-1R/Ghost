import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { ErrorState } from "@/components/ui/panel";
import { getSession } from "@/lib/auth/session";
import { formatTimestamp } from "@/lib/format";
import { acceptInvitationAction } from "@/lib/team/actions";

export const metadata: Metadata = {
  title: "Accept invitation",
};

type InvitePreview = {
  ok?: boolean;
  error?: string;
  company_name?: string;
  email?: string;
  role?: "PROJECT_ADMIN" | "TEAM_MEMBER";
  status?: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  expires_at?: string;
  project_count?: number;
  email_matches?: boolean;
};

const ROLE_LABEL = { PROJECT_ADMIN: "project admin", TEAM_MEMBER: "team member" } as const;
const STATUS_COPY = {
  ACCEPTED: "This invitation was already accepted.",
  REVOKED: "This invitation was revoked. Ask for a new one.",
  EXPIRED: "This invitation has expired. Ask for a new one.",
} as const;

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await getSession();
  if (session.status !== "authenticated") redirect("/login");

  const { data, error } = await session.supabase.rpc("get_team_invitation", { p_token: token });
  const invite = (data ?? {}) as InvitePreview;
  const migrationMissing = error && /could not find the function|does not exist|schema cache/i.test(error.message);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Invitation</p>
          <h1>{invite.ok && invite.company_name ? `Join ${invite.company_name}` : "Team invitation"}</h1>
        </div>
      </div>

      {migrationMissing ? (
        <ErrorState message="Invitations are not available yet: apply migration 20261104210100_team_invitation_rpcs.sql." />
      ) : error ? (
        <ErrorState message={error.message} />
      ) : !invite.ok ? (
        <ErrorState message="This invitation link is not valid." />
      ) : (
        <>
          <ul className="meta">
            <li>Role: {invite.role ? ROLE_LABEL[invite.role] : "team member"}</li>
            <li>Invited email: {invite.email}</li>
            <li>
              {invite.project_count ?? 0} project{invite.project_count === 1 ? "" : "s"}
            </li>
            {invite.expires_at ? <li>Expires {formatTimestamp(invite.expires_at)}</li> : null}
          </ul>

          {invite.status && invite.status !== "PENDING" ? (
            <p className="notice">{STATUS_COPY[invite.status]}</p>
          ) : !invite.email_matches ? (
            <ErrorState
              message={`This invitation was sent to ${invite.email}. You are signed in as ${session.user.email ?? "a different account"}.`}
            />
          ) : (
            <ActionForm action={acceptInvitationAction} submitLabel="Accept invitation">
              <input type="hidden" name="token" value={token} />
              <p className="quiet">You will see only the company and projects named in this invitation.</p>
            </ActionForm>
          )}

          <p>
            <Link href="/team/my-work">Go to My Work</Link>
          </p>
        </>
      )}
    </div>
  );
}
