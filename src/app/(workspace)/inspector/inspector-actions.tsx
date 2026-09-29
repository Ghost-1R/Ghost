"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useActionState } from "react";
import { useExperience } from "@/components/ghost/experience";
import { initialActionState } from "@/lib/action-state";
import { overallStage, type InspectionProgress } from "@/lib/inspector/schedule";
import { SubmitButton } from "@/components/ui/submit-button";
import { attemptAction, proposeHighRiskAction, reviewAction } from "@/lib/inspector/actions";

function formatElapsed(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

export function RunInspectionForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { play, setActivity } = useExperience();
  const [events, setEvents] = useState<InspectionProgress[]>([]);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(0);
  const [started, setStarted] = useState<number | null>(null);

  useEffect(() => {
    if (!busy || started === null) {
      return;
    }
    const timer = window.setInterval(() => setClock(Date.now() - started), 500);
    return () => window.clearInterval(timer);
  }, [busy, started]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const began = Date.now();
    setStarted(began);
    setClock(0);
    setBusy(true);
    setActivity("INSPECTING");
    setEvents([{ stage: "QUEUED", check: null, status: null, elapsedMs: 0, detail: "Queued" }]);
    try {
      const response = await fetch("/api/inspector/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setEvents((current) => [
          ...current,
          {
            stage: "FAILED",
            check: null,
            status: "failed",
            elapsedMs: Date.now() - began,
            detail: payload?.error ?? "Inspection did not start.",
          },
        ]);
        play("ghost.warning");
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let latest: InspectionProgress | null = null;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        const parsed = lines.filter(Boolean).map((line) => JSON.parse(line) as InspectionProgress);
        if (parsed.length > 0) {
          latest = parsed.at(-1) ?? latest;
          setEvents((current) => [...current, ...parsed]);
          if (parsed.some((item) => item.check === "Build" && item.status === "running")) {
            setActivity("BUILDING");
          } else if (parsed.some((item) => item.stage === "COMPLETE" || item.stage === "FAILED" || item.stage === "BLOCKED")) {
            setActivity(null);
          } else {
            setActivity("INSPECTING");
          }
        }
      }
      if (latest?.stage === "COMPLETE" && latest.detail.includes("NOT_READY")) {
        play("ghost.blocked");
      } else if (latest?.stage === "COMPLETE" && latest.detail.endsWith("READY")) {
        play("ghost.presentation_ready");
      } else if (latest?.stage === "COMPLETE") {
        play("ghost.inspection_complete");
      } else if (latest?.stage === "FAILED") {
        play("ghost.warning");
      }
      router.refresh();
    } catch {
      setEvents((current) => [
        ...current,
        {
          stage: "FAILED",
          check: null,
          status: "failed",
          elapsedMs: Date.now() - began,
          detail: "Inspection stopped before it could finish.",
        },
      ]);
      play("ghost.warning");
    } finally {
      setBusy(false);
      setActivity(null);
    }
  }

  const latest = events.at(-1);
  const stage = overallStage(events);
  const checks = new Map<string, InspectionProgress>();
  for (const item of events) {
    if (item.check) {
      checks.set(item.check, item);
    }
  }

  return (
    <form onSubmit={onSubmit} className="stack">
      <button className="button" type="submit" disabled={busy}>
        {busy ? "Inspection running" : "Run inspection"}
      </button>
      {latest ? (
        <div className="inspection-live" aria-live="polite">
          <p>
            {(stage ?? latest.stage).replaceAll("_", " ")} · {formatElapsed(busy ? clock : latest.elapsedMs)}
          </p>
          <p className="quiet">{latest.detail}</p>
          <ul className="meta">
            {[...checks.values()].map((item) => (
              <li key={item.check} data-check={item.check} data-status={item.status ?? ""}>
                {item.check}: {item.status ?? item.stage}
                {item.durationMs != null ? ` ${formatElapsed(item.durationMs)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}

export function ProposeActionForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(proposeHighRiskAction, initialActionState);
  const { play } = useExperience();
  const playedApproval = useRef<string | null>(null);
  useEffect(() => {
    if (!state.notice || playedApproval.current === state.notice) {
      return;
    }
    playedApproval.current = state.notice;
    play("ghost.approval_required");
  }, [play, state.notice]);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="projectId" value={projectId} />
      <label className="field">
        <span>Action</span>
        <select name="actionType" defaultValue="apply-remote-migration">
          <option value="apply-remote-migration">Apply a remote migration</option>
          <option value="push">Push</option>
          <option value="merge">Merge</option>
          <option value="remote-db-reset">Remote database reset</option>
          <option value="force-push">Force push</option>
        </select>
      </label>
      <label className="field">
        <span>Target</span>
        <input name="target" required maxLength={200} placeholder="migration filename or branch" />
      </label>
      <label className="field">
        <span>Parameter</span>
        <input name="migration" maxLength={200} placeholder="optional parameter" />
      </label>
      <SubmitButton label="Propose action" />
      <p className="quiet">Proposing records the risk and waits. It does not apply a migration, push, merge, or reset.</p>
      {state.error ? <p className="alert">{state.error}</p> : null}
      {state.notice ? <p className="notice">{state.notice}</p> : null}
    </form>
  );
}

export function ApprovalDecision({
  approvalId,
  target,
  migration,
}: {
  approvalId: string;
  target: string;
  migration: string;
}) {
  const [reviewState, review] = useActionState(reviewAction, initialActionState);
  const [attemptState, attempt] = useActionState(attemptAction, initialActionState);
  return (
    <div className="stack">
      <form action={review} className="inline-form">
        <input type="hidden" name="approvalId" value={approvalId} />
        <SubmitButton label="Approve" name="decision" value="APPROVED" />
        <SubmitButton label="Reject" name="decision" value="REJECTED" />
        {reviewState.error ? <p className="alert">{reviewState.error}</p> : null}
        {reviewState.notice ? <p className="notice">{reviewState.notice}</p> : null}
      </form>
      <form action={attempt} className="stack">
        <input type="hidden" name="approvalId" value={approvalId} />
        <label className="field">
          <span>Execution target</span>
          <input name="target" defaultValue={target} maxLength={200} />
        </label>
        <label className="field">
          <span>Execution parameter</span>
          <input name="migration" defaultValue={migration} maxLength={200} />
        </label>
        <SubmitButton label="Attempt execution" />
        {attemptState.error ? <p className="alert">{attemptState.error}</p> : null}
        {attemptState.notice ? <p className="notice">{attemptState.notice}</p> : null}
      </form>
    </div>
  );
}
