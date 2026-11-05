"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  pauseOutreachWorker,
  prepareSesSandboxProbe,
  resumeOutreachWorker,
  runOutreachWorkerNow,
  setOutreachLiveEnabled,
  updateOutreachWorkerSettings,
} from "@/lib/outreach-worker/actions";
import type { OutreachBoardState } from "@/lib/outreach-worker/types";
import styles from "./command.module.css";

export function OutreachWorkerPanel({ state }: { state: OutreachBoardState }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [senderEmail, setSenderEmail] = useState(state.senderEmail);
  const [replyToEmail, setReplyToEmail] = useState(state.replyToEmail);
  const [postalAddress, setPostalAddress] = useState(state.postalAddress);
  const [dailySendCap, setDailySendCap] = useState(String(state.dailySendCap || 5));
  const [sesSandboxRecipient, setSesSandboxRecipient] = useState(state.sesSandboxRecipient);

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
        Outreach · Badger United email worker · {state.windowLabel} · provider {state.provider}
      </p>
      {!state.schedulerAvailable ? (
        <p className={styles.blocker} role="status">
          {state.unavailableReason ?? "Outreach send loop unavailable."}
        </p>
      ) : (
        <p className={styles.muted}>
          Live send loop available · SES {state.sendsToday}/{state.dailySendCap} today
          {state.sendQuotaDay ? ` · day ${state.sendQuotaDay}` : ""}
        </p>
      )}
      <p className={styles.muted}>
        Quotas · SES {state.sendsToday}/{state.dailySendCap} · Fake local{" "}
        {state.fakeSendsToday}/{state.dailySendCap}
        {state.sendQuotaDay ? ` · day ${state.sendQuotaDay}` : ""}
      </p>
      <p className={styles.muted}>
        Queue {state.queuedCount} · Sending {state.sendingCount} · Needs attention{" "}
        {state.needsAttentionCount}
      </p>
      {state.lastBlocker ? (
        <p className={styles.blocker} role="status">
          {state.lastBlocker}
        </p>
      ) : null}

      <div className={styles.pipelineFields}>
        <label className={styles.muted} htmlFor="outreach-sender">
          Verified Badger United sender
        </label>
        <input
          id="outreach-sender"
          type="email"
          value={senderEmail}
          onChange={(event) => setSenderEmail(event.target.value)}
          placeholder="hello@badgerunited.example"
        />
        <label className={styles.muted} htmlFor="outreach-reply">
          Monitored reply-to
        </label>
        <input
          id="outreach-reply"
          type="email"
          value={replyToEmail}
          onChange={(event) => setReplyToEmail(event.target.value)}
          placeholder="replies@badgerunited.example"
        />
        <label className={styles.muted} htmlFor="outreach-postal">
          Postal address (commercial ID)
        </label>
        <textarea
          id="outreach-postal"
          value={postalAddress}
          onChange={(event) => setPostalAddress(event.target.value)}
          rows={2}
          placeholder="Street, City, State ZIP"
        />
        <label className={styles.muted} htmlFor="outreach-cap">
          Daily send cap (per provider)
        </label>
        <input
          id="outreach-cap"
          type="number"
          min={1}
          max={200}
          value={dailySendCap}
          onChange={(event) => setDailySendCap(event.target.value)}
        />
        <label className={styles.muted} htmlFor="outreach-sandbox">
          SES sandbox inbox (verified, yours only)
        </label>
        <input
          id="outreach-sandbox"
          type="email"
          value={sesSandboxRecipient}
          onChange={(event) => setSesSandboxRecipient(event.target.value)}
          placeholder="you@your-verified-domain.example"
        />
      </div>

      <div className={styles.pipelineActions}>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const form = new FormData();
              form.set("senderEmail", senderEmail);
              form.set("replyToEmail", replyToEmail);
              form.set("postalAddress", postalAddress);
              form.set("dailySendCap", dailySendCap);
              form.set("sesSandboxRecipient", sesSandboxRecipient);
              form.set("commercialIdentity", state.commercialIdentity || "Badger United");
              form.set("senderDisplayName", "Badger United");
              return updateOutreachWorkerSettings(form);
            })
          }
        >
          Save Outreach settings
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const form = new FormData();
              form.set("sesSandboxRecipient", sesSandboxRecipient);
              return prepareSesSandboxProbe(form);
            })
          }
        >
          Prepare SES sandbox probe
        </button>
        {!state.liveEnabled ? (
          <button
            type="button"
            className={styles.goldBtn}
            disabled={pending}
            onClick={() =>
              run(async () => {
                const form = new FormData();
                form.set("enabled", "1");
                return setOutreachLiveEnabled(form);
              })
            }
          >
            Enable live sending
          </button>
        ) : state.paused ? (
          <button
            type="button"
            className={styles.goldBtn}
            disabled={pending}
            onClick={() => run(() => resumeOutreachWorker())}
          >
            Resume
          </button>
        ) : (
          <button type="button" disabled={pending} onClick={() => run(() => pauseOutreachWorker())}>
            Pause
          </button>
        )}
        <button
          type="button"
          className={styles.goldBtn}
          disabled={pending}
          onClick={() => run(() => runOutreachWorkerNow())}
        >
          {pending ? "Working…" : "Run now"}
        </button>
        {state.liveEnabled ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const form = new FormData();
                form.set("enabled", "0");
                return setOutreachLiveEnabled(form);
              })
            }
          >
            Disable live
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
