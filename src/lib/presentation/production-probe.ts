import { redactSecrets } from "../security/redact";
import type { ProbeResult } from "./security-probe";

type Fetch = typeof fetch;

const KEY_ASSIGNMENT = /\b(?:OPENAI|GROQ|XAI|ANTHROPIC)_API_KEY\s*[=:]\s*["']?[A-Za-z0-9_-]{8,}|SUPABASE_SERVICE_ROLE_KEY\s*[=:]\s*["']?[A-Za-z0-9._-]{8,}/;
const SERVICE_ROLE_JWT = /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g;
const INTELLIGENCE_LINES = ["Status: Ready", "Cost policy: Free-first", "Paid fallback: Disabled"];

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

function carriesServiceRole(text: string): boolean {
  for (const match of text.matchAll(SERVICE_ROLE_JWT)) {
    try {
      const payload = Buffer.from(match[1], "base64url").toString("utf8");
      if (payload.includes("service_role")) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

export function secretFindings(text: string, secrets: readonly string[]): string[] {
  const findings: string[] = [];
  if (redactSecrets(text) !== text) {
    findings.push("key-shaped value");
  }
  if (KEY_ASSIGNMENT.test(text)) {
    findings.push("key assignment");
  }
  if (carriesServiceRole(text)) {
    findings.push("service-role token");
  }
  if (secrets.some((secret) => secret.length >= 8 && text.includes(secret))) {
    findings.push("runner secret value");
  }
  return findings;
}

export function assetPaths(html: string): string[] {
  const paths = new Set<string>();
  for (const match of html.matchAll(/\/_next\/static\/[A-Za-z0-9_./~%@()[\]-]+?\.(?:js|css)/g)) {
    paths.add(match[0]);
  }
  return [...paths];
}

export async function evaluateProductionHealth(input: {
  baseUrl: string;
  runnerCommit: string;
  runnerClean: boolean;
  projectId: string;
  cookieHeader: () => Promise<string>;
  secrets: readonly string[];
  fetchImpl?: Fetch;
}): Promise<ProbeResult> {
  const request = input.fetchImpl ?? fetch;
  const lines: string[] = [`target=${input.baseUrl}`, `runner_commit=${input.runnerCommit.slice(0, 12)}`, `runner_tree=${input.runnerClean ? "clean" : "modified"}`];
  const failures: string[] = [];
  const finish = (): ProbeResult => {
    const output = redactSecrets([`failures=${failures.length}`, ...failures, ...lines].join("\n"));
    return { status: failures.length === 0 ? "passed" : "failed", exitCode: failures.length === 0 ? 0 : 1, output };
  };
  try {
    if (!input.runnerClean) {
      failures.push("The runner tree has changes that are not in its commit, so it cannot vouch for the deployed build.");
    }
    const health = await request(`${input.baseUrl}/api/health`, { cache: "no-store" });
    const body = (await health.json().catch(() => null)) as { status?: unknown; commit?: unknown } | null;
    const deployed = typeof body?.commit === "string" ? body.commit : null;
    lines.push(`health=${health.status}`, `production_commit=${deployed ? deployed.slice(0, 12) : "unknown"}`);
    if (health.status !== 200 || body?.status !== "ok") {
      failures.push("Production health endpoint did not answer ok.");
      return finish();
    }
    if (deployed !== input.runnerCommit) {
      failures.push("Production does not serve the commit this runner inspected.");
      return finish();
    }

    const dashboard = await request(`${input.baseUrl}/dashboard`, { redirect: "manual", cache: "no-store" });
    const location = dashboard.headers.get("location") ?? "";
    lines.push(`signed_out_dashboard=${dashboard.status} ${location.includes("/login") ? "/login" : "no-login-redirect"}`);
    if (dashboard.status < 300 || dashboard.status >= 400 || !location.includes("/login")) {
      failures.push("Signed-out dashboard did not redirect to sign-in.");
    }

    const anonymousRun = await request(`${input.baseUrl}/api/inspector/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: input.projectId }),
    });
    lines.push(`signed_out_inspector=${anonymousRun.status}`);
    if (anonymousRun.status !== 401) {
      failures.push("Signed-out inspection request was not refused.");
    }

    const cookie = await input.cookieHeader();
    const hostedRun = await request(`${input.baseUrl}/api/inspector/run`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "{}",
    });
    lines.push(`live_server_inspector=${hostedRun.status}`);
    if (hostedRun.status !== 409) {
      failures.push("The live server did not refuse to run inspections on itself.");
    }

    const settings = await request(`${input.baseUrl}/settings`, { headers: { cookie }, redirect: "manual", cache: "no-store" });
    const settingsHtml = await settings.text();
    const settingsText = visibleText(settingsHtml);
    const intelligence = INTELLIGENCE_LINES.filter((line) => settingsText.includes(line));
    const groq = settingsText.includes("Provider: Groq");
    lines.push(`settings=${settings.status} provider_groq=${groq ? "yes" : "no"} intelligence=${intelligence.length}/${INTELLIGENCE_LINES.length}`);
    if (settings.status !== 200 || !groq || intelligence.length !== INTELLIGENCE_LINES.length) {
      failures.push("Production Settings does not show Groq ready, free-first, with paid fallback disabled.");
    }

    const login = await request(`${input.baseUrl}/login`, { cache: "no-store" });
    const loginHtml = await login.text();
    const documents = [
      { name: "/login", text: loginHtml },
      { name: "/settings", text: settingsHtml },
      { name: "/api/health", text: JSON.stringify(body) },
    ];
    const assets = [...new Set([...assetPaths(loginHtml), ...assetPaths(settingsHtml)])];
    let scanned = 0;
    for (const asset of assets) {
      const response = await request(`${input.baseUrl}${asset}`, { cache: "no-store" });
      if (response.ok) {
        documents.push({ name: asset, text: await response.text() });
        scanned += 1;
      }
    }
    const exposed = documents.flatMap((document) => secretFindings(document.text, input.secrets).map((finding) => `${document.name}: ${finding}`));
    lines.push(`scanned_documents=${documents.length - scanned} scanned_assets=${scanned}/${assets.length} secret_findings=${exposed.length}`);
    if (assets.length === 0 || scanned !== assets.length) {
      failures.push("Production client assets could not all be scanned.");
    }
    if (exposed.length > 0) {
      failures.push(...exposed.map((item) => `Secret material exposed: ${item.replace(/\S{40,}/g, "[asset]")}`));
    }
    return finish();
  } catch (error) {
    failures.push(`Production probe could not finish: ${error instanceof Error ? error.message : "unknown error"}`);
    return { ...finish(), status: "blocked" };
  }
}
