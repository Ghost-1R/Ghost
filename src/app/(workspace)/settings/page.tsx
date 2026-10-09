import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SoundSettings } from "@/components/ghost/experience";
import { VoiceSettings } from "@/components/ghost/voice";
import { SettingsControlCenter } from "@/components/settings/control-center";
import { FounderPreferenceForm } from "@/components/settings/preference-form";
import { PreferenceShell } from "@/components/settings/preference-shell";
import { ActionForm } from "@/components/ui/action-form";
import { ErrorState, Panel } from "@/components/ui/panel";
import { describeProviderPolicy } from "@/lib/ai/provider";
import { createOwnProfile, updateProfile } from "@/lib/auth/actions";
import { getSession } from "@/lib/auth/session";
import { getDeploymentSelection } from "@/lib/deployment/provider";
import { buildControlCenterStatus } from "@/lib/preferences/status";
import { loadFounderPreferences } from "@/lib/preferences/store";
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
  const [portable, profileResult, prefsResult] = await Promise.all([
    readPortableState(),
    session.supabase.from("profiles").select("display_name, updated_at").eq("id", session.user.id).maybeSingle(),
    loadFounderPreferences(session.supabase, session.user.id),
  ]);

  if (prefsResult.status === "error") {
    return (
      <div className="stack">
        <div className="page-head">
          <div>
            <p className="eyebrow">Settings</p>
            <h1>Control Center</h1>
          </div>
        </div>
        <ErrorState message={prefsResult.message} />
      </div>
    );
  }

  const preferences = prefsResult.data;
  const status = buildControlCenterStatus(preferences);

  const sections = {
    account: (
      <div className="stack">
        <Panel title="Session">
          <ul className="meta">
            <li>Email: {session.user.email ?? "Not present on the verified token."}</li>
            <li>User id: {session.user.id}</li>
            <li>Supabase public env: {configured ? "present" : "missing"}</li>
          </ul>
          <p className="quiet">
            The email comes from a verified access-token claim. It is not a check that the profile trigger ran.
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
      </div>
    ),
    personality: (
      <Panel title="Ghost Personality">
        <p className="quiet">
          Style and detail change how Ghost speaks. They cannot invent evidence, bypass privacy, or execute work.
        </p>
        <FounderPreferenceForm preferences={preferences} />
        <p className="quiet">Active account layer: {status.preferenceSummary}</p>
      </Panel>
    ),
    voice: (
      <div className="stack">
        <Panel title="Account audio defaults">
          <p className="quiet">
            Sound enablement and volume persist per account (save under Ghost Personality or Appearance). Device voice
            engine settings below stay on this browser because voices are local.
          </p>
          <ul className="meta">
            <li>Account sound: {preferences.soundEnabled ? "enabled" : "disabled"}</li>
            <li>Account volume: {preferences.soundVolume}</li>
          </ul>
        </Panel>
        <Panel title="Sound (this browser)">
          <SoundSettings />
        </Panel>
        <Panel title="Voice (this browser)">
          <VoiceSettings />
        </Panel>
      </div>
    ),
    appearance: (
      <Panel title="Appearance">
        <p className="quiet">
          Appearance and reduced-motion are saved with account preferences. Light theme uses Ghost light tokens; system
          follows the OS color scheme.
        </p>
        <FounderPreferenceForm preferences={preferences} />
      </Panel>
    ),
    memory: (
      <Panel title="Memory">
        <p className="quiet">
          Founder rules and proposals stay on the Memory surface so approval stays explicit. Settings does not silently
          mutate memory.
        </p>
        <ul className="meta">
          <li>
            <Link href="/memory">Open Memory</Link> — review pending proposals and active rules with provenance.
          </li>
          <li>Chat cannot activate a rule without Memory approval.</li>
        </ul>
      </Panel>
    ),
    privacy: (
      <Panel title="Privacy &amp; Models">
        <ul className="meta">
          <li>Active: {status.providerSummary}</li>
          <li>Cost policy: {intelligence.costPolicy}</li>
          <li>Paid fallback: {intelligence.paidFallback}</li>
        </ul>
        <p className="quiet">{status.privacyNote}</p>
        <p className="quiet">
          {intelligence.paidSelected
            ? "A paid provider is selected explicitly. Ghost still never switches providers on failure."
            : "Ghost never switches to a paid provider on its own. A provider failure is reported, not rerouted."}
        </p>
      </Panel>
    ),
    autonomy: (
      <div className="stack">
        <Panel title="Autonomy &amp; Approvals">
          <ul className="meta">
            <li>Agent execution: {status.agentExecution}</li>
            <li>{status.agentExecutionDetail}</li>
            <li>Hosted agent runtime allowed: {status.hostedAgentAllowed ? "yes" : "no"}</li>
            <li>{status.consequentialPolicy}</li>
            <li>Emergency stop: {status.emergencyStop}</li>
          </ul>
          <p className="quiet">
            This panel is read-only. Agent workers are not part of Settings V1. Chat text is never approval.
          </p>
          <p className="quiet">
            Action approvals stay on <Link href="/inspector">Inspector</Link>.
          </p>
        </Panel>
        <Panel title="Documented risk levels">
          <p className="quiet">Documented policy text. Alpha does not auto-enforce these from Settings.</p>
          <ul className="meta">
            {RISK_LEVELS.map((level) => (
              <li key={level}>
                {level}: {RISK_HANDLING[level]}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    ),
    notifications: (
      <Panel title="Notifications">
        <p className="quiet">
          Ghost ships in-app synthetic sounds only. Email, push, and desktop notifications are not deployed — shown as
          unavailable rather than fake toggles.
        </p>
        <ul className="meta">
          <li>In-app sounds: {preferences.soundEnabled ? "on (account)" : "off (account)"}</li>
          <li>Email alerts: unavailable</li>
          <li>Push / desktop: unavailable</li>
        </ul>
      </Panel>
    ),
    system: (
      <div className="stack">
        <Panel title="System status">
          <ul className="meta">
            {status.incidents.map((incident) => (
              <li key={incident.title}>
                [{incident.severity}] {incident.title}: {incident.detail}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Deployment">
          <ul className="meta">
            <li>Provider: {deployment.provider ?? "none selected"}</li>
            <li>Vercel allowed: {deployment.vercelAllowed ? "yes" : "no"}</li>
          </ul>
          <p className="quiet">
            {deployment.hosted
              ? "This page is served by the Render deployment. Being deployed does not make it presentation-ready."
              : "This page is served by a local build. A local build is not a deployment."}
          </p>
        </Panel>
        <Panel title="Portable project state">
          <p className="quiet">
            Read from .ghost/state.json when this page rendered. This is the file on disk, not a live production probe.
          </p>
          {"error" in portable ? <ErrorState message={portable.error} /> : <pre className="prose">{portable.text}</pre>}
        </Panel>
      </div>
    ),
  };

  return (
    <div className="stack">
      <PreferenceShell preferences={preferences} />
      <div className="page-head">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Control Center</h1>
          <p className="lede">Account truth, Ghost personality, and founder controls — progressive, not decorative.</p>
        </div>
      </div>
      <SettingsControlCenter sections={sections} />
    </div>
  );
}
