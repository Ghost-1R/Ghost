/**
 * Seed a local-only browser acceptance user + synthetic project.
 * Refuses non-loopback Supabase URLs.
 */
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";

function parseStatusEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

function sql(query) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_ghost",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-t",
      "-A",
      "-c",
      query,
    ],
    { encoding: "utf8" },
  ).trim();
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const status = execFileSync("npx", ["supabase", "status", "-o", "env"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
});
const local = parseStatusEnv(status);
if (!/^https?:\/\/(127\.0\.0\.1|localhost)/i.test(local.API_URL ?? "")) {
  console.error("Refusing seed: API_URL is not local");
  process.exit(2);
}

const email = `browser-approval-${randomUUID().slice(0, 8)}@ghost.local`;
const password = `LocalAccept-${randomUUID().slice(0, 12)}`;
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const created = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (created.error || !created.data.user) {
  console.error(created.error?.message ?? "createUser failed");
  process.exit(1);
}

const userId = created.data.user.id;
const companyId = randomUUID();
const projectId = randomUUID();
const slug = randomUUID().slice(0, 8);

sql(`
  insert into public.profiles (id, display_name)
  values ('${userId}', 'Browser Approval Tester')
  on conflict (id) do update set display_name = excluded.display_name;
  insert into public.companies (id, owner_id, name, slug)
  values ('${companyId}', '${userId}', 'Browser Approval Co', 'browser-co-${slug}');
  insert into public.projects (id, company_id, name, slug, description, status)
  values ('${projectId}', '${companyId}', 'Synthetic Approval Project', 'browser-proj-${slug}', 'Synthetic local browser acceptance project', 'IDEA');
`);

const out = {
  email,
  password,
  userId,
  projectId,
  projectName: "Synthetic Approval Project",
  apiUrl: local.API_URL,
  createdAt: new Date().toISOString(),
  note: "LOCAL ONLY synthetic credentials for Build 09.4 browser acceptance. Do not use in production.",
};

const outPath = path.join(root, ".ghost", "browser-approval-user.json");
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
console.log(`Seeded local user ${email}`);
console.log(`Project ${projectId}`);
console.log(`Credentials written to ${outPath}`);
