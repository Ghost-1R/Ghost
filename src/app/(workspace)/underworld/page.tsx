import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getAccessContext } from "@/lib/access/session-access";
import { listAgentTasksForProject } from "@/lib/agent-runtime/queries";
import { ASSIGNMENT_COLUMNS, ASSIGNMENT_STATUS_LABEL, mapAssignmentRow } from "@/lib/assignments/types";
import { loadNextActions } from "@/lib/projects/queries";
import { loose } from "@/lib/db/loose";
import { UnderworldCity, type CityWork } from "@/components/underworld/city";

export const metadata = { title: "Underworld" };

export default async function UnderworldPage({ searchParams }: {
  searchParams: Promise<{ project?: string }>;
}) {
  const session = await getSession();
  if (session.status !== "authenticated") redirect("/login");
  const { supabase, user } = session;
  const access = await getAccessContext(supabase, user.id, user.email);
  if (!access.ownedCompanyIds.length) redirect("/dashboard");

  const { data: projects, error } = await supabase.from("projects")
    .select("id, name").in("company_id", access.ownedCompanyIds).order("name");
  const { project } = await searchParams;
  const selected = projects?.find((row) => row.id === project) ?? projects?.[0];
  const work: CityWork[] = [];
  let warning = error ? "Projects could not be loaded." : "";
  if (selected) {
    const [assignments, runs, plan] = await Promise.all([
      loose(supabase).from("work_assignments").select(ASSIGNMENT_COLUMNS)
        .eq("project_id", selected.id).in("company_id", access.ownedCompanyIds)
        .order("updated_at", { ascending: false }).limit(50),
      listAgentTasksForProject(supabase, user.id, selected.id),
      loadNextActions(supabase, selected.id),
    ]);
    if (assignments.error || runs.status === "error" || plan.status === "error") {
      warning = "Some work records are unavailable. Open Worker for saved runs.";
    }
    const tasks = runs.status === "ok" ? runs.data : [];
    const linked = new Set<string>();
    for (const action of plan.status === "ok" ? plan.data : []) {
      work.push({
        id: action.id,
        title: action.title,
        department: "planning",
        status: action.status.toLowerCase().replaceAll("_", " "),
        note: action.description,
        href: `/projects/${selected.id}#action-${action.id}`,
      });
    }
    for (const row of assignments.data ?? []) {
      const assignment = mapAssignmentRow(row);
      if (assignment.agentTaskId) linked.add(assignment.agentTaskId);
      const task = tasks.find((item) => item.id === assignment.agentTaskId);
      const department = ["IN_REVIEW", "SUBMITTED", "COMPLETED"].includes(assignment.status)
        ? "review" : assignment.kind === "AI" ? "engineering" : "team";
      work.push({
        id: assignment.id,
        title: assignment.title,
        department,
        status: ASSIGNMENT_STATUS_LABEL[assignment.status],
        note: assignment.reviewNote || assignment.submissionNote || assignment.progressNote,
        updated: assignment.updatedAt,
        steps: task?.checkpointSequence,
        handoff: assignment.handedOffFromAssignmentId,
        href: `/projects/${selected.id}#assignment-${assignment.id}`,
        runHref: task ? `/projects/${selected.id}/workspace?task=${task.id}` : undefined,
      });
    }
    for (const task of tasks.filter((item) => !linked.has(item.id))) {
      work.push({
        id: task.id,
        title: "Saved Ghost worker run",
        department: "engineering",
        status: task.status.toLowerCase().replaceAll("_", " "),
        updated: task.updatedAt,
        steps: task.checkpointSequence,
        href: `/projects/${selected.id}/workspace?task=${task.id}`,
      });
    }
  }

  return (
    <div className="stack">
      <Link href="/underworld/watch">Watch Room</Link>
      {selected && (
        <form action="/underworld" method="get" className="meta">
          <label htmlFor="city-project">Project</label>
          <select name="project" id="city-project" defaultValue={selected.id}>
            {projects?.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <button className="button-secondary" type="submit">Open project</button>
          <Link href={`/projects/${selected.id}`}>Assign work</Link>
          <Link href={`/projects/${selected.id}/build-plan`}>Build plan</Link>
        </form>
      )}
      {warning && <p role="status">{warning}</p>}
      <UnderworldCity key={selected?.id} work={work} projectId={selected?.id} />
    </div>
  );
}
