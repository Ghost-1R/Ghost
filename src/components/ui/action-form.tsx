"use client";

import { useActionState, type ReactNode } from "react";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { SubmitButton } from "@/components/ui/submit-button";

export function ActionForm({
  action,
  submitLabel,
  children,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  children: ReactNode;
}) {
  const [state, formAction] = useActionState(action, initialActionState);

  return (
    <form action={formAction} className="stack">
      {children}
      <SubmitButton label={submitLabel} />
      {state.error ? (
        <p className="alert" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p className="notice" role="status">
          {state.notice}
        </p>
      ) : null}
    </form>
  );
}
