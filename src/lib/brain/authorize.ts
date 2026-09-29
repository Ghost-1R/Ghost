export function authorizeProjectContext(input: {
  requestedProjectId: string | null;
  visibleProjectId: string | null;
}): { ok: true } | { ok: false; reason: "not-visible" } {
  if (!input.requestedProjectId) {
    return { ok: true };
  }

  if (input.visibleProjectId !== input.requestedProjectId) {
    return { ok: false, reason: "not-visible" };
  }

  return { ok: true };
}
