import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getDeploymentSelection } from "../deployment/provider";
import { evaluateProductionHealth, secretFindings } from "../presentation/production-probe";
import { reviewFromRow } from "../presentation/recorded";
import { rejectedClientEvidence } from "../presentation/records";
import { deploymentRequirement } from "../presentation/requirement-trace";
import { inspectionTargets, isHostedRuntime, parseInspectionTarget, productionUrl, releaseCommit } from "./runtime";

const COMMIT = "0f593ae6089d48f5d8bf54456b6d223cba67c045";
const BASE = "https://ghost.example.com";

test("the live server is recognised and never offered an inspection target", () => {
  assert.equal(isHostedRuntime({ RENDER: "true" }), true);
  assert.equal(isHostedRuntime({ RENDER_SERVICE_ID: "srv-example" }), true);
  assert.equal(isHostedRuntime({}), false);
  assert.deepEqual(inspectionTargets({ RENDER: "true", GHOST_PRODUCTION_URL: BASE }), []);
  assert.deepEqual(inspectionTargets({}), ["local"]);
  assert.deepEqual(inspectionTargets({ GHOST_PRODUCTION_URL: BASE }), ["local", "production"]);
});

test("the production URL must be plain https", () => {
  assert.equal(productionUrl({ GHOST_PRODUCTION_URL: `${BASE}/dashboard` }), BASE);
  assert.equal(productionUrl({ GHOST_PRODUCTION_URL: "http://ghost.example.com" }), null);
  assert.equal(productionUrl({ GHOST_PRODUCTION_URL: "https://user:pass@ghost.example.com" }), null);
  assert.equal(productionUrl({ GHOST_PRODUCTION_URL: "not a url" }), null);
  assert.equal(productionUrl({}), null);
});

test("inspection targets are an allowlist", () => {
  assert.equal(parseInspectionTarget(undefined), "local");
  assert.equal(parseInspectionTarget("local"), "local");
  assert.equal(parseInspectionTarget("production"), "production");
  assert.equal(parseInspectionTarget("staging"), null);
  assert.equal(parseInspectionTarget({ environment: "production" }), null);
});

test("the client cannot claim an evidence environment", () => {
  assert.ok(rejectedClientEvidence(["projectId", "environment"]));
  assert.equal(rejectedClientEvidence(["projectId", "target"]), null);
});

test("the release commit comes from the host when it declares one", async () => {
  assert.equal(await releaseCommit({ RENDER_GIT_COMMIT: COMMIT.toUpperCase() }), COMMIT);
});

test("the inspection route refuses on the live server before reading the request", () => {
  const route = readFileSync(new URL("../../app/api/inspector/run/route.ts", import.meta.url), "utf8");
  const signedIn = route.indexOf("You are not signed in.");
  const guard = route.indexOf("isHostedRuntime()");
  const body = route.indexOf("request.json()");
  const run = route.indexOf("executeTrustedInspection({");
  assert.ok(signedIn > 0 && guard > signedIn && body > guard && run > body);
  assert.match(route.slice(guard, body), /status: 409/);
  const actions = readFileSync(new URL("../presentation/actions.ts", import.meta.url), "utf8");
  assert.ok(actions.indexOf("isHostedRuntime()") < actions.indexOf("computePresentationReview({"));
});

test("deployment truth follows the runtime", () => {
  assert.deepEqual(getDeploymentSelection({ RENDER: "true" }), { provider: "render", vercelAllowed: false, hosted: true });
  assert.deepEqual(getDeploymentSelection({}), { provider: null, vercelAllowed: false, hosted: false });
});

test("the deployment requirement allows a named non-Vercel host only when production is recorded as deployed", () => {
  assert.equal(deploymentRequirement({ provider: null, vercelAllowed: false }, "NOT_DEPLOYED").ok, true);
  assert.equal(deploymentRequirement({ provider: "render", vercelAllowed: false }, "DEPLOYED").ok, true);
  assert.equal(deploymentRequirement({ provider: "Vercel", vercelAllowed: false }, "DEPLOYED").ok, false);
  assert.equal(deploymentRequirement({ provider: "render", vercelAllowed: true }, "DEPLOYED").ok, false);
  assert.equal(deploymentRequirement({ provider: "render", vercelAllowed: false }, "NOT_DEPLOYED").ok, false);
  assert.equal(deploymentRequirement({ provider: null, vercelAllowed: false }, "DEPLOYED").ok, false);
  assert.equal(deploymentRequirement({ provider: 7, vercelAllowed: false }, "DEPLOYED").ok, false);
});

test("recorded reviews only map known results and environments", () => {
  const row = {
    id: "r1",
    project_id: "p1",
    commit_sha: COMMIT,
    tree_hash: "t",
    environment: "production",
    created_at: "2026-09-29T00:00:00Z",
    evidence_ids: ["e1"],
    result: "READY",
    report: { gaps: [] },
  };
  assert.equal(reviewFromRow(row, "o1")?.environment, "production");
  assert.equal(reviewFromRow({ ...row, result: "SHIPPED" }, "o1"), null);
  assert.equal(reviewFromRow({ ...row, environment: "staging" }, "o1"), null);
});

