import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccessContext } from "@/lib/access/session-access";
import { getSession } from "@/lib/auth/session";
import { loadBlockers, loadVerification } from "@/lib/projects/queries";
import { listShiftJobsForProject } from "@/lib/underworld-shifts/queries";

export const metadata = { title: "Watch Room" };

export default async function WatchRoom({ searchParams }: {
  searchParams: Promise<{ project?: string }>;
}) {
  const session = await getSession();
  if (session.status !== "authenticated") redirect("/login");
  const { supabase, user } = session;
  const access = await getAccessContext(supabase, user.id, user.email);
  if (!access.ownedCompanyIds.length) redirect("/dashboard");

  const [inventory, { project }] = await Promise.all([
    supabase.from("projects").select("id, name").in("company_id", access.ownedCompanyIds).order("name").order("id"),
    searchParams,
  ]);
  const projects = inventory.data ?? [];
  const selected = projects.find((item) => item.id === project) ?? projects[0];
  const review = selected ? await Promise.all([
    loadBlockers(supabase, selected.id),
    loadVerification(supabase, selected.id),
    supabase.from("build_plan_risks").select("id, description, severity, mitigation")
      .eq("project_id", selected.id).order("human_id"),
    listShiftJobsForProject(supabase, selected.id, 8),
  ]) : null;

  return (
    <div className="stack underworld-review">
      <header>
        <p className="ghost-brand">UNDERWORLD</p>
        <h1>Watch Room</h1>
        <p>Review recorded build risks, open blockers, and verification gaps for projects your companies own.</p>
        <p>This view uses Ghost records. External assets and unregistered customer builds are outside its coverage.</p>
        <Link href="/dashboard">Back to dashboard</Link>
      </header>
      {inventory.error && <p role="alert">Project inventory could not be loaded.</p>}
      {!inventory.error && !selected && <p>No projects registered for review.</p>}
      {selected && review && (
        <>
          <form action="/underworld/watch" method="get" className="meta">
            <label htmlFor="watch-project">Project</label>
            <select id="watch-project" name="project" defaultValue={selected.id}>
              {projects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select>
            <button className="button-secondary" type="submit">Review project</button>
          </form>
          <h2>{selected.name}</h2>
          <Link href={`/projects/${selected.id}/build-plan`}>Open build plan</Link>
          <section>
            <h3>Open blockers</h3>
            {review[0].status === "error" ? <p>Blocker records unavailable.</p> : (
              review[0].data.some((item) => item.status === "OPEN") ? (
                <ul>{review[0].data.filter((item) => item.status === "OPEN").map((item) => (
                  <li key={item.id}><strong>{item.title}</strong> · {item.description}</li>
                ))}</ul>
              ) : <p>No open blockers recorded.</p>
            )}
          </section>
          <section>
            <h3>Build risks</h3>
            {review[2].error ? <p>Build risk records unavailable.</p> : review[2].data?.length ? (
              <ul>{review[2].data.map((item) => (
                <li key={item.id}><strong>{item.severity}</strong> · {item.description}{item.mitigation && <p>Mitigation · {item.mitigation}</p>}</li>
              ))}</ul>
            ) : <p>No build risks recorded.</p>}
          </section>
          <section>
            <h3>Verification</h3>
            {review[1].status === "error" ? <p>Verification records unavailable.</p> : review[1].data.length ? (
              <ul>{review[1].data.map((item) => (
                <li key={item.id}><strong>{item.state.replaceAll("_", " ")}</strong> · {item.category} · {item.target}</li>
              ))}</ul>
            ) : <p>No verification evidence recorded.</p>}
          </section>
          <section>
            <h3>Shift reviews</h3>
            {review[3].status === "error" ? (
              <p>Shift job records unavailable.</p>
            ) : review[3].data.length ? (
              <ul>
                {review[3].data.map((job) => (
                  <li key={job.id}>
                    <strong>{job.status.replaceAll("_", " ")}</strong>
                    {job.checkpointLabel ? ` · ${job.checkpointLabel}` : ""}
                    {job.reviewSummary ? <p>{job.reviewSummary}</p> : null}
                    {job.evidence.map((link) => (
                      <Link key={link.href} href={link.href}>{link.label}</Link>
                    ))}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No shift reviews recorded yet.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
