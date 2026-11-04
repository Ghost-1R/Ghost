"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState } from "@/components/ui/panel";
import { SoftNavLink } from "@/components/today/motion";
import { ResultExplainCard } from "@/components/today/result-explain";
import {
  confirmWorkerTestReview,
  saveFounderDayPlan,
} from "@/lib/dashboard/day-plan-actions";
import {
  applyDayPlanPlacements,
  buildWorkerAssignmentPreview,
  dayPlanSummary,
  groupDayPlan,
  moveDayPlanItem,
  placementsFromItems,
  recommendDayPlan,
  setDayPlanItemBucket,
  type DayPlanBucket,
  type DayPlanItem,
  type DayPlanPlacement,
  type OpenDecisionSeed,
} from "@/lib/dashboard/day-plan";
import type { AgentTaskSurfaceRow } from "@/lib/operations/agent-task-surface";
import type { TodayAction } from "@/lib/operations/today";

type ProjectOption = { id: string; name: string };

type LatestResult = {
  title: string;
  content: string;
  contentSha256: string | null;
  kind: string | null;
  href: string;
  projectName: string;
};

type NeedsDecisionCard = {
  id: string;
  title: string;
  question: string;
  projectName: string;
  reviewHref: string;
};

export function TodayDayBoard({
  actions,
  agentTasks,
  decisions,
  savedPlacements,
  planDate,
  timeZone,
  projects,
  latestResult,
  needsDecision,
}: {
  actions: TodayAction[];
  agentTasks: AgentTaskSurfaceRow[];
  decisions: OpenDecisionSeed[];
  savedPlacements: DayPlanPlacement[] | null;
  planDate: string;
  timeZone: string;
  projects: ProjectOption[];
  latestResult: LatestResult | null;
  needsDecision: NeedsDecisionCard | null;
}) {
  const router = useRouter();
  const recommended = useMemo(
    () => recommendDayPlan({ actions, agentTasks, decisions }),
    [actions, agentTasks, decisions],
  );
  const [draftItems, setDraftItems] = useState<DayPlanItem[]>(() =>
    applyDayPlanPlacements(recommended, savedPlacements),
  );
  const [arrangeOpen, setArrangeOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignMode, setAssignMode] = useState<"project" | "plan_tasks">("project");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>(() =>
    draftItems.filter((item) => item.bucket === "DO_FIRST").map((item) => item.id),
  );
  const [previewed, setPreviewed] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!arrangeOpen) {
      setDraftItems(applyDayPlanPlacements(recommended, savedPlacements));
    }
  }, [recommended, savedPlacements, arrangeOpen]);

  const displayItems = arrangeOpen
    ? draftItems
    : applyDayPlanPlacements(recommended, savedPlacements);
  const groups = groupDayPlan(displayItems);
  const summary = dayPlanSummary(displayItems);

  const selectedItems = displayItems.filter((item) => selectedItemIds.includes(item.id));
  const selectedProject = projects.find((project) => project.id === projectId) ?? null;
  const preview = buildWorkerAssignmentPreview({
    scope:
      assignMode === "project"
        ? {
            mode: "project",
            projectId: selectedProject?.id ?? "",
            projectName: selectedProject?.name ?? "Project",
          }
        : { mode: "plan_tasks", itemIds: selectedItemIds, items: selectedItems },
    agentTasks,
  });

  function refreshDraftFromRecommend() {
    setDraftItems(applyDayPlanPlacements(recommended, null));
  }

  function toggleItem(id: string) {
    setSelectedItemIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
    setPreviewed(false);
  }

  return (
    <div className="today-day-board">
      <header className="today-day-toolbar">
        <p className="today-design-chip">Design preview</p>
        <div className="today-day-actions">
          <button
            type="button"
            className="button"
            data-open={arrangeOpen ? "true" : "false"}
            onClick={() => {
              setArrangeOpen(true);
              setAssignOpen(false);
              setDraftItems(applyDayPlanPlacements(recommended, savedPlacements));
            }}
          >
            Arrange my day
          </button>
          <button
            type="button"
            className="button-secondary"
            data-open={assignOpen ? "true" : "false"}
            onClick={() => {
              setAssignOpen(true);
              setArrangeOpen(false);
              setPreviewed(false);
            }}
          >
            Assign worker
          </button>
        </div>
      </header>

      <div className="today-day-grid">
        <section className="today-plan-card today-card" aria-labelledby="plan-heading">
          <div className="ghost-home-section-head ghost-home-section-head-row">
            <div>
              <p className="eyebrow">Focus</p>
              <h2 id="plan-heading">Today&apos;s plan</h2>
              <p className="quiet">
                A clear, executable plan for today, grouped by priority.
              </p>
            </div>
            <p className="today-plan-count">{summary}</p>
          </div>

          {displayItems.length === 0 ? (
            <EmptyState>
              No open work to arrange yet. Ghost will not invent a to-do list.
            </EmptyState>
          ) : (
            <div className="today-plan-groups">
              {groups.map((group) => (
                <div
                  key={group.bucket}
                  className="today-plan-group"
                  data-bucket={group.bucket}
                >
                  <h3>{group.label}</h3>
                  <ol>
                    {group.items.map((item, index) => (
                      <li key={item.id}>
                        <div className="today-plan-item-main">
                          <span className="today-plan-index" aria-hidden="true">
                            {index + 1}
                          </span>
                          <div>
                            <p className="ceo-project-label">{item.projectName}</p>
                            <h4>{item.title}</h4>
                            {item.detail ? <p className="quiet">{item.detail}</p> : null}
                            {arrangeOpen ? (
                              <p className="today-plan-reason">{item.reason}</p>
                            ) : null}
                            <div className="today-plan-meta">
                              {item.estimateMinutes != null ? (
                                <span>~{item.estimateMinutes} min</span>
                              ) : null}
                              {item.statusTag ? (
                                <span
                                  className="today-status-tag"
                                  data-tag={item.statusTag.toLowerCase().replace(/\s+/g, "-")}
                                >
                                  {item.statusTag}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        <div className="today-plan-item-actions">
                          {arrangeOpen ? (
                            <>
                              <label className="today-bucket-select">
                                <span className="visually-hidden">Move to</span>
                                <select
                                  value={item.bucket}
                                  onChange={(event) => {
                                    setDraftItems((current) =>
                                      setDayPlanItemBucket(
                                        current,
                                        item.id,
                                        event.target.value as DayPlanBucket,
                                      ),
                                    );
                                  }}
                                >
                                  <option value="DO_FIRST">Do first</option>
                                  <option value="LATER">Later</option>
                                  <option value="WAITING">Waiting</option>
                                </select>
                              </label>
                              <button
                                type="button"
                                className="button-secondary"
                                onClick={() =>
                                  setDraftItems((current) => moveDayPlanItem(current, item.id, "up"))
                                }
                              >
                                Up
                              </button>
                              <button
                                type="button"
                                className="button-secondary"
                                onClick={() =>
                                  setDraftItems((current) =>
                                    moveDayPlanItem(current, item.id, "down"),
                                  )
                                }
                              >
                                Down
                              </button>
                            </>
                          ) : item.actionLabel ? (
                            <SoftNavLink className="button-secondary" href={item.href}>
                              {item.actionLabel}
                            </SoftNavLink>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}

          {arrangeOpen ? (
            <div className="today-arrange-panel">
              <p className="quiet">
                Recommendations explain why each item landed in Do first, Later, or Waiting.
                Reorder or change groups, then save.
              </p>
              <div className="today-inline-actions">
                <button type="button" className="button-secondary" onClick={refreshDraftFromRecommend}>
                  Reset to recommendation
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setArrangeOpen(false)}
                >
                  Cancel
                </button>
              </div>
              <ActionForm action={saveFounderDayPlan} submitLabel="Save today's plan">
                <input type="hidden" name="planDate" value={planDate} />
                <input type="hidden" name="timeZone" value={timeZone} />
                <input
                  type="hidden"
                  name="placementsJson"
                  value={JSON.stringify(placementsFromItems(draftItems))}
                />
              </ActionForm>
            </div>
          ) : null}
        </section>

        <aside className="today-day-side">
          <section
            className="today-assign-card today-card"
            aria-labelledby="assign-heading"
            data-open={assignOpen ? "true" : "false"}
          >
            <div className="ghost-home-section-head">
              <p className="eyebrow">Worker</p>
              <h2 id="assign-heading">Assign worker</h2>
              <p className="quiet">Give the worker a focused review task for today.</p>
            </div>

            <fieldset className="today-assign-mode">
              <legend className="visually-hidden">Assignment scope</legend>
              <label
                className="today-assign-choice"
                data-selected={assignMode === "project" ? "true" : "false"}
              >
                <input
                  type="radio"
                  name="assignMode"
                  checked={assignMode === "project"}
                  onChange={() => {
                    setAssignMode("project");
                    setPreviewed(false);
                  }}
                />
                <span>Review a project</span>
              </label>
              <label
                className="today-assign-choice"
                data-selected={assignMode === "plan_tasks" ? "true" : "false"}
              >
                <input
                  type="radio"
                  name="assignMode"
                  checked={assignMode === "plan_tasks"}
                  onChange={() => {
                    setAssignMode("plan_tasks");
                    setPreviewed(false);
                    setSelectedItemIds((current) =>
                      current.length > 0 ? current : displayItems.map((item) => item.id),
                    );
                  }}
                />
                <span>Review today&apos;s tasks</span>
              </label>
            </fieldset>

            {assignMode === "project" ? (
              <label className="field">
                <span>Project</span>
                <select
                  value={projectId}
                  onChange={(event) => {
                    setProjectId(event.target.value);
                    setPreviewed(false);
                  }}
                >
                  {projects.length === 0 ? <option value="">No projects</option> : null}
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="today-assign-task-list">
                <p className="quiet">Choose specific tasks from today&apos;s plan.</p>
                <ul>
                  {displayItems.map((item) => (
                    <li key={item.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedItemIds.includes(item.id)}
                          onChange={() => toggleItem(item.id)}
                        />
                        <span>
                          <strong>{item.title}</strong>
                          <span className="quiet"> · {item.projectName}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!previewed ? (
              <button
                type="button"
                className="button"
                disabled={pending || (assignMode === "project" ? !projectId : selectedItems.length === 0)}
                onClick={() => setPreviewed(true)}
              >
                Preview assignment
              </button>
            ) : (
              <div className="today-assign-preview">
                <h3>{preview.title}</h3>
                <p className="eyebrow">Will review</p>
                <ul>
                  {preview.willReview.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="eyebrow">Will return</p>
                <ul>
                  {preview.willReturn.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="notice">{preview.chargeLabel}</p>
                {!preview.taskId ? (
                  <p className="alert" role="alert">
                    No worker task is available for this scope yet. Open Worker from a project that
                    already has a queued test task.
                  </p>
                ) : (
                  <ActionForm
                    action={confirmWorkerTestReview}
                    submitLabel="Start test review"
                  >
                    <input type="hidden" name="previewConfirmed" value="yes" />
                    <input type="hidden" name="mode" value={preview.mode} />
                    <input type="hidden" name="projectId" value={preview.projectId ?? ""} />
                    <input type="hidden" name="taskId" value={preview.taskId ?? ""} />
                    <input
                      type="hidden"
                      name="linkedItemIds"
                      value={preview.linkedItemIds.join(",")}
                    />
                  </ActionForm>
                )}
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setPreviewed(false)}
                >
                  Edit assignment
                </button>
              </div>
            )}
          </section>

          {latestResult ? (
            <ResultExplainCard
              title={latestResult.title}
              content={latestResult.content}
              contentSha256={latestResult.contentSha256}
              kind={latestResult.kind}
              href={latestResult.href}
              projectName={latestResult.projectName}
            />
          ) : null}

          {needsDecision ? (
            <article className="today-decision-card today-card">
              <p className="eyebrow">Needs your decision</p>
              <h3>{needsDecision.title}</h3>
              <p>{needsDecision.question}</p>
              <p className="ceo-project-label">{needsDecision.projectName}</p>
              <div className="today-inline-actions">
                <SoftNavLink className="button" href={needsDecision.reviewHref}>
                  Accept test result
                </SoftNavLink>
                <SoftNavLink className="button-secondary" href={needsDecision.reviewHref}>
                  Review again
                </SoftNavLink>
              </div>
            </article>
          ) : null}

          <p className="quiet today-ask-jump">
            <Link href="#ask-ghost">Ask Ghost</Link>
            {" · "}
            <button
              type="button"
              className="linkish"
              onClick={() => {
                startTransition(() => router.refresh());
              }}
            >
              Refresh board
            </button>
          </p>
        </aside>
      </div>
    </div>
  );
}
