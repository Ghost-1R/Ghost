import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EmptyState, Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { getSession } from "@/lib/auth/session";
import { latestInspections } from "@/lib/inspector/evidence";
import { HOSTED_INSPECTION_REFUSAL, inspectionTargets } from "@/lib/inspector/runtime";
import { defaultRuntimeRoot, listApprovals, listInspections } from "@/lib/inspector/store";
import { loadProjectSummaries } from "@/lib/projects/queries";
import { ApprovalDecision, ProposeActionForm, RunInspectionForm } from "./inspector-actions";

export const metadata: Metadata = {
  title: "Inspector",
};

export default async function InspectorPage() {
  const session = await getSession();
  if (session.status !== "authenticated") {
    redirect("/login");
  }

  const root = defaultRuntimeRoot();
  const [projects, inspections, approvals] = await Promise.all([
    loadProjectSummaries(session.supabase),
    listInspections(root, session.user.id),
    listApprovals(root, session.user.id),
  ]);
  const ghost = projects.status === "ok" ? projects.data.find((project) => project.name.toLocaleLowerCase() === "ghost") : null;
  const projectId = ghost?.id ?? "";
  const latest = latestInspections(inspections);
  const targets = inspectionTargets();
  const pending = approvals.filter((approval) => approval.status === "PENDING" || approval.status === "APPROVED" || approval.status === "REJECTED");

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Inspector</p>
          <h1>What was checked.</h1>
        </div>
      </div>
      <Panel title="Run safe checks">
        <p className="quiet">
          Runs the allowlisted test, lint, TypeScript, build, and read-only inspections. Commands are fixed. A build
          result does not mean the app is deployed.
        </p>
        {!projectId ? (
          <p className="notice">No visible GHOST project.</p>
        ) : targets.length === 0 ? (
          <p className="notice">{HOSTED_INSPECTION_REFUSAL}</p>
        ) : (
          <RunInspectionForm projectId={projectId} targets={targets} />
        )}
      </Panel>
      {latest.length === 0 ? <EmptyState>No inspection has been run for this account.</EmptyState> : null}
      {latest.map((result) => (
        <Panel title={result.name} key={result.id}>
          <ul className="meta">
            <li>
              <StatusBadge status={result.status} />
            </li>
            <li>Checked {result.completedAt}</li>
            <li>Commit {result.commit ? result.commit.slice(0, 7) : "none"}</li>
            <li>Working tree {result.workingTree ?? "not bound"}</li>
            {result.exitCode != null ? <li>Exit {result.exitCode}</li> : null}
          </ul>
          <p>{result.summary}</p>
        </Panel>
      ))}
      <Panel title="Pending approval">
        <p className="quiet">High and critical actions stay pending until you use these buttons. Chat text is not approval.</p>
        {projectId ? <ProposeActionForm projectId={projectId} /> : null}
      </Panel>
      {pending.length === 0 ? <EmptyState>No action approvals are recorded.</EmptyState> : null}
      {pending.map((approval) => (
        <Panel title={`${approval.risk} ${approval.actionType}`} key={approval.id}>
          <ul className="meta">
            <li>
              <StatusBadge status={approval.status} />
            </li>
            <li>
              <StatusBadge status={approval.risk} />
            </li>
            <li>Target {approval.target}</li>
          </ul>
          <p>{approval.reason}</p>
          <p className="quiet">After action: {approval.verificationPlan}</p>
          <ApprovalDecision
            approvalId={approval.id}
            target={approval.target}
            migration={approval.parameters.migration ?? ""}
          />
        </Panel>
      ))}
    </div>
  );
}
