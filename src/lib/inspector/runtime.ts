import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type Env = Record<string, string | undefined>;

export type InspectionTarget = "local" | "production";

export const HOSTED_INSPECTION_REFUSAL =
  "Inspections run on the trusted runner, not on the live server. The runner inspects this deployment remotely.";

export const HOSTED_REVIEW_REFUSAL =
  "Presentation reviews are computed by the trusted runner. This page shows the latest recorded production review.";

const COMMIT = /^[0-9a-f]{40}$/i;

export function isHostedRuntime(env: Env = process.env): boolean {
  return env.RENDER?.trim() === "true" || Boolean(env.RENDER_SERVICE_ID?.trim());
}

export function productionUrl(env: Env = process.env): string | null {
  const raw = env.GHOST_PRODUCTION_URL?.trim();
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function inspectionTargets(env: Env = process.env): InspectionTarget[] {
  if (isHostedRuntime(env)) {
    return [];
  }
  return productionUrl(env) ? ["local", "production"] : ["local"];
}

export function parseInspectionTarget(value: unknown): InspectionTarget | null {
  if (value === undefined || value === "local") {
    return "local";
  }
  if (value === "production") {
    return "production";
  }
  return null;
}

let cachedCommit: string | null | undefined;

export async function releaseCommit(env: Env = process.env, cwd: string = process.cwd()): Promise<string | null> {
  const declared = env.RENDER_GIT_COMMIT?.trim() ?? "";
  if (COMMIT.test(declared)) {
    return declared.toLowerCase();
  }
  if (cachedCommit !== undefined) {
    return cachedCommit;
  }
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd, windowsHide: true, timeout: 5000 });
    const commit = stdout.trim();
    cachedCommit = COMMIT.test(commit) ? commit.toLowerCase() : null;
  } catch {
    cachedCommit = null;
  }
  return cachedCommit;
}
