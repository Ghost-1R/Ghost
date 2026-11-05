"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  pauseLeadWorkers,
  resumeLeadWorkers,
  runLeadWorkersNow,
  setLeadWorkerScheduler,
} from "@/lib/lead-workers/actions";
import type { LeadWorkerBoardState } from "@/lib/lead-workers/types";
import styles from "./command.module.css";

export function LeadWorkerPanel({ state }: { state: LeadWorkerBoardState }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: true; notice: string } | { ok: false; error: string }>) => {
    setNotice(null);
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(result.notice);
      router.refresh();
    });
  };

  return (
    <div className={styles.leadWorkers}>
      <p className={styles.muted}>
        Badger United lead finders · Will (day) / Bubba (night) · America/New_York every day
      </p>
      {!state.schedulerAvailable ? (
        <p className={styles.blocker} role="status">
          {state.unavailableReason ?? "Scheduler unavailable."}
        </p>
      ) : (
        <p className={styles.muted}>
          Scheduler available · Brave {state.braveRequestsToday}/{state.dailyBraveCap}
          {state.braveQuotaDay ? ` · day ${state.braveQuotaDay}` : ""}
        </p>
      )}
      {state.lastHandoffSummary ? (
        <p className={styles.muted}>Last handoff: {state.lastHandoffSummary}</p>
      ) : null}

      <div className={styles.leadWorkerCards}>
        {state.workers.map((worker) => (
          <article
            key={worker.slug}
            className={styles.leadWorkerCard}
            style={{ borderLeftColor: worker.colorHex }}
          >
            <header>
              <strong style={{ color: worker.colorHex }}>{worker.displayName}</strong>
              <span className={styles.muted}>
                {worker.executing ? "Executing" : worker.duty === "on" ? "On duty" : "Off duty"}
              </span>
            </header>
            <p className={styles.muted}>{worker.shiftLabel}</p>
            <p className={styles.muted}>
              Last success:{" "}
              {worker.lastSuccessfulRunAt
                ? new Date(worker.lastSuccessfulRunAt).toLocaleString()
                : "—"}
            </p>
            <p className={styles.muted}>
              Next run:{" "}
              {worker.nextRunAt ? new Date(worker.nextRunAt).toLocaleString() : "—"}
            </p>
            <p className={styles.muted}>Leads added: {worker.leadsAddedTotal}</p>
            {worker.lastBlocker ? (
              <p className={styles.blocker} role="status">
                {worker.lastBlocker}
              </p>
            ) : null}
          </article>
        ))}
      </div>

      <div className={styles.pipelineActions}>
        {!state.enabled ? (
          <button
            type="button"
            className={styles.goldBtn}
            disabled={pending}
            onClick={() =>
              run(async () => {
                const form = new FormData();
                form.set("enabled", "1");
                return setLeadWorkerScheduler(form);
              })
            }
          >
            Enable scheduler
          </button>
        ) : state.paused ? (
          <button
            type="button"
            className={styles.goldBtn}
            disabled={pending}
            onClick={() => run(() => resumeLeadWorkers())}
          >
            Resume
          </button>
        ) : (
          <button type="button" disabled={pending} onClick={() => run(() => pauseLeadWorkers())}>
            Pause
          </button>
        )}
        <button
          type="button"
          className={styles.goldBtn}
          disabled={pending}
          onClick={() => run(() => runLeadWorkersNow())}
        >
          {pending ? "Working…" : "Run now"}
        </button>
        {state.enabled ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const form = new FormData();
                form.set("enabled", "0");
                return setLeadWorkerScheduler(form);
              })
            }
          >
            Disable
          </button>
        ) : null}
      </div>
      {error ? (
        <p className={styles.blocker} role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className={styles.muted} role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
