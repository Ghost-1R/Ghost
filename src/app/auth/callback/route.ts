import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const login = new URL("/login", url.origin);

  if (!code) {
    login.searchParams.set("reason", "confirm-failed");
    return NextResponse.redirect(login);
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    login.searchParams.set("reason", "unconfigured");
    return NextResponse.redirect(login);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    login.searchParams.set("reason", "confirm-failed");
    return NextResponse.redirect(login);
  }

  return NextResponse.redirect(new URL("/dashboard", url.origin));
}
