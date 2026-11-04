import { cache } from "react";
import type { NavFlags } from "@/components/shell/app-shell";
import type { GhostClient } from "@/lib/auth/session";
import {
  isFounder,
  loadAccessContext,
  navPermissions,
  type AccessContext,
} from "@/lib/access/permissions";

/** Per-request access context (deduped across layout + page). */
export const getAccessContext = cache(
  async (supabase: GhostClient, userId: string, email: string | null): Promise<AccessContext> =>
    loadAccessContext(supabase, userId, email),
);

/**
 * A founder owns a company. A brand-new account with no company and no team
 * membership has nothing teammate-scoped yet, so it keeps the founder surface
 * (first project / catalog setup). Anyone holding a membership is a teammate.
 */
export function hasFounderSurface(access: AccessContext): boolean {
  if (isFounder(access)) return true;
  return access.memberships.length === 0 && access.projectMemberships.length === 0;
}

export function buildNavFlags(access: AccessContext): NavFlags {
  const base = navPermissions(access);
  const founderSurface = hasFounderSurface(access);
  return {
    showCompanies: base.showCompanies || founderSurface,
    showTeam: base.showTeam,
    showMyWork: base.showMyWork && !founderSurface,
    showSettings: founderSurface,
  };
}
