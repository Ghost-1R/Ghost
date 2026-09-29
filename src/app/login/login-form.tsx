"use client";

import { useActionState } from "react";
import { authenticate } from "@/lib/auth/actions";
import { initialActionState } from "@/lib/action-state";
import { SubmitButton } from "@/components/ui/submit-button";

export function LoginForm({ configured }: { configured: boolean }) {
  const [state, formAction] = useActionState(authenticate, initialActionState);

  if (!configured) {
    return (
      <p className="notice">
        Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in <code>.env.local</code>. Sign-in stays disabled
        until those values exist. No demo session is created.
      </p>
    );
  }

  return (
    <form action={formAction} className="stack">
      <label className="field">
        <span>Email</span>
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label className="field">
        <span>Password</span>
        <input name="password" type="password" autoComplete="current-password" minLength={8} required />
      </label>
      <label className="field">
        <span>Display name, used only when creating an account</span>
        <input name="displayName" type="text" autoComplete="name" maxLength={80} />
      </label>
      <div className="actions">
        <SubmitButton label="Sign in" name="intent" value="sign-in" />
        <SubmitButton label="Create account" name="intent" value="sign-up" variant="secondary" />
      </div>
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
