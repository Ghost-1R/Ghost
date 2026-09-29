export const INVALID_CREDENTIALS_MESSAGE = "Invalid login credentials";

export type SignInFailure = {
  code: string;
  status: number | null;
  message: string;
};

type AuthErrorLike = { code?: unknown; status?: unknown; message?: unknown; name?: unknown } | null | undefined;

export function classifySignInFailure(error: AuthErrorLike): SignInFailure {
  const code = typeof error?.code === "string" && error.code ? error.code : null;
  const status = typeof error?.status === "number" ? error.status : null;
  const name = typeof error?.name === "string" ? error.name : "";

  if (code === "invalid_credentials") {
    return { code, status, message: INVALID_CREDENTIALS_MESSAGE };
  }
  if (code === "email_not_confirmed") {
    return { code, status, message: "This email is not confirmed yet. Open the confirmation email, then sign in." };
  }
  if (code === "over_request_rate_limit" || status === 429) {
    return {
      code: code ?? "over_request_rate_limit",
      status,
      message: "Too many sign-in attempts reached Supabase. Wait a minute, then try again. Your password was not checked.",
    };
  }
  if (name === "AuthRetryableFetchError" || status === 0 || (status !== null && status >= 500)) {
    return {
      code: code ?? "auth_unavailable",
      status,
      message: "Ghost could not reach the sign-in service. Your password was not checked. Try again in a moment.",
    };
  }
  return {
    code: code ?? "auth_error",
    status,
    message: "Supabase did not accept this sign-in. Check the email and password, then try again.",
  };
}

export function parseAttempt(value: FormDataEntryValue | null): number {
  const attempt = typeof value === "string" && /^\d{1,4}$/.test(value) ? Number(value) : 0;
  return attempt >= 1 ? attempt : 1;
}

export function isAuthCookieName(name: string): boolean {
  return /^sb-[a-z0-9]+-auth-token(\.\d+)?$/.test(name);
}

export type SignInDiagnostic = {
  event: "auth.sign_in";
  requestId: string;
  attempt: number;
  at: string;
  code: string | null;
  status: number | null;
  latencyMs: number;
  session: boolean;
  cookieWritten: boolean;
  redirect: string | null;
};

export function signInDiagnostic(input: Omit<SignInDiagnostic, "event">): string {
  const record: SignInDiagnostic = {
    event: "auth.sign_in",
    requestId: input.requestId,
    attempt: input.attempt,
    at: input.at,
    code: input.code,
    status: input.status,
    latencyMs: input.latencyMs,
    session: input.session,
    cookieWritten: input.cookieWritten,
    redirect: input.redirect,
  };
  return JSON.stringify(record);
}
