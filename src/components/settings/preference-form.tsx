"use client";

import { ActionForm } from "@/components/ui/action-form";
import { saveFounderPreferences } from "@/lib/preferences/actions";
import type { FounderPreferences } from "@/lib/preferences/types";

export function FounderPreferenceForm({ preferences }: { preferences: FounderPreferences }) {
  return (
    <ActionForm action={saveFounderPreferences} submitLabel="Save preferences">
      <fieldset className="settings-fieldset">
        <legend>Response style</legend>
        <p className="quiet">Changes tone only. Never overrides evidence, privacy, or approvals.</p>
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

      <fieldset className="settings-fieldset">
        <legend>Voice &amp; audio (account)</legend>
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

      <fieldset className="settings-fieldset">
        <legend>Appearance &amp; motion</legend>
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
    </ActionForm>
  );
}
