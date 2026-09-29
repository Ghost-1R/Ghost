"use client";

import { useActionState } from "react";
import { initialActionState } from "@/lib/action-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { attemptAction, proposeHighRiskAction, reviewAction, runInspection } from "@/lib/inspector/actions";

export function RunInspectionForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(runInspection, initialActionState);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="projectId" value={projectId} />
      <SubmitButton label="Run inspection" />
      {state.error ? <p className="alert">{state.error}</p> : null}
      {state.notice ? <p className="notice">{state.notice}</p> : null}
    </form>
  );
}

export function ProposeActionForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(proposeHighRiskAction, initialActionState);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="projectId" value={projectId} />
      <label className="field">
        <span>Action</span>
        <select name="actionType" defaultValue="apply-remote-migration">
          <option value="apply-remote-migration">Apply a remote migration</option>
          <option value="push">Push</option>
          <option value="merge">Merge</option>
          <option value="remote-db-reset">Remote database reset</option>
          <option value="force-push">Force push</option>
        </select>
      </label>
      <label className="field">
        <span>Target</span>
        <input name="target" required maxLength={200} placeholder="migration filename or branch" />
      </label>
      <label className="field">
        <span>Parameter</span>
        <input name="migration" maxLength={200} placeholder="optional parameter" />
      </label>
      <SubmitButton label="Propose action" />
      <p className="quiet">Proposing records the risk and waits. It does not apply a migration, push, merge, or reset.</p>
      {state.error ? <p className="alert">{state.error}</p> : null}
      {state.notice ? <p className="notice">{state.notice}</p> : null}
    </form>
  );
}

export function ApprovalDecision({
  approvalId,
  target,
  migration,
}: {
  approvalId: string;
  target: string;
  migration: string;
}) {
  const [reviewState, review] = useActionState(reviewAction, initialActionState);
  const [attemptState, attempt] = useActionState(attemptAction, initialActionState);
  return (
    <div className="stack">
      <form action={review} className="inline-form">
        <input type="hidden" name="approvalId" value={approvalId} />
        <SubmitButton label="Approve" name="decision" value="APPROVED" />
        <SubmitButton label="Reject" name="decision" value="REJECTED" />
        {reviewState.error ? <p className="alert">{reviewState.error}</p> : null}
        {reviewState.notice ? <p className="notice">{reviewState.notice}</p> : null}
      </form>
      <form action={attempt} className="stack">
        <input type="hidden" name="approvalId" value={approvalId} />
        <label className="field">
          <span>Execution target</span>
          <input name="target" defaultValue={target} maxLength={200} />
        </label>
        <label className="field">
          <span>Execution parameter</span>
          <input name="migration" defaultValue={migration} maxLength={200} />
        </label>
        <SubmitButton label="Attempt execution" />
        {attemptState.error ? <p className="alert">{attemptState.error}</p> : null}
        {attemptState.notice ? <p className="notice">{attemptState.notice}</p> : null}
      </form>
    </div>
  );
}
