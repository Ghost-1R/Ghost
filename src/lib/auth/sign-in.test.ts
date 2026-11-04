import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifySignInFailure, INVALID_CREDENTIALS_MESSAGE, isAuthCookieName, parseAttempt, signInDiagnostic } from "./sign-in";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("only a Supabase invalid_credentials response is reported as invalid credentials", () => {
  assert.equal(classifySignInFailure({ code: "invalid_credentials", status: 400, name: "AuthApiError" }).message, INVALID_CREDENTIALS_MESSAGE);
  const others = [
    { code: "email_not_confirmed", status: 400 },
    { code: "over_request_rate_limit", status: 429 },
    { status: 429 },
    { name: "AuthRetryableFetchError", status: 0 },
    { status: 500 },
    { status: 502 },
    { status: 503 },
    { code: "unexpected_failure", status: 400 },
    { status: 400, message: "Invalid login credentials" },
    null,
  ];
  for (const error of others) {
    assert.notEqual(classifySignInFailure(error).message, INVALID_CREDENTIALS_MESSAGE, JSON.stringify(error));
  }
});

test("temporary failures say the password was not checked", () => {
  for (const error of [{ status: 429 }, { name: "AuthRetryableFetchError", status: 0 }, { status: 503 }]) {
    assert.match(classifySignInFailure(error).message, /password was not checked/);
  }
  assert.equal(classifySignInFailure({ status: 503 }).code, "auth_unavailable");
  assert.equal(classifySignInFailure({ status: 429 }).code, "over_request_rate_limit");
});

test("attempt numbers accept only small positive integers", () => {
  assert.equal(parseAttempt("3"), 3);
  for (const value of ["", "0", "-1", "abc", "99999", "1.5", null]) {
    assert.equal(parseAttempt(value), 1, String(value));
  }
});

test("only Supabase session cookies count as a written session", () => {
  assert.equal(isAuthCookieName("sb-wzwrrleqfylhuxfbukfu-auth-token"), true);
  assert.equal(isAuthCookieName("sb-wzwrrleqfylhuxfbukfu-auth-token.0"), true);
  assert.equal(isAuthCookieName("sb-wzwrrleqfylhuxfbukfu-auth-token-code-verifier"), false);
  assert.equal(isAuthCookieName("ghost-sound"), false);
});

test("sign-in diagnostics carry only the allowed fields", () => {
  const line = signInDiagnostic({
    requestId: "r-1",
    attempt: 2,
    at: "2026-09-29T00:00:00.000Z",
    code: "invalid_credentials",
    status: 400,
    latencyMs: 120,
    session: false,
    cookieWritten: false,
    redirect: null,
    ...({ email: "founder@example.com", password: "synthetic-password-1", accessToken: "synthetic.jwt.value" } as object),
  });
  const record = JSON.parse(line);
  assert.deepEqual(Object.keys(record).sort(), ["at", "attempt", "code", "cookieWritten", "event", "latencyMs", "redirect", "requestId", "session", "status"]);
  assert.ok(!line.includes("@"));
  assert.ok(!line.includes("synthetic-password-1"));
  assert.ok(!line.includes("synthetic.jwt.value"));
});

test("one sign-in submission makes exactly one Supabase password request and redirects only after a saved session", () => {
  const actions = read("./actions.ts");
  assert.equal(actions.match(/signInWithPassword\(/g)?.length, 1);
  assert.equal(/\bfor\s*\(|\bwhile\s*\(|\.retry\(|setTimeout/.test(actions.slice(actions.indexOf("export async function authenticate"), actions.indexOf("export async function signOut"))), false);
  const signIn = actions.slice(actions.indexOf("signInWithPassword("), actions.indexOf("export async function signOut"));
  assert.ok(signIn.indexOf("if (failure)") < signIn.lastIndexOf('redirect("/dashboard")'));
  assert.match(signIn, /!session \|\| !cookieWritten/);
  const logged = signIn.slice(signIn.indexOf("console.info("), signIn.indexOf("if (failure)"));
  assert.equal(/email|password|token/i.test(logged), false);
});

test("the login form keeps the email, never the password, and hides stale alerts while pending", () => {
  const form = read("../../app/login/login-form.tsx");
  assert.match(form, /name="email"[^>]*defaultValue=\{state\.email\}/);
  assert.equal(/name="password"[^>]*(defaultValue|value=)/.test(form), false);
  assert.match(form, /state\.error && !pending/);
  assert.match(form, /name="attempt" value=\{state\.attempt \+ 1\}/);
  const button = read("../../components/ui/submit-button.tsx");
  assert.match(button, /disabled=\{pending\}/);
});

test("the server client reports written cookie names only after the write succeeds", () => {
  const server = read("../supabase/server.ts");
  const setAll = server.slice(server.indexOf("setAll("));
  assert.ok(setAll.indexOf("cookieStore.set(") < setAll.indexOf("onCookiesWritten?.("));
  assert.ok(setAll.indexOf("onCookiesWritten?.(") < setAll.indexOf("catch"));
});
