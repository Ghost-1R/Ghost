"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  deskActivityLabel,
  UNDERWORLD_CREW,
  type DeskMonitorSnapshot,
} from "@/lib/underworld/desks";
import styles from "./city.module.css";

const buildings = [
  { id: "planning", name: "Planning", type: "Department" },
  { id: "engineering", name: "Engineering", type: "Department" },
  { id: "review", name: "Quality Review", type: "Department" },
  { id: "team", name: "Team Office", type: "Department" },
  { id: "gym", name: "The Gym", type: "After hours" },
  { id: "restaurant", name: "Night Market", type: "Restaurant" },
  { id: "homes", name: "Residences", type: "After hours" },
] as const;

export type CityWork = {
  id: string;
  title: string;
  department: "planning" | "engineering" | "review" | "team";
  status: string;
  updated?: string;
  note?: string;
  steps?: number;
  handoff?: string | null;
  href: string;
  runHref?: string;
};

export type CityDesk = {
  workerId: string;
  name: string;
  role: string;
  office: string;
  after: string;
  /** Linked saved work, when founder records are available. */
  monitor: DeskMonitorSnapshot | null;
  /** Explicit empty desk — worker has no linked assignment/run. */
  unassigned: boolean;
};

export function UnderworldCity({
  work,
  desks,
  projectId,
  recordsWarning,
}: {
  work: CityWork[];
  desks: CityDesk[];
  projectId?: string;
  recordsWarning?: string;
}) {
  const router = useRouter();
  const monitorTitleId = useId();
  const [room, setRoom] = useState<string>("city");
  const [shift, setShift] = useState<"work" | "after" | "home">("work");
  const [follow, setFollow] = useState("");
  const [desk, setDesk] = useState("");
  const [monitorWorkerId, setMonitorWorkerId] = useState("");

  const worker = UNDERWORLD_CREW.find((member) => member.id === follow);
  const location = worker
    ? shift === "work"
      ? worker.office
      : shift === "after"
        ? worker.after
        : "homes"
    : room;
  const building = buildings.find((entry) => entry.id === location);
  const visitors = UNDERWORLD_CREW.filter(
    (member) =>
      (shift === "work" ? member.office : shift === "after" ? member.after : "homes") ===
      location,
  );
  const visibleWork = building
    ? work.filter((entry) => entry.department === building.id)
    : work;
  const selected = work.find((entry) => entry.id === desk);
  const sceneLabel = building?.name ?? "City overview";
  const handoff = selected?.handoff
    ? work.find((entry) => entry.id === selected.handoff)
    : undefined;
  const outgoing = selected ? work.filter((entry) => entry.handoff === selected.id) : [];

  const officeDesks = useMemo(() => {
    if (!building || building.type !== "Department") return [];
    return desks.filter((entry) => entry.office === building.id);
  }, [building, desks]);

  const onShiftHere = shift === "work";
  const openMonitor = desks.find((entry) => entry.workerId === monitorWorkerId);

  function openRoom(id: string) {
    setRoom(id);
    setFollow("");
    setDesk("");
    setMonitorWorkerId("");
  }

  function setSimulatedShift(next: "work" | "after" | "home") {
    // Simulation only — never mutates runner / assignment / agent-task state.
    setShift(next);
    setDesk("");
    setMonitorWorkerId("");
  }

  useEffect(() => {
    if (!projectId || !monitorWorkerId) return;
    let cancelled = false;
    let last = openMonitor?.monitor?.updatedAt ?? "";
    const tick = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch(`/api/workspace/${projectId}/status`, {
          headers: { Accept: "application/json" },
        });
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as { updatedAt?: string };
        if (body.updatedAt && body.updatedAt !== last) {
          last = body.updatedAt;
          router.refresh();
        }
      } catch {
        /* keep last known desk state */
      }
    };
    const id = window.setInterval(tick, 3500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [projectId, monitorWorkerId, openMonitor?.monitor?.updatedAt, router]);

  return (
    <div className={styles.city}>
      <header className={styles.hero}>
        <p className={styles.kicker}>GHOST / WORLD VIEW</p>
        <h1>Underworld</h1>
        <p>Follow the crew or open the records behind the work.</p>
        <div className={styles.controls}>
          <div role="group" aria-label="Simulated city time">
            {(
              [
                ["work", "On shift"],
                ["after", "After work"],
                ["home", "Night"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={shift === id}
                onClick={() => setSimulatedShift(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <label>
            Follow a worker
            <select
              value={follow}
              onChange={(event) => {
                setFollow(event.target.value);
                setDesk("");
                setMonitorWorkerId("");
              }}
            >
              <option value="">Choose a worker</option>
              {UNDERWORLD_CREW.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} · {member.role}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className={styles.hint}>
          City routines are simulated. Changing the simulated shift does not change the real
          runner. Assignment status comes from saved Ghost records.
        </p>
      </header>

      <section aria-label="City camera">
        <nav className={styles.sceneNav} aria-label="Camera locations">
          <button
            type="button"
            aria-pressed={location === "city"}
            onClick={() => openRoom("city")}
          >
            City overview
          </button>
          {buildings.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={location === entry.id}
              onClick={() => openRoom(entry.id)}
            >
              {entry.name}
            </button>
          ))}
        </nav>
        <div className={styles.scene} data-shift={shift}>
          <div key={location} className={styles.sceneArt} data-view={location} aria-hidden="true" />
          <div className={styles.sceneCaption} aria-live="polite">
            <strong>{sceneLabel}</strong>
            <span>
              {worker ? `Following ${worker.name} · Simulated` : "Simulated city"}
            </span>
          </div>
          {visitors.length > 0 && (
            <div className={styles.sceneCrew} key={`${location}-${shift}`} aria-hidden="true">
              {visitors.map((member) => (
                <span key={member.id}>{member.name}</span>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className={styles.room} aria-label="Building and work">
        <p className={styles.kicker}>
          {worker ? `Following ${worker.name}` : (building?.type ?? "Operations")}
        </p>
        <h2>{building?.name ?? "All work"}</h2>
        {building && visitors.length === 0 && <p>No simulated workers here this shift.</p>}
        {visitors.length > 0 && building?.type !== "Department" && (
          <div className={styles.work}>
            {visitors.map((member) => (
              <button
                key={member.id}
                type="button"
                aria-pressed={follow === member.id}
                onClick={() => setFollow(member.id)}
              >
                <strong>
                  {shift === "home" ? `${member.name}’s home` : member.name}
                </strong>
                <span>{member.role} · Simulated worker</span>
              </button>
            ))}
          </div>
        )}

        {officeDesks.length > 0 && (
          <div className={styles.deskFloor} aria-label={`${building?.name} desks`}>
            <h3>Employee desks</h3>
            <p className={styles.hint}>
              {onShiftHere
                ? "Everyone assigned to this office is at their desk. Open a monitor for saved work."
                : "Workers are off shift. Desks are vacant and monitors are asleep — last saved work is still available."}
            </p>
            {recordsWarning && <p role="status">{recordsWarning}</p>}
            <ul className={styles.deskGrid}>
              {officeDesks.map((entry) => {
                const occupied = onShiftHere;
                const activity = occupied
                  ? entry.unassigned
                    ? "idle"
                    : (entry.monitor?.activity ?? "idle")
                  : "asleep";
                const label = occupied
                  ? entry.unassigned
                    ? "No task assigned"
                    : entry.monitor
                      ? deskActivityLabel(entry.monitor.activity)
                      : recordsWarning
                        ? "Records unavailable"
                        : "No task assigned"
                  : "Monitor asleep";
                return (
                  <li key={entry.workerId} className={styles.deskCard} data-occupied={occupied}>
                    <div className={styles.deskMeta}>
                      <strong>{entry.name}</strong>
                      <span>{entry.role}</span>
                      <span data-activity={activity}>
                        {occupied ? label : "Vacant desk · monitor asleep"}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={styles.monitor}
                      data-activity={activity}
                      data-asleep={!occupied}
                      aria-pressed={monitorWorkerId === entry.workerId}
                      aria-haspopup="dialog"
                      aria-label={`${entry.name} monitor · ${label}`}
                      onClick={() => setMonitorWorkerId(entry.workerId)}
                    >
                      <span className={styles.monitorScreen} aria-hidden="true">
                        {occupied ? (
                          entry.unassigned || !entry.monitor ? (
                            <span className={styles.monitorIdle}>No task</span>
                          ) : (
                            <>
                              <span className={styles.monitorTitle}>
                                {entry.monitor.taskTitle ?? "Saved work"}
                              </span>
                              <span className={styles.monitorCue} data-activity={activity}>
                                {deskActivityLabel(entry.monitor.activity)}
                                {entry.monitor.activity === "active" &&
                                  entry.monitor.checkpointSequence != null && (
                                    <> · step {entry.monitor.checkpointSequence}</>
                                  )}
                              </span>
                            </>
                          )
                        ) : (
                          <span className={styles.monitorIdle}>Asleep</span>
                        )}
                      </span>
                      <span className={styles.monitorHint}>Open monitor</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {projectId && (
          <div className={styles.links}>
            <Link href={`/projects/${projectId}/build-plan`}>Open build plan</Link>
            <Link href={`/underworld/watch?project=${projectId}`}>Review risks</Link>
          </div>
        )}
        <h3>{building ? "Department records" : "Saved work"}</h3>
        {visibleWork.length === 0 && <p>No work records in this view yet.</p>}
        <div className={styles.work}>
          {visibleWork.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={desk === entry.id}
              onClick={() => setDesk(entry.id)}
            >
              <strong>{entry.title}</strong>
              <span>{entry.status}</span>
            </button>
          ))}
        </div>
      </section>

      {openMonitor && (
        <section
          className={styles.monitorPanel}
          role="dialog"
          aria-modal="false"
          aria-labelledby={monitorTitleId}
          aria-live="polite"
        >
          <div className={styles.monitorPanelHead}>
            <div>
              <p className={styles.kicker}>Desk monitor</p>
              <h2 id={monitorTitleId}>
                {openMonitor.name} · {openMonitor.role}
              </h2>
            </div>
            <button type="button" onClick={() => setMonitorWorkerId("")}>
              Close monitor
            </button>
          </div>
          {!onShiftHere && (
            <p className={styles.hint}>
              Simulated off-shift: desk is vacant and the monitor is asleep. Showing the last
              saved Ghost records only.
            </p>
          )}
          {recordsWarning && !openMonitor.monitor && !openMonitor.unassigned && (
            <p role="status">Work records could not be loaded. {recordsWarning}</p>
          )}
          {openMonitor.unassigned && (
            <p role="status">
              <strong>No task assigned.</strong> This simulated worker has no linked assignment
              or run for the open project.
            </p>
          )}
          {openMonitor.monitor && (
            <div className={styles.monitorDetail}>
              <p>
                <span className={styles.monitorCue} data-activity={openMonitor.monitor.activity}>
                  {deskActivityLabel(openMonitor.monitor.activity)}
                </span>
                {openMonitor.monitor.runStatus && (
                  <> · Run {openMonitor.monitor.runStatus.toLowerCase().replaceAll("_", " ")}</>
                )}
                {openMonitor.monitor.assignmentStatus && (
                  <> · Assignment {openMonitor.monitor.assignmentStatus}</>
                )}
              </p>
              <h3>{openMonitor.monitor.taskTitle ?? "Saved work"}</h3>
              <p>
                Last saved checkpoint:{" "}
                {openMonitor.monitor.checkpointSequence != null
                  ? `${openMonitor.monitor.checkpointLabel || "checkpoint"} · sequence ${openMonitor.monitor.checkpointSequence}`
                  : "None saved yet"}
              </p>
              {openMonitor.monitor.blockReason ? (
                <p role="status">
                  Blocker / approval needed: {openMonitor.monitor.blockReason}
                </p>
              ) : openMonitor.monitor.activity === "awaiting_approval" ? (
                <p role="status">Awaiting founder approval or review on the linked assignment.</p>
              ) : null}
              <div className={styles.links}>
                {openMonitor.monitor.workHref && (
                  <Link href={openMonitor.monitor.workHref}>Open assignment</Link>
                )}
                {openMonitor.monitor.runHref && (
                  <Link href={openMonitor.monitor.runHref}>Open worker run</Link>
                )}
                {openMonitor.monitor.evidenceHref && (
                  <Link href={openMonitor.monitor.evidenceHref}>Open evidence</Link>
                )}
              </div>
              {openMonitor.monitor.updatedAt && (
                <p>
                  <small>
                    Record updated{" "}
                    <time dateTime={openMonitor.monitor.updatedAt}>
                      {openMonitor.monitor.updatedAt.slice(0, 19).replace("T", " ")}
                    </time>
                    {projectId ? " · live while this monitor is open" : null}
                  </small>
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {selected && (
        <section className={styles.room} aria-label="Selected assignment" aria-live="polite">
          <p className={styles.kicker}>Work record</p>
          <h2>{selected.title}</h2>
          <p>
            {selected.status}
            {selected.updated && (
              <>
                {" "}
                · <time dateTime={selected.updated}>{selected.updated.slice(0, 10)}</time>
              </>
            )}
          </p>
          {selected.steps !== undefined && <p>{selected.steps} saved steps</p>}
          {selected.note && <p>{selected.note}</p>}
          {handoff && (
            <button type="button" onClick={() => setDesk(handoff.id)}>
              Open previous assignment · {handoff.title}
            </button>
          )}
          {outgoing.map((entry) => (
            <button key={entry.id} type="button" onClick={() => setDesk(entry.id)}>
              Follow handoff · {entry.title}
            </button>
          ))}
          <p>
            <Link href={selected.href}>Open original work →</Link>
          </p>
          {selected.runHref && (
            <p>
              <Link href={selected.runHref}>Open worker run and evidence →</Link>
            </p>
          )}
        </section>
      )}
    </div>
  );
}
