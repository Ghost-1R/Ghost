"use client";

import { ActionForm } from "@/components/ui/action-form";
import { saveFounderPreferences } from "@/lib/preferences/actions";
import type { FounderPreferences } from "@/lib/preferences/types";

export type PreferenceFormSection = "personality" | "voice" | "appearance";

function PreferenceHiddenFields({
  preferences,
  omit,
}: {
  preferences: FounderPreferences;
  omit: PreferenceFormSection;
}) {
  return (
    <>
      {omit !== "personality" ? (
        <>
          <input type="hidden" name="responseStyle" value={preferences.responseStyle} />
          <input type="hidden" name="responseDetail" value={preferences.responseDetail} />
        </>
      ) : null}
      {omit !== "voice" ? (
        <>
          {preferences.soundEnabled ? (
            <input type="hidden" name="soundEnabled" value="on" />
          ) : null}
          <input type="hidden" name="soundVolume" value={String(preferences.soundVolume)} />
        </>
      ) : null}
      {omit !== "appearance" ? (
        <>
          <input type="hidden" name="appearance" value={preferences.appearance} />
          {preferences.reduceMotion ? (
            <input type="hidden" name="reduceMotion" value="on" />
          ) : null}
        </>
      ) : null}
    </>
  );
}

export function FounderPreferenceForm({
  preferences,
  section,
}: {
  preferences: FounderPreferences;
  section: PreferenceFormSection;
}) {
  const formKey = [
    section,
    preferences.responseStyle,
    preferences.responseDetail,
    preferences.soundEnabled ? "1" : "0",
    preferences.soundVolume,
    preferences.reduceMotion ? "1" : "0",
    preferences.appearance,
  ].join(":");

  return (
    <ActionForm key={formKey} action={saveFounderPreferences} submitLabel="Save preferences">
      <PreferenceHiddenFields preferences={preferences} omit={section} />

      {section === "personality" ? (
        <fieldset className="settings-fieldset">
          <legend>Response style</legend>
          <p className="quiet">
            Changes tone only. Never overrides evidence, privacy, or approvals.
          </p>
          <label className="field">
            <span>Preferred style</span>
            <select name="responseStyle" defaultValue={preferences.responseStyle} required>
              <option value="DIRECT">Direct</option>
              <option value="WARM">Warm</option>
              <option value="FORMAL">Formal</option>
            </select>
          </label>
          <label className="field">
            <span>Detail level</span>
            <select name="responseDetail" defaultValue={preferences.responseDetail} required>
              <option value="BRIEF">Brief</option>
              <option value="BALANCED">Balanced</option>
              <option value="DETAILED">Detailed</option>
            </select>
          </label>
        </fieldset>
      ) : null}

      {section === "voice" ? (
        <fieldset className="settings-fieldset">
          <legend>Account audio</legend>
          <p className="quiet">Saved to your account and synced to this browser&apos;s sound engine.</p>
          <label className="check-field">
            <input type="checkbox" name="soundEnabled" defaultChecked={preferences.soundEnabled} />
            <span>Enable Ghost UI sounds</span>
          </label>
          <label className="field">
            <span>Volume (0–1)</span>
            <input
              type="number"
              name="soundVolume"
              min={0}
              max={1}
              step={0.05}
              defaultValue={preferences.soundVolume}
              required
            />
          </label>
        </fieldset>
      ) : null}

      {section === "appearance" ? (
        <fieldset className="settings-fieldset">
          <legend>Theme &amp; motion</legend>
          <label className="field">
            <span>Appearance</span>
            <select name="appearance" defaultValue={preferences.appearance} required>
              <option value="DARK">Dark</option>
              <option value="LIGHT">Light</option>
              <option value="SYSTEM">Match system</option>
            </select>
          </label>
          <label className="check-field">
            <input type="checkbox" name="reduceMotion" defaultChecked={preferences.reduceMotion} />
            <span>Prefer reduced motion (overrides busy animations in Ghost)</span>
          </label>
        </fieldset>
      ) : null}
    </ActionForm>
  );
}
