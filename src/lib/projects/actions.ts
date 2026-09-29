"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import type { ActionState } from "@/lib/action-state";
import { slugify, withSlugSuffix } from "@/lib/slug";

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

type CompanyResult = { ok: true; companyId: string } | { ok: false; error: string };

async function ensureCompany(
  session: Extract<Awaited<ReturnType<typeof getSession>>, { status: "authenticated" }>,
): Promise<CompanyResult> {
  const { data: existing, error: selectError } = await session.supabase
    .from("companies")
    .select("id")
    .eq("owner_id", session.user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (selectError) {
    return { ok: false, error: selectError.message };
  }

  if (existing?.id) {
    return { ok: true, companyId: existing.id };
  }

  const { data: created, error: insertError } = await session.supabase
    .from("companies")
    .insert({
      owner_id: session.user.id,
      name: "Workspace",
      slug: "workspace",
      description: "Default founder workspace created with the first project.",
    })
    .select("id")
    .single();

  if (insertError || !created?.id) {
    return { ok: false, error: insertError?.message ?? "Workspace was not created." };
  }

  return { ok: true, companyId: created.id };
}

export async function createProject(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }

  const name = readField(formData, "name");
  const description = readField(formData, "description");
  const milestone = readField(formData, "milestone");
  const repositoryUrl = readField(formData, "repositoryUrl");

  if (name.length < 1 || name.length > 160) {
    return { error: "Project name must be between 1 and 160 characters.", notice: null };
  }

  if (milestone.length < 1 || milestone.length > 200) {
    return { error: "Enter the current milestone.", notice: null };
  }

  const company = await ensureCompany(session);
  if (!company.ok) {
    return { error: company.error, notice: null };
  }

  let slug = slugify(name);
  let projectId: string | null = null;
  let lastError: string | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await session.supabase
      .from("projects")
      .insert({
        company_id: company.companyId,
        name,
        slug,
        description,
        current_milestone: milestone,
        status: "PLANNING",
        repository_url: repositoryUrl || null,
      })
      .select("id")
      .single();

    if (!error && data) {
      projectId = data.id;
      break;
    }

    lastError = error?.message ?? "Project was not created.";
    if (error?.code !== "23505") {
      break;
    }

    slug = withSlugSuffix(slugify(name));
  }

  if (!projectId) {
    return { error: lastError ?? "Project was not created.", notice: null };
  }

  const { error: milestoneError } = await session.supabase.from("milestones").insert({
    project_id: projectId,
    title: milestone,
    description: "",
    status: "PLANNING",
    position: 0,
  });

  if (milestoneError) {
    const { error: deleteError } = await session.supabase.from("projects").delete().eq("id", projectId);
    const cleanup = deleteError
      ? `The project row could not be removed: ${deleteError.message}`
      : "The project row was removed.";
    return {
      error: `Milestone insert failed. ${cleanup} Supabase said: ${milestoneError.message}`,
      notice: null,
    };
  }

  redirect(`/projects/${projectId}`);
}
