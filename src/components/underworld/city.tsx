"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "./city.module.css";

const buildings = [
  { id: "planning", name: "Planning", mark: "01", color: "violet", type: "Department" },
  { id: "engineering", name: "Engineering", mark: "02", color: "cyan", type: "Department" },
  { id: "review", name: "Quality Review", mark: "03", color: "green", type: "Department" },
  { id: "team", name: "Team Office", mark: "04", color: "blue", type: "Department" },
  { id: "gym", name: "The Gym", mark: "05", color: "coral", type: "After hours" },
  { id: "restaurant", name: "Night Market", mark: "06", color: "amber", type: "Restaurant" },
  { id: "homes", name: "Residences", mark: "07", color: "rose", type: "After hours" },
] as const;

const crew = [
  { id: "atlas", name: "Atlas", office: "planning", after: "gym", role: "Planner" },
  { id: "nova", name: "Nova", office: "engineering", after: "restaurant", role: "Builder" },
  { id: "sage", name: "Sage", office: "review", after: "homes", role: "Reviewer" },
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

export function UnderworldCity({ work, projectId }: { work: CityWork[]; projectId?: string }) {
  const [room, setRoom] = useState<string>("city");
  const [shift, setShift] = useState<"work" | "after" | "home">("work");
  const [follow, setFollow] = useState("");
  const [desk, setDesk] = useState("");
  const worker = crew.find((member) => member.id === follow);
  const location = worker ? shift === "work" ? worker.office : shift === "after" ? worker.after : "homes" : room;
  const building = buildings.find((entry) => entry.id === location);
  const visitors = crew.filter((member) =>
    (shift === "work" ? member.office : shift === "after" ? member.after : "homes") === location);
  const visibleWork = building ? work.filter((entry) => entry.department === building.id) : work;
  const selected = work.find((entry) => entry.id === desk);
  const handoff = selected?.handoff ? work.find((entry) => entry.id === selected.handoff) : undefined;
  const outgoing = selected ? work.filter((entry) => entry.handoff === selected.id) : [];

  function openRoom(id: string) {
    setRoom(id);
    setFollow("");
    setDesk("");
  }

  return (
    <div className={styles.city}>
      <header className={styles.hero}>
        <p className={styles.kicker}>GHOST / WORLD VIEW</p>
        <h1>Underworld</h1>
        <p>Explore the city, follow the crew, or trace a real assignment.</p>
        <div className={styles.controls}>
          <div role="group" aria-label="Simulated city time">
            {([["work", "On shift"], ["after", "After work"], ["home", "Night"]] as const).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={shift === id} onClick={() => setShift(id)}>{label}</button>
            ))}
          </div>
          <label>Follow a worker
            <select value={follow} onChange={(event) => { setFollow(event.target.value); setDesk(""); }}>
              <option value="">Choose a worker</option>
              {crew.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.role}</option>)}
            </select>
          </label>
        </div>
        <p className={styles.hint}>City routines are simulated. Assignment status comes from saved Ghost records.</p>
      </header>

      <div className={styles.layout}>
        <section className={styles.map} aria-label="City map">
          <div className={styles.sectionHead}>
            <h2>City map</h2>
            <button type="button" onClick={() => openRoom("city")}>City overview</button>
          </div>
          <div className={styles.blocks}>
            {buildings.map((entry) => (
              <button key={entry.id} type="button" data-color={entry.color}
                aria-pressed={location === entry.id} onClick={() => openRoom(entry.id)}>
                <span className={styles.tower} aria-hidden="true"><i /><i /><i /></span>
                <small>{entry.mark} / {entry.type}</small>
                <strong>{entry.name}</strong>
                <span className={styles.hint}>
                  {crew.filter((member) => (shift === "work" ? member.office : shift === "after" ? member.after : "homes") === entry.id)
                    .map((member) => member.name).join(" · ")}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className={styles.room} aria-label="Building and work">
          <p className={styles.kicker}>{worker ? `Following ${worker.name}` : building?.type ?? "Operations"}</p>
          <h2>{building?.name ?? "All work"}</h2>
          {building && visitors.length === 0 && <p>No simulated workers here this shift.</p>}
          {visitors.length > 0 && (
            <div className={styles.work}>
              {visitors.map((member) => (
                <button key={member.id} type="button" aria-pressed={follow === member.id} onClick={() => setFollow(member.id)}>
                  <strong>{shift === "work" ? `${member.name}’s desk` : shift === "home" ? `${member.name}’s home` : member.name}</strong>
                  <span>{member.role} · Simulated worker</span>
                </button>
              ))}
            </div>
          )}
          {location === "planning" && projectId && <Link href={`/projects/${projectId}`}>Open project plan</Link>}
          <h3>{building ? "Department records" : "Saved work"}</h3>
          {visibleWork.length === 0 && <p>No saved assignments or runs in this view.</p>}
          <div className={styles.work}>
            {visibleWork.map((entry) => (
              <button key={entry.id} type="button" aria-pressed={desk === entry.id} onClick={() => setDesk(entry.id)}>
                <strong>{entry.title}</strong>
                <span>{entry.status}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      {selected && (
        <section className={styles.room} aria-label="Selected assignment" aria-live="polite">
          <p className={styles.kicker}>Work record</p>
          <h2>{selected.title}</h2>
          <p>{selected.status}{selected.updated && <> · <time dateTime={selected.updated}>{selected.updated.slice(0, 10)}</time></>}</p>
          {selected.steps !== undefined && <p>{selected.steps} saved steps</p>}
          {selected.note && <p>{selected.note}</p>}
          {handoff && <button type="button" onClick={() => setDesk(handoff.id)}>Open previous assignment · {handoff.title}</button>}
          {outgoing.map((entry) => (
            <button key={entry.id} type="button" onClick={() => setDesk(entry.id)}>Follow handoff · {entry.title}</button>
          ))}
          <p><Link href={selected.href}>Open original work →</Link></p>
          {selected.runHref && <p><Link href={selected.runHref}>Open worker run and evidence →</Link></p>}
        </section>
      )}
    </div>
  );
}
