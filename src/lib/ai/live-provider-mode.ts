/**
 * Deterministic control for outbound model HTTP.
 * Release gates default to NO_LIVE_PROVIDER_CALLS.
 * Live probes require explicit GHOST_LIVE_PROVIDER_TEST=1 and must not set NO_LIVE.
 */

export type ProviderEnv = Record<string, string | undefined>;

/** Brand synthetic/test fetch implementations so NO_LIVE can allow them without identity tricks. */
export const GHOST_MOCK_FETCH = Symbol.for("ghost.mockFetch");

export function isNoLiveProviderCallsMode(env: ProviderEnv = process.env): boolean {
  return env.GHOST_NO_LIVE_PROVIDER_CALLS?.trim() === "1";
}

/** Explicit founder authorization for live provider regression probes (not normal app traffic). */
export function isLiveProviderTestAuthorized(env: ProviderEnv = process.env): boolean {
  return env.GHOST_LIVE_PROVIDER_TEST?.trim() === "1" && !isNoLiveProviderCallsMode(env);
}

export function brandMockFetch<T extends (url: string | URL | Request, init?: RequestInit) => Promise<Response>>(
  fetchImpl: T,
): T {
  Object.defineProperty(fetchImpl, GHOST_MOCK_FETCH, { value: true, configurable: true });
  return fetchImpl;
}

/** Normalize fetch() input to a comparable URL string without unsafe casts. */
export function resolveFetchInputUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function isBrandedMockFetch(fetchImpl: unknown): boolean {
  return typeof fetchImpl === "function" && Boolean((fetchImpl as unknown as Record<symbol, unknown>)[GHOST_MOCK_FETCH]);
}

/**
 * Block outbound model HTTP when NO_LIVE is armed.
 * Only explicitly brandMockFetch() implementations may proceed (synthetic probes/tests).
 * No silent fallback to live models.
 */
export function assertOutboundLiveModelCallAllowed(env: ProviderEnv, fetchImpl: unknown): void {
  if (!isNoLiveProviderCallsMode(env)) return;
  if (isBrandedMockFetch(fetchImpl)) return;
  throw new Error(
    "NO_LIVE_PROVIDER_CALLS: outbound model HTTP is disabled. Set GHOST_LIVE_PROVIDER_TEST=1 and unset GHOST_NO_LIVE_PROVIDER_CALLS only under founder authorization.",
  );
}

/** Prefer for CLI/release runners: force NO_LIVE unless live test is explicitly authorized. */
export function armNoLiveProviderCallsForReleaseGate(env: ProviderEnv = process.env): void {
  if (env.GHOST_LIVE_PROVIDER_TEST?.trim() === "1") return;
  env.GHOST_NO_LIVE_PROVIDER_CALLS = "1";
}
