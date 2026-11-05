"use client";

import { useId, useState, useSyncExternalStore, type ReactNode } from "react";

export const SETTINGS_SECTIONS = [
  { id: "account", label: "Account" },
  { id: "personality", label: "Ghost Personality" },
  { id: "voice", label: "Voice & Audio" },
  { id: "appearance", label: "Appearance" },
  { id: "memory", label: "Memory" },
  { id: "privacy", label: "Privacy & Models" },
  { id: "autonomy", label: "Autonomy & Approvals" },
  { id: "notifications", label: "Notifications" },
  { id: "system", label: "System & Diagnostics" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

function subscribeToHash(onStoreChange: () => void) {
  window.addEventListener("hashchange", onStoreChange);
  return () => window.removeEventListener("hashchange", onStoreChange);
}

function readHashSection(): SettingsSectionId | null {
  const hash = window.location.hash.replace(/^#/, "") as SettingsSectionId;
  return SETTINGS_SECTIONS.some((section) => section.id === hash) ? hash : null;
}

export function SettingsControlCenter({
  sections,
  initialSection = "account",
}: {
  sections: Record<SettingsSectionId, ReactNode>;
  initialSection?: SettingsSectionId;
}) {
  const navId = useId();
  // Hash deep-links via useSyncExternalStore (SSR-safe). Manual picks stay in state
  // because history.replaceState does not emit hashchange.
  const hashSection = useSyncExternalStore(subscribeToHash, readHashSection, () => null);
  const [manualSection, setManualSection] = useState<SettingsSectionId | null>(null);
  const active = manualSection ?? hashSection ?? initialSection;

  const select = (id: SettingsSectionId) => {
    setManualSection(id);
    window.history.replaceState(null, "", `#${id}`);
  };

  return (
    <div className="settings-center">
      <nav className="settings-nav" aria-labelledby={navId}>
        <p className="settings-nav-title" id={navId}>
          Control Center
        </p>
        <ul className="settings-nav-list">
          {SETTINGS_SECTIONS.map((section) => (
            <li key={section.id}>
              <button
                type="button"
                className="settings-nav-item"
                aria-current={active === section.id ? "page" : undefined}
                onClick={() => select(section.id)}
              >
                {section.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="settings-pane" role="region" aria-live="polite" aria-label={SETTINGS_SECTIONS.find((s) => s.id === active)?.label}>
        {sections[active]}
      </div>
    </div>
  );
}
