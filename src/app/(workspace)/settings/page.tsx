import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import { SoundSettings } from "@/components/ghost/experience";
import { ActionForm } from "@/components/ui/action-form";
import { ErrorState, Panel } from "@/components/ui/panel";
import { describeProviderPolicy } from "@/lib/ai/provider";
import { createOwnProfile, updateProfile } from "@/lib/auth/actions";
import { getSession } from "@/lib/auth/session";
import { getDeploymentSelection } from "@/lib/deployment/provider";
import { RISK_HANDLING, RISK_LEVELS } from "@/lib/risk/levels";
import { getSupabaseEnv } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Settings",
};

async function readPortableState(): Promise<{ text: string } | { error: string }> {
  try {
    const filePath = path.join(process.cwd(), ".ghost", "state.json");
    const text = await readFile(filePath, "utf8");
    JSON.parse(text);
    return { text };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not read .ghost/state.json.",
    };
  }
}

export default async function SettingsPage() {
  const session = await getSession();
  if (session.status !== "authenticated") {
    redirect("/login");
  }

  const deployment = getDeploymentSelection();
  const intelligence = describeProviderPolicy();
  const configured = getSupabaseEnv() !== null;
  const [portable, profileResult] = await Promise.all([
    readPortableState(),
    session.supabase.from("profiles").select("display_name, updated_at").eq("id", session.user.id).maybeSingle(),
  ]);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Account and truth.</h1>
        </div>
      </div>

      <Panel title="Sound">
        <SoundSettings />
      </Panel>

      <Panel title="Session">
        <ul className="meta">
          <li>Email: {session.user.email ?? "Not present on the verified token."}</li>
          <li>User id: {session.user.id}</li>
          <li>Supabase public env: {configured ? "present" : "missing"}</li>
        </ul>
        <p className="quiet">
          The email comes from a verified access-token claim. It is not a check that the profile
          trigger ran.
        </p>
      </Panel>

      <Panel title="Profile">
        {profileResult.error ? <ErrorState message={profileResult.error.message} /> : null}
        {!profileResult.error && !profileResult.data ? (
          <div className="stack">
            <p className="notice">No profile row is visible for this user.</p>
            <ActionForm action={createOwnProfile} submitLabel="Create profile row">
              <label className="field">
                <span>Display name</span>
                <input name="displayName" maxLength={80} />
              </label>
            </ActionForm>
          </div>
        ) : null}
        {profileResult.data ? (
          <ActionForm action={updateProfile} submitLabel="Save display name">
            <label className="field">
              <span>Display name</span>
              <input
                name="displayName"
                required
                maxLength={80}
                defaultValue={profileResult.data.display_name ?? ""}
              />
            </label>
          </ActionForm>
        ) : null}
      </Panel>

      <Panel title="Intelligence">
        <ul className="meta">
          <li>Provider: {intelligence.provider}</li>
          <li>Model: {intelligence.model}</li>
          <li>Status: {intelligence.status === "READY" ? "Ready" : "Not configured"}</li>
          <li>Cost policy: {intelligence.costPolicy}</li>
          <li>Paid fallback: {intelligence.paidFallback}</li>
        </ul>
        <p className="quiet">
          {intelligence.paidSelected
            ? "A paid provider is selected explicitly. Ghost still never switches providers on failure."
            : "Ghost never switches to a paid provider on its own. A provider failure is reported, not rerouted."}
        </p>
      </Panel>

      <Panel title="Deployment">
        <ul className="meta">
          <li>Provider: {deployment.provider ?? "none selected"}</li>
          <li>Vercel allowed: {deployment.vercelAllowed ? "yes" : "no"}</li>
        </ul>
        <p className="quiet">No deployment provider is registered. A local build is not a deployment.</p>
      </Panel>

      <Panel title="Risk handling">
        <p className="quiet">These levels are documented only. Alpha does not enforce them.</p>
        <ul className="meta">
          {RISK_LEVELS.map((level) => (
            <li key={level}>
              {level}: {RISK_HANDLING[level]}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Portable project state">
        <p className="quiet">
          Read from .ghost/state.json when this page rendered. This is the file on disk, not a live
          production probe.
        </p>
        {"error" in portable ? <ErrorState message={portable.error} /> : <pre className="prose">{portable.text}</pre>}
      </Panel>
    </div>
  );
}
