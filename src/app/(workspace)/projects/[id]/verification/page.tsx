import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { GhostConversation } from "@/components/ghost/conversation";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState, ErrorState, Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { isModelConfigured } from "@/lib/ai/provider";
import { getSession } from "@/lib/auth/session";
import { loadBuildExecution } from "@/lib/build-execution/queries";
import { loadLatestConversation } from "@/lib/conversation/queries";
import { loadProjectDetail } from "@/lib/projects/queries";
import {
  addVerificationEvidenceAction,
  escalateVerificationDecisionAction,
  failVerificationCaseAction,
  initializeVerificationAction,
  markCaseNotApplicableAction,
  passVerificationCaseAction,
  resolveVerificationDefectAction,
  retestVerificationDefectAction,
  startVerificationCaseAction,
  syncVerificationNextActionAction,
  transitionVerificationAction,
} from "@/lib/verification/actions";
import {
  loadVerificationHistory,
  loadVerificationProgram,
  loadVerificationBundle,
} from "@/lib/verification/queries";
import { VERIFICATION_EVIDENCE_KINDS } from "@/lib/verification/types";
import { evaluateVerificationBundle, isBlockingDefect } from "@/lib/verification/workflow";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `Verification ${id.slice(0, 8)}` };
}

function options(values: readonly string[]) {
  return values.map((value) => (
    <option key={value} value={value}>
      {value}
    </option>
  ));
}

