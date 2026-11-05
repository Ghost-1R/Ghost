import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getAccessContext } from "@/lib/access/session-access";
import { listAgentTasksForProject } from "@/lib/agent-runtime/queries";
import {
  ASSIGNMENT_COLUMNS,
  ASSIGNMENT_STATUS_LABEL,
  mapAssignmentRow,
} from "@/lib/assignments/types";
import { loadBuildPlan } from "@/lib/build-plan/queries";
import { loadNextActions } from "@/lib/projects/queries";
import { loose } from "@/lib/db/loose";
import {
  deskMonitorActivity,
  preferredCrewForDepartment,
  UNDERWORLD_CREW,
} from "@/lib/underworld/desks";
import { UnderworldCity, type CityDesk, type CityWork } from "@/components/underworld/city";

export const metadata = { title: "Underworld" };

export default async function UnderworldPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const session = await getSession();
  if (session.status !== "authenticated") redirect("/login");
  const { supabase, user } = session;
  const access = await getAccessContext(supabase, user.id, user.email);
  if (!access.ownedCompanyIds.length) redirect("/dashboard");

  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, name")
    .in("company_id", access.ownedCompanyIds)
    .order("name");
  const { project } = await searchParams;
  const selected = projects?.find((row) => row.id === project) ?? projects?.[0];
  const work: CityWork[] = [];
  const deskByWorker = new Map<string, CityDesk>(
    UNDERWORLD_CREW.map((member) => [
      member.id,
      {
        workerId: member.id,
        name: member.name,
        role: member.role,
        office: member.office,
        after: member.after,
        monitor: null,
        unassigned: true,
      },
    ]),
  );
  let warning = error ? "Projects could not be loaded." : "";
  let recordsFailed = false;

  if (selected) {
    const [assignments, runs, plan, buildPlan] = await Promise.all([
      loose(supabase)
        .from("work_assignments")
        .select(ASSIGNMENT_COLUMNS)
        .eq("project_id", selected.id)
        .in("company_id", access.ownedCompanyIds)
        .order("updated_at", { ascending: false })
        .limit(50),
      listAgentTasksForProject(supabase, user.id, selected.id),
      loadNextActions(supabase, selected.id),
      loadBuildPlan(supabase, selected.id),
    ]);
    if (
      assignments.error ||
      runs.status === "error" ||
      plan.status === "error" ||
      buildPlan.status === "error"
    ) {
      warning = "Some work records are unavailable. Open Worker for saved runs.";
      recordsFailed = true;
    }
    const tasks = runs.status === "ok" ? runs.data : [];
    const linked = new Set<string>();
    if (buildPlan.status === "ok" && buildPlan.data) {
      work.push({
        id: buildPlan.data.id,
        title: "Build plan",
        department: "planning",
        status: buildPlan.data.status.toLowerCase().replaceAll("_", " "),
        note: buildPlan.data.summary,
        updated: buildPlan.data.updatedAt,
        href: `/projects/${selected.id}/build-plan`,
      });
    }
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

    const claimedWorkers = new Set<string>();
    for (const row of assignments.data ?? []) {
      const assignment = mapAssignmentRow(row);
      if (assignment.agentTaskId) linked.add(assignment.agentTaskId);
      const task = tasks.find((item) => item.id === assignment.agentTaskId);
      const department = ["IN_REVIEW", "SUBMITTED", "COMPLETED"].includes(assignment.status)
        ? "review"
        : assignment.kind === "AI"
          ? "engineering"
          : "planning";
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

      const preferred = preferredCrewForDepartment(department, assignment.kind);
      // Prefer an open Engineering-floor desk (Atlas/Nova) before reusing a filled monitor.
      const deskWorkerId =
        !claimedWorkers.has(preferred)
          ? preferred
          : UNDERWORLD_CREW.find(
              (member) =>
                (member.office === "engineering" || member.id === preferred) &&
                !claimedWorkers.has(member.id),
            )?.id ?? preferred;
      if (deskByWorker.get(deskWorkerId)?.monitor) {
        continue;
      }
      claimedWorkers.add(deskWorkerId);
      const existing = deskByWorker.get(deskWorkerId);
      if (!existing) continue;
      deskByWorker.set(deskWorkerId, {
        ...existing,
        unassigned: false,
        monitor: {
          activity: deskMonitorActivity({
            assignmentStatus: assignment.status,
            taskStatus: task?.status,
            blockReason: task?.blockReason,
          }),
          taskTitle: assignment.title,
          runStatus: task?.status ?? null,
          assignmentStatus: ASSIGNMENT_STATUS_LABEL[assignment.status],
          checkpointSequence: task?.checkpointSequence ?? null,
          checkpointLabel:
            task?.checkpointSequence && task.checkpointSequence > 0
              ? `Checkpoint ${task.checkpointSequence}`
              : "No checkpoint yet",
          blockReason: task?.blockReason?.trim() || "",
          evidenceHref: task
            ? `/projects/${selected.id}/workspace?task=${task.id}`
            : `/projects/${selected.id}#assignment-${assignment.id}`,
          runHref: task ? `/projects/${selected.id}/workspace?task=${task.id}` : null,
          workHref: `/projects/${selected.id}#assignment-${assignment.id}`,
          updatedAt: task?.updatedAt ?? assignment.updatedAt,
        },
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
      const deskWorkerId = !claimedWorkers.has("nova")
        ? "nova"
        : !claimedWorkers.has("atlas")
          ? "atlas"
          : "nova";
      if (deskByWorker.get(deskWorkerId)?.monitor) continue;
      claimedWorkers.add(deskWorkerId);
      const existing = deskByWorker.get(deskWorkerId);
      if (!existing) continue;
      deskByWorker.set(deskWorkerId, {
        ...existing,
        unassigned: false,
        monitor: {
          activity: deskMonitorActivity({
            taskStatus: task.status,
            blockReason: task.blockReason,
          }),
          taskTitle: "Saved Ghost worker run",
          runStatus: task.status,
          assignmentStatus: null,
          checkpointSequence: task.checkpointSequence,
          checkpointLabel:
            task.checkpointSequence > 0
              ? `Checkpoint ${task.checkpointSequence}`
              : "No checkpoint yet",
          blockReason: task.blockReason?.trim() || "",
          evidenceHref: `/projects/${selected.id}/workspace?task=${task.id}`,
          runHref: `/projects/${selected.id}/workspace?task=${task.id}`,
          workHref: `/projects/${selected.id}/workspace?task=${task.id}`,
          updatedAt: task.updatedAt,
        },
      });
    }

    if (recordsFailed) {
      for (const [id, desk] of deskByWorker) {
        deskByWorker.set(id, { ...desk, unassigned: false, monitor: null });
      }
    }
  }

  const desks = UNDERWORLD_CREW.map((member) => deskByWorker.get(member.id)!);

  return (
    <div className="stack underworld-review">
      <Link href="/underworld/watch">Watch Room</Link>
      {selected && (
        <form action="/underworld" method="get" className="meta">
          <label htmlFor="city-project">Project</label>
          <select name="project" id="city-project" defaultValue={selected.id}>
            {projects?.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
          <button className="button-secondary" type="submit">
            Open project
          </button>
          <Link href={`/projects/${selected.id}`}>Assign work</Link>
          <Link href={`/projects/${selected.id}/build-plan`}>Build plan</Link>
        </form>
      )}
      {warning && <p role="status">{warning}</p>}
      <UnderworldCity
        key={selected?.id}
        work={work}
        desks={desks}
        projectId={selected?.id}
        recordsWarning={recordsFailed ? warning : undefined}
      />
    </div>
  );
}
