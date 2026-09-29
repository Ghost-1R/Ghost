import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import type { EvidenceStatus } from "./types";

const execFileAsync = promisify(execFile);

export type ProbeResult = {
  status: EvidenceStatus;
  exitCode: number;
  output: string;
};

async function gitignored(cwd: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["check-ignore", "-q", ".env.local"], { cwd, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function filesContainServiceCredential(root: string): Promise<boolean> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".next" || entry.name === ".ghost") {
      continue;
    }
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (await filesContainServiceCredential(full)) {
        return true;
      }
      continue;
    }
    if (!/\.(ts|tsx|js|jsx|html|json|md)$/.test(entry.name) || entry.name === ".env.local") {
      continue;
    }
    const text = await readFile(full, "utf8").catch(() => "");
    const tokens = text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? [];
    for (const token of tokens) {
      try {
        const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { role?: string };
        if (payload.role === "service_role") {
          return true;
        }
      } catch {
        continue;
      }
    }
  }
  return false;
}

export async function evaluateSecurityBoundary(cwd: string): Promise<ProbeResult> {
  const lines: string[] = [];
  let failed = false;
  let blocked = false;
  const ignored = await gitignored(cwd);
  lines.push(`env file gitignored: ${ignored ? "yes" : "no"}`);
  if (!ignored) {
    failed = true;
  }
  const exposed = await filesContainServiceCredential(cwd);
  lines.push(`tracked source contains service credential: ${exposed ? "yes" : "no"}`);
  if (exposed) {
    failed = true;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const email = process.env.GHOST_LOCAL_FOUNDER_EMAIL?.trim() ?? "";
  const password = process.env.GHOST_LOCAL_FOUNDER_PASSWORD?.trim() ?? "";
  if (!url || !publishable || !serviceKey || !email || !password) {
    lines.push("founder client or server credential missing");
    return { status: "blocked", exitCode: 1, output: lines.join("\n") };
  }

  const founder = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await founder.auth.signInWithPassword({ email, password });
  lines.push(`founder sign-in: ${signed.error ? "denied" : "accepted"}`);
  if (signed.error || !signed.data.user) {
    return { status: "blocked", exitCode: 1, output: lines.join("\n") };
  }
  const project = await founder.from("projects").select("id").ilike("name", "ghost").limit(1).maybeSingle();
  const projectId = project.data?.id;
  if (!projectId) {
    lines.push("ghost project not visible to founder");
    return { status: "failed", exitCode: 1, output: lines.join("\n") };
  }
  const insert = await founder.from("inspection_evidence").insert({
    project_id: projectId,
    run_id: crypto.randomUUID(),
    check_type: "security",
    commit_sha: "a".repeat(40),
    tree_hash: "b".repeat(64),
    command: "forgery-probe",
    exit_code: 0,
    duration_ms: 1,
    output_hash: "c".repeat(64),
    log_excerpt: "forged",
    runner: "inspector",
    environment: "local",
    status: "passed",
  });
  const denied = Boolean(insert.error);
  lines.push(`client insert evidence: ${denied ? "denied" : "allowed"}`);
  if (!denied) {
    failed = true;
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const users = await admin.auth.admin.listUsers({ page: 1, perPage: 20 });
  const other = users.data.users.find((user) => user.id !== signed.data.user?.id && user.email);
  if (!other?.email || users.error) {
    lines.push("cross-user session: unavailable");
    blocked = true;
  } else {
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email: other.email });
    const token = link.data.properties?.hashed_token;
    const otherClient = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
    const verified = token
      ? await otherClient.auth.verifyOtp({ token_hash: token, type: "magiclink" })
      : { error: { message: "no token" } };
    if (verified.error) {
      lines.push("cross-user session: unavailable");
      blocked = true;
    } else {
      const evidence = await otherClient.from("inspection_evidence").select("id").eq("project_id", projectId);
      const reviews = await otherClient.from("presentation_reviews").select("id").eq("project_id", projectId);
      const forged = await otherClient.from("inspection_evidence").insert({
        project_id: projectId,
        run_id: crypto.randomUUID(),
        check_type: "security",
        commit_sha: "a".repeat(40),
        tree_hash: "b".repeat(64),
        command: "forgery-probe",
        exit_code: 0,
        duration_ms: 1,
        output_hash: "c".repeat(64),
        log_excerpt: "forged",
        runner: "inspector",
        environment: "local",
        status: "passed",
      });
      lines.push(`cross-user evidence rows: ${evidence.data?.length ?? "error"}`);
      lines.push(`cross-user review rows: ${reviews.data?.length ?? "error"}`);
      lines.push(`cross-user insert: ${forged.error ? "denied" : "allowed"}`);
      if ((evidence.data?.length ?? 1) > 0 || (reviews.data?.length ?? 1) > 0 || !forged.error) {
        failed = true;
      }
    }
  }

  const status: EvidenceStatus = failed ? "failed" : blocked ? "blocked" : "passed";
  return { status, exitCode: status === "passed" ? 0 : 1, output: lines.join("\n") };
}