export default async function VerificationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  if (!UUID_PATTERN.test(projectId)) notFound();

  const session = await getSession();
  if (session.status !== "authenticated") redirect("/login");

  const project = await loadProjectDetail(session.supabase, projectId);
  if (project.status === "error") {
    return (
      <div className="stack">
        <h1>Verification</h1>
        <ErrorState message={project.message} />
      </div>
    );
  }
  if (!project.data) notFound();

  const programResult = await loadVerificationProgram(session.supabase, projectId);
  if (programResult.status === "error") {
    return (
      <div className="stack">
        <h1>Verification</h1>
        <ErrorState message={programResult.message} />
      </div>
    );
  }

  if (!programResult.data) {
    const [conversation, execution] = await Promise.all([
      loadLatestConversation(session.supabase, projectId),
      loadBuildExecution(session.supabase, projectId),
    ]);
    const executionStatus = execution.status === "ok" ? execution.data?.status ?? null : null;
    return (
      <div className="stack">
        <div className="page-head">
          <div>
            <p className="eyebrow">Verification</p>
            <h1>{project.data.name}</h1>
          </div>
          <Link className="button-secondary" href={`/projects/${projectId}`}>
            Back to project
          </Link>
        </div>
        <Panel title="Initialize Verification">
          <p className="quiet">
            Starts authoritative testing of an IMPLEMENTED Build Execution. Cases seed from Build Plan verifications.
            VERIFIED means the verification gate passed — not deployed. Ghost will not invent pass evidence.
          </p>
          {execution.status === "error" ? <ErrorState message={execution.message} /> : null}
          <p className="quiet">
            Build Execution: {executionStatus ?? "not initialized"}
            {executionStatus && executionStatus !== "IMPLEMENTED" ? " (must be IMPLEMENTED first)" : ""}
          </p>
          <ActionForm action={initializeVerificationAction} submitLabel="Initialize Verification">
            <input type="hidden" name="projectId" value={projectId} />
          </ActionForm>
        </Panel>
        <Panel title="Ask Ghost about verification">
          <p className="quiet">
            Verification is not initialized yet. Answers must say what is unknown until verification records exist.
          </p>
          {conversation.status === "error" ? <ErrorState message={conversation.message} /> : null}
          <GhostConversation
            projectId={projectId}
            projectName={project.data.name}
            conversationId={conversation.status === "ok" ? conversation.data?.id ?? null : null}
            messages={conversation.status === "ok" ? conversation.data?.messages ?? [] : []}
            providerConfigured={isModelConfigured()}
          />
        </Panel>
      </div>
    );
  }

  const program = programResult.data;
  const [bundleResult, history, conversation] = await Promise.all([
    loadVerificationBundle(session.supabase, program),
    loadVerificationHistory(session.supabase, program.id),
    loadLatestConversation(session.supabase, projectId),
  ]);

  if (bundleResult.status === "error") {
    return (
      <div className="stack">
        <h1>Verification</h1>
        <ErrorState message={bundleResult.message} />
      </div>
    );
  }

  const bundle = bundleResult.data;
  const { completion, coverage, regression, gaps } = evaluateVerificationBundle(bundle);
  const historyRows = history.status === "ok" ? history.data : [];

  const needsTesting = bundle.cases.filter(
    (row) =>
      row.isRequired &&
      (row.status === "PLANNED" || row.status === "READY" || row.status === "RUNNING" || row.status === "BLOCKED"),
  );
  const failed = bundle.cases.filter((row) => row.status === "FAILED");
  const passed = bundle.cases.filter((row) => row.status === "PASSED");
  const openDefects = bundle.defects.filter((row) => row.status !== "CLOSED");
  const blockingDefects = openDefects.filter(
    (row) =>
      (row.status === "OPEN" || row.status === "IN_PROGRESS" || row.status === "RETEST_REQUIRED") &&
      isBlockingDefect(row.severity, row.blocking),
  );
  const regressionCases = regression.requiredRegressionCases;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Verification</p>
          <h1>{project.data.name}</h1>
        </div>
        <ul className="meta">
          <li>
            <StatusBadge status={program.status} />
          </li>
          <li>
            <Link className="button-secondary" href={`/projects/${projectId}`}>
              Project
            </Link>
          </li>
          <li>
            <Link className="button-secondary" href={`/projects/${projectId}/execution`}>
              Build Execution
            </Link>
          </li>
        </ul>
      </div>

      <Panel title="Status">
        <p>
          Status <strong>{program.status}</strong> · Execution {bundle.executionStatus ?? "missing"} · Cases{" "}
          {bundle.cases.length}
        </p>
        <ul className="meta">
          <li>Needs testing: {needsTesting.length}</li>
          <li>Failed: {failed.length}</li>
          <li>Passed: {passed.length}</li>
          <li>Evidence: {bundle.evidence.length}</li>
          <li>Open defects: {openDefects.length}</li>
          <li>Blocking defects: {blockingDefects.length}</li>
          <li>Open decisions: {bundle.openDecisionCount}</li>
        </ul>
        <p className="quiet">
          VERIFIED means the verification gate passed. It is not deployed. IMPLEMENTED is not VERIFIED. No secret values
          in evidence references.
        </p>
        <div className="meta">
          {(["TESTING", "VERIFICATION_REVIEW", "VERIFIED"] as const).map((status) => (
            <ActionForm key={status} action={transitionVerificationAction} submitLabel={`Move to ${status}`}>
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="toStatus" value={status} />
              <input type="hidden" name="reason" value={`Founder moved Verification to ${status}.`} />
            </ActionForm>
          ))}
        </div>
        <ActionForm action={syncVerificationNextActionAction} submitLabel="Record justified next action">
          <input type="hidden" name="projectId" value={projectId} />
        </ActionForm>
      </Panel>

      <Panel title="Progress / coverage">
        <p className="quiet">Requirement and feature coverage via required verification cases.</p>
        <h3>Requirements</h3>
        <ul className="meta">
          {coverage.requirements.slice(0, 20).map((row) => (
            <li key={row.id}>
              {row.humanId}: {row.verified ? "VERIFIED" : row.caseStatuses.join(", ") || "unlinked"}
            </li>
          ))}
        </ul>
        <h3>Features</h3>
        <ul className="meta">
          {coverage.features.slice(0, 20).map((row) => (
            <li key={row.id}>
              {row.humanId}: {row.verified ? "VERIFIED" : row.caseStatuses.join(", ") || "unlinked"}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Completion gaps">
        {completion.verificationComplete ? (
          <>
            <p>
              <strong>VERIFICATION COMPLETE</strong> (not deployed)
            </p>
            <ul className="meta">
              {completion.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p>
              <strong>NOT COMPLETE</strong> · {gaps.length} item{gaps.length === 1 ? "" : "s"} remaining
            </p>
            <ul className="meta">
              {gaps.map((gap) => (
                <li key={gap.code + gap.message}>{gap.message}</li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      <Panel title="Needs Testing">
        {needsTesting.length === 0 ? <EmptyState>No required cases need testing.</EmptyState> : null}
        {needsTesting.map((row) => (
          <article className="list-item" key={row.id}>
            <h3>
              {row.humanId}: {row.title}
            </h3>
            <p className="quiet">
              {row.status} · {row.caseKind}
              {row.isRegression ? " · regression" : ""}
            </p>
            {row.status === "READY" || row.status === "PLANNED" ? (
              <ActionForm action={startVerificationCaseAction} submitLabel="Start case">
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="caseId" value={row.id} />
              </ActionForm>
            ) : null}
            {row.status === "RUNNING" ? (
              <>
                <ActionForm action={addVerificationEvidenceAction} submitLabel="Add evidence">
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="caseId" value={row.id} />
                  <label className="field">
                    <span>Kind</span>
                    <select name="kind" defaultValue="MANUAL_OBSERVATION">
                      {options(VERIFICATION_EVIDENCE_KINDS)}
                    </select>
                  </label>
                  <label className="field">
                    <span>Reference (no secrets)</span>
                    <input name="reference" required placeholder="inspector run, command, path…" />
                  </label>
                  <label className="field">
                    <span>Summary</span>
                    <textarea name="summary" />
                  </label>
                </ActionForm>
                <ActionForm action={passVerificationCaseAction} submitLabel="Mark PASSED">
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="caseId" value={row.id} />
                  <label className="field">
                    <span>Actual result</span>
                    <textarea name="actualResult" />
                  </label>
                </ActionForm>
                <ActionForm action={failVerificationCaseAction} submitLabel="Mark FAILED">
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="caseId" value={row.id} />
                  <label className="field">
                    <span>Actual result</span>
                    <textarea name="actualResult" required />
                  </label>
                  <label className="field">
                    <span>Create upstream change</span>
                    <select name="createUpstreamChange" defaultValue="0">
                      <option value="0">No</option>
                      <option value="1">Yes</option>
                    </select>
                  </label>
                </ActionForm>
              </>
            ) : null}
            <ActionForm action={markCaseNotApplicableAction} submitLabel="Mark NOT_APPLICABLE">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="caseId" value={row.id} />
              <label className="field">
                <span>Reason</span>
                <textarea name="reason" required />
              </label>
            </ActionForm>
          </article>
        ))}
      </Panel>

      <Panel title="Failed">
        {failed.length === 0 ? <EmptyState>No failed cases.</EmptyState> : null}
        {failed.map((row) => (
          <article className="list-item" key={row.id}>
            <h3>
              {row.humanId}: {row.title}
            </h3>
            <p>{row.actualResult || "No actual result recorded."}</p>
          </article>
        ))}
      </Panel>

      <Panel title="Defects">
        {openDefects.length === 0 ? <EmptyState>No open defects.</EmptyState> : null}
        {openDefects.map((row) => (
          <article className="list-item" key={row.id}>
            <h3>
              {row.humanId}: {row.title}
            </h3>
            <p className="quiet">
              {row.status} · {row.severity}
              {isBlockingDefect(row.severity, row.blocking) ? " · blocking" : ""}
            </p>
            <p>{row.description || "No description"}</p>
            {row.status === "OPEN" || row.status === "IN_PROGRESS" ? (
              <ActionForm action={resolveVerificationDefectAction} submitLabel="Resolve → retest">
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="defectId" value={row.id} />
                <label className="field">
                  <span>Resolution</span>
                  <textarea name="resolution" required />
                </label>
              </ActionForm>
            ) : null}
            {row.status === "RETEST_REQUIRED" ? (
              <ActionForm action={retestVerificationDefectAction} submitLabel="Record retest">
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="defectId" value={row.id} />
                <input type="hidden" name="caseId" value={row.retestCaseId ?? row.caseId} />
                <label className="field">
                  <span>Result</span>
                  <select name="resultStatus" defaultValue="PASSED">
                    <option value="PASSED">PASSED</option>
                    <option value="FAILED">FAILED</option>
                    <option value="BLOCKED">BLOCKED</option>
                  </select>
                </label>
                <label className="field">
                  <span>Evidence reference (for PASSED)</span>
                  <input name="evidenceReference" placeholder="inspector run, path…" />
                </label>
                <label className="field">
                  <span>Note</span>
                  <textarea name="note" />
                </label>
              </ActionForm>
            ) : null}
          </article>
        ))}
      </Panel>

      <Panel title="Passed">
        {passed.length === 0 ? <EmptyState>No passed cases yet.</EmptyState> : null}
        {passed.map((row) => (
          <article className="list-item" key={row.id}>
            <h3>
              {row.humanId}: {row.title}
            </h3>
            <p className="quiet">
              Evidence {bundle.evidence.filter((item) => item.caseId === row.id).length} · completed{" "}
              {row.completedAt ?? "unknown"}
            </p>
          </article>
        ))}
      </Panel>

      <Panel title="Regression">
        <p className="quiet">
          Required regression cases from is_regression flags and linked IMPLEMENTED packages. Covered:{" "}
          {regression.covered ? "YES" : "NO"}
        </p>
        {regressionCases.length === 0 ? <EmptyState>No required regression cases.</EmptyState> : null}
        <ul className="meta">
          {regressionCases.map((row) => (
            <li key={row.id}>
              {row.humanId}: {row.status}
              {row.isRegression ? " (flagged)" : " (linked package)"}
            </li>
          ))}
        </ul>
        {regression.gaps.length > 0 ? (
          <ul className="meta">
            {regression.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <Panel title="Decisions">
        {bundle.openDecisions.length === 0 ? <EmptyState>No open project decisions.</EmptyState> : null}
        {bundle.openDecisions.map((row) => (
          <article className="list-item" key={row.id}>
            <h3>{row.title}</h3>
            <p>{row.question}</p>
          </article>
        ))}
        <ActionForm action={escalateVerificationDecisionAction} submitLabel="Escalate verification decision">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="field">
            <span>Question</span>
            <textarea name="question" required />
          </label>
          <label className="field">
            <span>Option A</span>
            <input name="optionA" />
          </label>
          <label className="field">
            <span>Option B</span>
            <input name="optionB" />
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Evidence">
        {bundle.evidence.length === 0 ? <EmptyState>No verification evidence recorded.</EmptyState> : null}
        {bundle.evidence.map((row) => (
          <article className="list-item" key={row.id}>
            <h3>
              {row.kind}: {row.reference}
            </h3>
            <p className="quiet">{row.summary || "No summary"}</p>
          </article>
        ))}
        <ActionForm action={addVerificationEvidenceAction} submitLabel="Add evidence to case">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="field">
            <span>Case</span>
            <select name="caseId" required>
              {bundle.cases.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.humanId}: {row.title} ({row.status})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Kind</span>
            <select name="kind" defaultValue="MANUAL_OBSERVATION">
              {options(VERIFICATION_EVIDENCE_KINDS)}
            </select>
          </label>
          <label className="field">
            <span>Reference</span>
            <input name="reference" required />
          </label>
          <label className="field">
            <span>Summary</span>
            <textarea name="summary" />
          </label>
        </ActionForm>
      </Panel>

      <Panel title="History">
        {historyRows.length === 0 ? <EmptyState>No transitions yet.</EmptyState> : null}
        <ul className="meta">
          {historyRows.map((row) => (
            <li key={row.id}>
              {row.fromStatus ?? "∅"} → {row.toStatus} · {row.reason} · {row.changedAt}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Ask Ghost">
        <p className="quiet">
          Ask about verification status, failures, defects, coverage, or next tests. VERIFIED is not deployed. Past
          Ghost answers are not evidence.
        </p>
        {conversation.status === "error" ? <ErrorState message={conversation.message} /> : null}
        <GhostConversation
          projectId={projectId}
          projectName={project.data.name}
          conversationId={conversation.status === "ok" ? conversation.data?.id ?? null : null}
          messages={conversation.status === "ok" ? conversation.data?.messages ?? [] : []}
          providerConfigured={isModelConfigured()}
        />
      </Panel>
    </div>
  );
}
