"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth/session";
import { classifySignInFailure, isAuthCookieName, parseAttempt, signInDiagnostic } from "@/lib/auth/sign-in";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@/lib/supabase/env";

export type LoginState = ActionState & {
  email: string;
  attempt: number;
};

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function authenticate(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = readField(formData, "email");
  const attempt = parseAttempt(formData.get("attempt"));
  const fail = (error: string | null, notice: string | null = null): LoginState => ({ error, notice, email, attempt });

  if (!getSupabaseEnv()) {
    return fail("Supabase is not configured. Add the public URL and publishable key, then try again.");
  }

  const written: string[] = [];
  const supabase = await createSupabaseServerClient((names) => written.push(...names));
  if (!supabase) {
    return fail("The server could not create a Supabase client.");
  }

  const intents = formData.getAll("intent").filter((value): value is string => typeof value === "string");
  const intent = intents.includes("sign-up") ? "sign-up" : intents.includes("sign-in") ? "sign-in" : "";
  const password = formData.get("password");
  const displayName = readField(formData, "displayName");

  if (!email.includes("@")) {
    return fail("Enter a valid email address.");
  }

  if (typeof password !== "string" || password.length < 8) {
    return fail("Use a password of at least 8 characters.");
  }

  if (intent === "sign-up") {
    const headerStore = await headers();
    const origin = headerStore.get("origin");
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: displayName ? { display_name: displayName } : undefined,
        emailRedirectTo: origin ? `${origin}/auth/callback` : undefined,
      },
    });

    if (error) {
      return fail(error.message);
    }

    if (data.session) {
      redirect("/dashboard");
    }

    return fail(
      null,
      "Supabase Auth accepted the sign-up request. If email confirmation is enabled, confirm the message, then sign in. This screen has not verified that a profile row exists.",
    );
  }

  if (intent !== "sign-in") {
    return fail("Choose sign in or create account.");
  }

  const requestId = crypto.randomUUID();
  const at = new Date().toISOString();
  const started = Date.now();
  let result: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>> | null = null;
  let thrown = false;
  try {
    result = await supabase.auth.signInWithPassword({ email, password });
  } catch {
    thrown = true;
  }
  const latencyMs = Date.now() - started;
  const session = Boolean(result?.data.session);
  const cookieWritten = written.some(isAuthCookieName);
  const failure = thrown
    ? classifySignInFailure({ name: "AuthRetryableFetchError", status: 0 })
    : result?.error
      ? classifySignInFailure(result.error)
      : !session || !cookieWritten
        ? { code: "session_not_saved", status: null, message: "Supabase accepted the credentials, but Ghost could not save the session. Try again." }
        : null;

  console.info(
    signInDiagnostic({
      requestId,
      attempt,
      at,
      code: failure?.code ?? null,
      status: failure ? failure.status : 200,
      latencyMs,
      session,
      cookieWritten,
      redirect: failure ? null : "/dashboard",
    }),
  );

  if (failure) {
    return fail(failure.message);
  }

  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (supabase) {
    await supabase.auth.signOut();
  }
  redirect("/login");
}

export async function updateProfile(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }

  const displayName = readField(formData, "displayName");
  if (displayName.length < 1 || displayName.length > 80) {
    return { error: "Display name must be between 1 and 80 characters.", notice: null };
  }

  const { data, error } = await session.supabase
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", session.user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: error.message, notice: null };
  }

  if (!data) {
    return {
      error: "No profile row was updated. The auth trigger may not have created one.",
      notice: null,
    };
  }

  return { error: null, notice: "Display name saved." };
}

export async function createOwnProfile(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }

  const displayName = readField(formData, "displayName");
  const { error } = await session.supabase.from("profiles").insert({
    id: session.user.id,
    display_name: displayName || null,
  });

  if (error) {
    return { error: error.message, notice: null };
  }

  return {
    error: null,
    notice: "Profile row inserted for the signed-in user. Remote trigger behavior is still separate from this insert.",
  };
}
