"use client";

import { useActionState } from "react";
import { authenticate, type LoginState } from "@/lib/auth/actions";
import { initialActionState } from "@/lib/action-state";
import { SubmitButton } from "@/components/ui/submit-button";

const initialLoginState: LoginState = { ...initialActionState, email: "", attempt: 0 };

export function LoginForm({ configured }: { configured: boolean }) {
  const [state, formAction, pending] = useActionState(authenticate, initialLoginState);

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
      <input type="hidden" name="attempt" value={state.attempt + 1} />
      <label className="field">
        <span>Email</span>
        <input name="email" type="email" autoComplete="email" defaultValue={state.email} required />
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
      {state.error && !pending ? (
        <p className="alert" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.notice && !pending ? (
        <p className="notice" role="status">
          {state.notice}
        </p>
      ) : null}
    </form>
  );
}
