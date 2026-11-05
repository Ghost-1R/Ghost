"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CommandBoard } from "@/lib/command/types";
import styles from "./command.module.css";

const RAIL = [
  { href: "/command", label: "Overview", match: "exact" as const },
  { href: "/companies", label: "Companies" },
  { href: "/command#sentinel", label: "Sentinel" },
  { href: "/team", label: "Workforce" },
  { href: "/command#tasks", label: "Task Command" },
  { href: "/underworld", label: "Shifts & Attendance" },
  { href: "/command#radar", label: "Opportunity Radar" },
  { href: "/command#finance", label: "Finance" },
  { href: "/dashboard#ask-ghost", label: "Communications" },
  { href: "/approvals", label: "AI Control Room" },
  { href: "/underworld", label: "Underworld" },
  { href: "/settings", label: "Settings" },
];

const WORK_MODES = [
  { id: "desk", label: "Desk", detail: "Focus" },
  { id: "home", label: "Home", detail: "Remote" },
  { id: "gym", label: "Gym", detail: "Wellness" },
  { id: "entertainment", label: "Entertainment", detail: "Relax" },
  { id: "field", label: "Field", detail: "Mobile" },
] as const;

export function CommandDashboard({
  board,
  companies,
}: {
  board: CommandBoard;
  companies: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<(typeof WORK_MODES)[number]["id"]>("home");
  const clock = useMemo(() => {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(board.checkedAt));
    } catch {
      return board.checkedAt;
    }
  }, [board.checkedAt]);

  const humanAngle = `${Math.round(
    (board.workforce.human /
      Math.max(1, board.workforce.human + board.workforce.aiRegistered)) *
      100,
  )}%`;

  return (
    <div className={styles.command}>
      <nav className={styles.rail} aria-label="CEO Command">
        <div className={styles.brand}>
          <strong>GHOST CEO COMMAND</strong>
          <span>Founder operating system</span>
        </div>
        {RAIL.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            data-active={item.match === "exact" ? "true" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className={styles.main}>
        <header className={styles.topBar}>
          <div className={styles.greeting}>
            <strong>{board.greeting}</strong>
            <span>Scoped to verified Ghost records · LIVE stays gated</span>
          </div>
          <div
            className={styles.health}
            data-state={board.systemHealth.state}
            title={board.systemHealth.detail}
          >
            {board.systemHealth.label}
          </div>
          <div className={styles.meta}>
            <div>{clock} ET</div>
            <div>
              Alerts{" "}
              <strong>{board.alerts.filter((a) => a.severity === "critical").length}</strong>
            </div>
          </div>
          <form
            className={styles.filter}
            action="/command"
            method="get"
            onChange={(event) => {
              const form = event.currentTarget;
              const data = new FormData(form);
              const value = String(data.get("company") ?? "");
              router.push(value ? `/command?company=${encodeURIComponent(value)}` : "/command");
            }}
          >
            <label className={styles.muted} htmlFor="company-filter">
              Company
            </label>
            <select
              id="company-filter"
              name="company"
              defaultValue={board.companyFilterId ?? ""}
            >
              <option value="">All companies</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
            <noscript>
              <button type="submit">Apply</button>
            </noscript>
            <Link className={styles.goldBtn} href="/dashboard#ask-ghost">
              Ask Ghost
            </Link>
          </form>
        </header>

        <section className={styles.kpiRow} aria-label="Key metrics">
          {board.kpis.map((kpi) => (
            <Link key={kpi.id} href={kpi.href ?? "/command"} className={styles.kpi} data-tone={kpi.tone}>
              <span>{kpi.label}</span>
              <strong>{kpi.value}</strong>
              <span className={styles.muted}>{kpi.detail}</span>
            </Link>
          ))}
        </section>

        <section className={styles.grid} aria-label="Pulse and intelligence">
          <div className={styles.panel}>
            <h2>Company Pulse</h2>
            <div className={styles.pulseGrid}>
              {board.companies.length === 0 && (
                <p className={styles.muted}>No companies in scope. Open Companies to seed the catalog.</p>
              )}
              {board.companies.map((company) => (
                <Link key={company.id} href={company.href} className={styles.pulse}>
                  <span className={styles.mark}>{company.name.slice(0, 1)}</span>
                  <span>
                    <strong>{company.name}</strong>
                    <span className={styles.muted}>
                      {" "}
                      · {company.projectCount} projects · {company.openTasks} open tasks
                    </span>
                  </span>
                  <span className={styles.badge} data-tone={company.healthTone}>
                    {company.healthLabel}
                  </span>
                </Link>
              ))}
            </div>
          </div>

          <div className={styles.panel}>
            <h2>What needs me</h2>
            <div className={styles.list}>
              {board.briefing.length === 0 && (
                <p className={styles.muted}>No ranked founder actions from current signals.</p>
              )}
              {board.briefing.map((item) => (
                <Link key={item.id} href={item.href} className={styles.row}>
                  <strong>{item.title}</strong>
                  <span className={styles.muted}>Next: {item.next}</span>
                </Link>
              ))}
            </div>
            <p className={styles.muted} style={{ marginTop: 10 }}>
              Revenue trend chart needs comparable finance periods — see Finance module.
            </p>
          </div>

          <div className={styles.panel} id="sentinel">
            <h2>Alerts & Intelligence</h2>
            <div className={styles.list}>
              {board.alerts.length === 0 && (
                <p className={styles.muted}>No open signals from blockers, verification, or approvals.</p>
              )}
              {board.alerts.map((alert) => (
                <Link key={alert.id} href={alert.href} className={`${styles.row} ${styles.alert}`}>
                  <span className={styles.dot} data-severity={alert.severity} aria-hidden="true" />
                  <span>
                    <strong>{alert.title}</strong>
                    <span className={styles.muted}>
                      {" "}
                      · {alert.detail}
                      {alert.companyName ? ` · ${alert.companyName}` : ""}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.grid2} aria-label="Radar and workforce">
          <div className={styles.panel} id="radar">
            <h2>Opportunity Radar</h2>
            {board.opportunityBlocker ? (
              <p className={styles.blocker} role="status">
                {board.opportunityBlocker}
              </p>
            ) : board.opportunities.length === 0 ? (
              <p className={styles.muted}>No opportunities recorded yet. Add one after the migration.</p>
            ) : (
              <div className={styles.list}>
                {board.opportunities.map((item) => (
                  <article key={item.id} className={styles.row}>
                    <strong>{item.title}</strong>
                    <span className={styles.muted}>
                      {item.valueLabel} · {item.geography} · score{" "}
                      {item.score == null ? "—" : `${item.score}/100`} · {item.source}
                    </span>
                    <Link href={item.href}>Review opportunity</Link>
                  </article>
                ))}
              </div>
            )}
            <p className={styles.muted} style={{ marginTop: 10 }}>
              Sales Map stays separate for synced customer orders by geography.
            </p>
          </div>

          <div className={styles.panel}>
            <h2>Workforce Overview</h2>
            <div
              className={styles.donutWrap}
              style={{ ["--human-angle" as string]: humanAngle }}
            >
              <div className={styles.donut} aria-hidden="true">
                <span>
                  {board.workforce.human + board.workforce.aiRegistered}
                  <br />
                  total
                </span>
              </div>
              <p>
                Human {board.workforce.human} · AI registered {board.workforce.aiRegistered}
              </p>
              <p className={styles.muted}>{board.workforce.detail}</p>
              <p className={styles.muted}>
                On shift cue: {board.workforce.aiOnShift} · Executing now:{" "}
                {board.workforce.aiExecuting}
              </p>
            </div>
          </div>

          <div className={styles.panel}>
            <h2>My Tasks</h2>
            <div className={styles.list}>
              {board.myTasks.length === 0 && (
                <p className={styles.muted}>Nothing assigned to you in this scope.</p>
              )}
              {board.myTasks.map((task) => (
                <Link key={task.id} href={task.href} className={styles.row}>
                  <strong>
                    {task.done ? "✓ " : ""}
                    {task.title}
                  </strong>
                  <span className={styles.muted}>{task.priority}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.grid3} aria-label="Command board">
          <div className={styles.panel} id="tasks">
            <h2>Task Command Board</h2>
            <div className={styles.board}>
              {board.taskBoard.map((column) => (
                <div key={column.id} className={styles.column}>
                  <h4>
                    {column.label} ({column.items.length})
                  </h4>
                  <div className={styles.list}>
                    {column.items.length === 0 && (
                      <span className={styles.muted}>Empty</span>
                    )}
                    {column.items.map((item) => (
                      <Link key={item.id} href={item.href} className={styles.row}>
                        <strong>{item.title}</strong>
                        <span className={styles.muted}>{item.meta}</span>
                        {item.progress != null && (
                          <span className={styles.progress} aria-hidden="true">
                            <span style={{ width: `${item.progress}%` }} />
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.panel}>
            <h2>Shift Intelligence</h2>
            <p>
              Default window: Mon–Fri 9–5 {board.shifts.timezone} ·{" "}
              {board.shifts.withinDefaultWindow ? "Open now" : "Closed now"}
            </p>
            <p className={styles.muted}>AI executing: {board.shifts.aiActive}</p>
            <p className={styles.muted}>Next handover: {board.shifts.nextHandoverLabel}</p>
            <p style={{ marginTop: 10 }}>
              <Link href={board.shifts.href}>Open Underworld shifts →</Link>
            </p>
          </div>

          <div className={styles.panel}>
            <h2>Your Work Mode</h2>
            <p className={styles.muted}>
              Visual destination only — not attendance or evidence.
            </p>
            <div className={styles.modes} role="group" aria-label="Work mode">
              {WORK_MODES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={styles.mode}
                  aria-pressed={mode === entry.id}
                  onClick={() => setMode(entry.id)}
                >
                  <strong>{entry.label}</strong>
                  <span className={styles.muted}>{entry.detail}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.grid2} aria-label="Finance and connections">
          <div className={styles.panel} id="finance">
            <h2>Finance</h2>
            <div className={styles.list}>
              <div className={styles.row}>
                <strong>Cash collected</strong>
                <span>{board.finance.cashCollectedLabel}</span>
              </div>
              <div className={styles.row}>
                <strong>Invoiced</strong>
                <span>{board.finance.invoicedLabel}</span>
              </div>
              <div className={styles.row}>
                <strong>Profit (cash − expenses)</strong>
                <span>{board.finance.profitLabel}</span>
              </div>
            </div>
            <p className={styles.muted}>{board.finance.detail}</p>
            <p>
              <Link href={board.finance.href}>Open Sales Map / company records →</Link>
            </p>
          </div>
          <div className={styles.panel}>
            <h2>Connection health</h2>
            <div className={styles.list}>
              {board.connections.map((connection) => (
                <div key={connection.id} className={styles.row}>
                  <strong>
                    {connection.label} · {connection.state}
                  </strong>
                  <span className={styles.muted}>{connection.detail}</span>
                  {connection.href && <Link href={connection.href}>Open</Link>}
                </div>
              ))}
            </div>
          </div>
        </section>

        <footer className={styles.strip} aria-label="CEO decision strip">
          <div>
            <strong>CEO Decisions Pending ({board.decisionsPending.length})</strong>
            <div className={styles.list} style={{ marginTop: 6 }}>
              {board.decisionsPending.length === 0 && (
                <span className={styles.muted}>No pending founder authorizations.</span>
              )}
              {board.decisionsPending.map((item) => (
                <Link key={item.id} href={item.href}>
                  {item.title}
                </Link>
              ))}
            </div>
          </div>
          <div>
            <div>Profit: {board.finance.profitLabel}</div>
            <div>Cash: {board.finance.cashCollectedLabel}</div>
            <div className={styles.muted}>Active projects: {board.activeProjects}</div>
          </div>
          <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
            <Link className={styles.goldBtn} href={board.underworldHref || "/underworld"}>
              Command · Grow · Lead
            </Link>
            <Link href="/approvals">Open approvals</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
