import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loose } from "@/lib/db/loose";

export const runtime = "nodejs";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Working opt-out endpoint. Token is bound to a queued/sent Outreach message.
 * Marks suppression + do_not_contact; never invents or reveals other leads.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = (url.searchParams.get("token") ?? "").trim();
  if (token.length < 16) {
    return new NextResponse("Invalid opt-out link.", { status: 400 });
  }

  const supabase = serviceClient();
  if (!supabase) {
    return new NextResponse("Opt-out temporarily unavailable.", { status: 503 });
  }

  const message = await loose(supabase)
    .from("ceo_outreach_messages")
    .select("id, company_id, opportunity_id, recipient_email, status")
    .eq("opt_out_token", token)
    .maybeSingle();

  if (message.error || !message.data) {
    return new NextResponse("Opt-out link not found.", { status: 404 });
  }

  const row = message.data as Record<string, unknown>;
  const now = new Date().toISOString();
  const email = String(row.recipient_email).trim().toLowerCase();

  await loose(supabase).from("ceo_outreach_suppressions").upsert(
    {
      company_id: String(row.company_id),
      email,
      reason: "opt_out",
      source_message_id: String(row.id),
      note: "Opt-out via public link",
    },
    { onConflict: "company_id,email" },
  );

  await loose(supabase)
    .from("ceo_opportunities")
    .update({
      do_not_contact: true,
      updated_at: now,
    })
    .eq("id", String(row.opportunity_id));

  // Cancel any still-queued messages to this recipient for the company.
  await loose(supabase)
    .from("ceo_outreach_messages")
    .update({
      status: "suppressed",
      last_error: "Recipient opted out.",
      updated_at: now,
      lease_token: null,
      lease_expires_at: null,
    })
    .eq("company_id", String(row.company_id))
    .eq("recipient_email", email)
    .in("status", ["queued", "awaiting_approval", "sending"]);

  return new NextResponse(
    "You have been unsubscribed from Badger United outreach emails. You will not receive further commercial messages from this system.",
    {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    },
  );
}
