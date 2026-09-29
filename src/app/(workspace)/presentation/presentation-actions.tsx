"use client";

import { useActionState } from "react";
import { initialActionState } from "@/lib/action-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { runPresentationReview } from "@/lib/presentation/actions";

export function PresentationReviewForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(runPresentationReview, initialActionState);
  return (
    <div className="stack">
      <form action={action} className="inline-form">
        <input type="hidden" name="projectId" value={projectId} />
        <SubmitButton label="Run presentation review" />
      </form>
      <form action={action} className="inline-form">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="disposable" value="fail" />
        <SubmitButton label="Review with disposable failure" variant="secondary" />
      </form>
      {state.error ? <p className="alert">{state.error}</p> : null}
      {state.notice ? <p className="notice">{state.notice}</p> : null}
    </div>
  );
}
