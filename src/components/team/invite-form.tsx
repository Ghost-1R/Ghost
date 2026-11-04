"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import { inviteTeammateAction, type InviteFormState } from "@/lib/team/actions";

const initialState: InviteFormState = { error: null, notice: null, inviteUrl: null };

export function InviteForm({
  companies,
  projects,
}: {
  companies: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string; companyId: string }>;
}) {
  const [state, formAction] = useActionState(inviteTeammateAction, initialState);
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [role, setRole] = useState("TEAM_MEMBER");
  const companyProjects = projects.filter((project) => project.companyId === companyId);

  return (
    <form action={formAction} className="stack">
      <div className="inline-fields">
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" required autoComplete="off" placeholder="name@company.com" />
        </label>
        <label className="field">
          <span>Company</span>
          <select name="companyId" value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Role</span>
          <select name="role" value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="TEAM_MEMBER">Team member</option>
            <option value="PROJECT_ADMIN">Project admin</option>
          </select>
        </label>
      </div>

      <fieldset className="project-picks" key={companyId}>
        <legend className="field-label">
          Projects{role === "PROJECT_ADMIN" ? " (admins can see every project in the company)" : ""}
        </legend>
        {companyProjects.length === 0 ? (
          <p className="quiet">This company has no projects yet.</p>
        ) : (
          companyProjects.map((project) => (
            <label key={project.id} className="check">
              <input type="checkbox" name="projectIds" value={project.id} />
              <span>{project.name}</span>
            </label>
          ))
        )}
      </fieldset>

      <SubmitButton label="Send invitation" />
      {state.error ? (
        <p className="alert" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p className="notice" role="status">
          {state.notice}
          {state.inviteUrl ? (
            <>
              {" "}
              <Link href={state.inviteUrl} data-testid="invite-url">
                {state.inviteUrl}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
    </form>
  );
}
