/**
 * Isolated execution pilot configuration (Build 09.9).
 * Explicitly disabled by default. Never enables hosted workers or production paths.
 */

export const PILOT_ENV_FLAG = "GHOST_ISOLATED_PILOT_ENABLED";

/** Fixed image for the harmless pilot — tag only; digest recorded when Docker resolves it. */
export const PILOT_IMAGE = "node:22-alpine";

/** Non-root user inside the pilot container. */
export const PILOT_USER = "10001:10001";

export const PILOT_DEFAULT_LIMITS = {
  memoryBytes: 256 * 1024 * 1024,
  nanoCpus: 500_000_000,
  pidsLimit: 128,
  durationMs: 60_000,
  diskQuotaBytes: 256 * 1024 * 1024,
} as const;

export type PilotGateResult =
  | { ok: true; enabled: true }
  | { ok: false; enabled: false; reason: string };

/**
 * Pilot gate — requires explicit env flag.
 * Hosted / production agent execution flags do not enable this pilot.
 */
export function getIsolatedPilotGate(): PilotGateResult {
  const enabled = process.env[PILOT_ENV_FLAG]?.trim() === "1";
  if (!enabled) {
    return {
      ok: false,
      enabled: false,
      reason: `${PILOT_ENV_FLAG} is not set — isolated pilot remains disabled by default.`,
    };
  }
  // Hosted worker activation must stay off even when pilot flag is set.
  if (process.env.GHOST_AGENT_EXECUTION_ENABLED?.trim() === "1") {
    return {
      ok: false,
      enabled: false,
      reason:
        "GHOST_AGENT_EXECUTION_ENABLED is set — refusing pilot while hosted/agent execution flag is present.",
    };
  }
  return { ok: true, enabled: true };
}
