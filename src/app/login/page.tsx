import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/app/login/login-form";
import { GhostCore } from "@/components/ghost/experience";
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
          <GhostCore size="mark" state="IDLE" />
          GHOST
        </Link>
      </header>
      <main className="public-main login-stage" id="main">
        <div className="login-mark">
          <GhostCore size="stage" state="IDLE" />
          <p className="eyebrow">Your second mind</p>
        </div>
        <div className="login-panel">
          <h1>Enter Ghost.</h1>
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
        </div>
      </main>
    </div>
  );
}