type Route = { status: number; body?: string; headers?: Record<string, string> };

function fakeProduction(overrides: Partial<Record<string, Route>> = {}) {
  const calls: Array<{ url: string; method: string; cookie: string | null }> = [];
  const routes: Record<string, Route> = {
    "GET /api/health": { status: 200, body: JSON.stringify({ status: "ok", commit: COMMIT }) },
    "GET /dashboard": { status: 307, headers: { location: "/login" } },
    "POST /api/inspector/run": { status: 401, body: "{}" },
    "POST /api/inspector/run#signed": { status: 409, body: "{}" },
    "GET /settings": {
      status: 200,
      body: '<ul><li>Provider: Groq</li><li>Status: Ready</li><li>Cost policy: Free-first</li><li>Paid fallback: Disabled</li></ul><script src="/_next/static/chunks/app.js"></script>',
    },
    "GET /login": { status: 200, body: '<form>Sign in</form><script src="/_next/static/chunks/login.js"></script>' },
    "GET /_next/static/chunks/app.js": { status: 200, body: "console.log('app')" },
    "GET /_next/static/chunks/login.js": { status: 200, body: "console.log('login')" },
    ...overrides,
  };
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const path = String(url).replace(BASE, "");
    const method = init?.method ?? "GET";
    const cookie = (init?.headers as Record<string, string> | undefined)?.cookie ?? null;
    calls.push({ url: path, method, cookie });
    const route = routes[`${method} ${path}${cookie && path === "/api/inspector/run" ? "#signed" : ""}`] ?? { status: 404 };
    return new Response(route.body ?? null, { status: route.status, headers: route.headers });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function probe(fetchImpl: typeof fetch, extra: Partial<Parameters<typeof evaluateProductionHealth>[0]> = {}) {
  return evaluateProductionHealth({
    baseUrl: BASE,
    runnerCommit: COMMIT,
    runnerClean: true,
    projectId: "7f252953-ecab-4b5e-9762-5f3fe1c6a45d",
    cookieHeader: async () => "sb-session=fixture",
    secrets: ["runner-secret-value-fixture"],
    fetchImpl,
    ...extra,
  });
}

test("production health passes only for the same commit, guarded routes, Groq settings, and clean assets", async () => {
  const { fetchImpl } = fakeProduction();
  const result = await probe(fetchImpl);
  assert.equal(result.status, "passed", result.output);
  assert.match(result.output, /production_commit=0f593ae6089d/);
  assert.match(result.output, /signed_out_inspector=401/);
  assert.match(result.output, /live_server_inspector=409/);
  assert.match(result.output, /scanned_assets=2\/2 secret_findings=0/);
});

test("a different production commit fails before any signed-in request", async () => {
  const { fetchImpl, calls } = fakeProduction({ "GET /api/health": { status: 200, body: JSON.stringify({ status: "ok", commit: "1c22b26fc4759798f613932fd1d130a773b4879e" }) } });
  const result = await probe(fetchImpl);
  assert.equal(result.status, "failed");
  assert.match(result.output, /does not serve the commit/);
  assert.ok(calls.every((call) => call.cookie === null));
  assert.ok(!calls.some((call) => call.url === "/api/inspector/run"));
});

test("a runner with uncommitted changes cannot vouch for production", async () => {
  const { fetchImpl } = fakeProduction();
  const result = await probe(fetchImpl, { runnerClean: false });
  assert.equal(result.status, "failed");
  assert.match(result.output, /runner tree has changes/);
});

test("a live server that would run inspections fails the probe", async () => {
  const { fetchImpl } = fakeProduction({ "POST /api/inspector/run#signed": { status: 400, body: "{}" } });
  const result = await probe(fetchImpl);
  assert.equal(result.status, "failed");
  assert.match(result.output, /did not refuse to run inspections/);
});

test("settings without Groq ready and paid fallback disabled fail", async () => {
  const { fetchImpl } = fakeProduction({ "GET /settings": { status: 200, body: "<li>Provider: Groq</li><li>Status: Not configured</li>" } });
  const result = await probe(fetchImpl);
  assert.equal(result.status, "failed");
  assert.match(result.output, /does not show Groq ready/);
});

test("secret material in production assets fails without echoing the value", async () => {
  const synthetic = ["gsk", "Q".repeat(24)].join("_");
  const { fetchImpl } = fakeProduction({
    "GET /_next/static/chunks/app.js": { status: 200, body: `const a="${synthetic}";const b="runner-secret-value-fixture";` },
  });
  const result = await probe(fetchImpl);
  assert.equal(result.status, "failed");
  assert.match(result.output, /key-shaped value/);
  assert.match(result.output, /runner secret value/);
  assert.ok(!result.output.includes(synthetic));
  assert.ok(!result.output.includes("runner-secret-value-fixture"));
});

test("secret findings ignore key names and public publishable keys", () => {
  assert.deepEqual(secretFindings("GROQ_API_KEY is PRESENT; sb_publishable_example", []), []);
  assert.deepEqual(secretFindings(`GROQ_API_KEY=${"x".repeat(20)}`, []), ["key assignment"]);
});
