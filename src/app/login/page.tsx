import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/app/login/login-form";
import { getSupabaseEnv } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const configured = getSupabaseEnv() !== null;

  return (
    <div className="public-page">
      <header className="public-header">
        <Link className="wordmark" href="/">
          <span className="mark" aria-hidden="true" />
          GHOST
        </Link>
      </header>
      <main className="public-main" id="main">
        <p className="eyebrow">Authentication</p>
        <h1>Sign in.</h1>
        <p className="lede">
          Email and password only. Social login, teams, and billing are not part of this foundation.
        </p>
        {reason === "unconfigured" ? (
          <p className="notice">
            A protected page was requested, and Supabase is not configured, so Ghost did not invent a
            session.
          </p>
        ) : null}
        {reason === "confirm-failed" ? (
          <p className="alert" role="alert">
            Supabase did not exchange this confirmation code for a session.
          </p>
        ) : null}
        <LoginForm configured={configured} />
      </main>
    </div>
  );
}
