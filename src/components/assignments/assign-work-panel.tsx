"use client";

import { useState } from "react";
import { ActionForm } from "@/components/ui/action-form";
import type { ActionState } from "@/lib/action-state";
import { submitAssignWorkForm } from "@/lib/assignments/actions";
import type { AssignPanelProject, AssignPanelTeammate } from "@/lib/assignments/queries";
import { describeMapScope, type MapScope } from "@/lib/assignments/types";
import { buildAssignmentPanelPreview } from "@/lib/assignments/workflow";

type AssignKind = "HUMAN" | "AI";

export type AssignWorkPanelProps = {
  projects: AssignPanelProject[];
  teammates: AssignPanelTeammate[];
  /** "today" = Today board; "map" = assigning a selected sales-map area. */
  mode: "today" | "map";
  /** Aggregate-only area selected on the map (required in map mode). */
  mapScope?: MapScope | null;
  defaultProjectId?: string | null;
  /** Override the submit action (the map page passes submitMapAreaAssignmentForm). */
  action?: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  heading?: string;
};

export function AssignWorkPanel({
  projects,
  teammates,
  mode,
  mapScope = null,
  defaultProjectId = null,
  action = submitAssignWorkForm,
  heading,
}: AssignWorkPanelProps) {
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? "");
  const [nextActionId, setNextActionId] = useState("");
  const [assignKind, setAssignKind] = useState<AssignKind>("HUMAN");
  const [assigneeUserId, setAssigneeUserId] = useState("");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [previewed, setPreviewed] = useState(false);

  const project = projects.find((entry) => entry.id === projectId) ?? null;
  const task = project?.tasks.find((entry) => entry.id === nextActionId) ?? null;
  const projectTeammates = teammates.filter(
    (mate) => !project || mate.companyId === project.companyId,
  );
  const assignee = projectTeammates.find((mate) => mate.userId === assigneeUserId) ?? null;

  const effectiveTitle =
    title.trim() ||
    (mapScope ? `Area work: ${describeMapScope(mapScope)}`.slice(0, 200) : task?.title ?? "");
  const needsScope = mode === "map" && !mapScope;
  const missingAssignee = assignKind === "HUMAN" && !assigneeUserId;
  const canPreview = Boolean(project) && effectiveTitle.length > 0 && !missingAssignee && !needsScope;

  const preview = buildAssignmentPanelPreview({
    kind: assignKind,
    projectName: project?.name ?? "",
    taskTitle: task?.title ?? null,
    title: effectiveTitle,
    instructions,
    dueAt: dueAt || null,
    assigneeLabel: assignee?.label ?? null,
    mapScope,
  });

  function edit<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPreviewed(false);
    };
  }

  return (
    <section
      className="today-assign-card today-card assign-work-panel"
      aria-labelledby={`assign-work-${mode}`}
      data-open="true"
    >
      <div className="ghost-home-section-head">
        <p className="eyebrow">{mode === "map" ? "Sales area" : "Assign work"}</p>
        <h2 id={`assign-work-${mode}`}>{heading ?? (mode === "map" ? "Assign selected area" : "Assign work")}</h2>
        <p className="quiet">
          {mode === "map"
            ? "Give a teammate or Ghost AI this area. Only aggregate area details are attached."
            : "Hand a task to a teammate, or let Ghost AI run a test review."}
        </p>
      </div>

      {mode === "map" ? (
        <p className={mapScope ? "notice" : "quiet"}>
          {mapScope
            ? `Area: ${describeMapScope(mapScope)}`
            : "Select a state, ZIP, or radius on the map first."}
        </p>
      ) : null}

      <fieldset className="today-assign-mode">
        <legend className="visually-hidden">Assign to</legend>
        {(
          [
            ["HUMAN", "Team member"],
            ["AI", "Ghost AI"],
          ] as const
        ).map(([value, label]) => (
          <label
            key={value}
            className="today-assign-choice"
            data-selected={assignKind === value ? "true" : "false"}
          >
            <input
              type="radio"
              name={`assignKind-${mode}`}
              checked={assignKind === value}
              onChange={() => edit(setAssignKind)(value)}
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>

      <label className="field">
        <span>Project</span>
        <select
          value={projectId}
          onChange={(event) => {
            edit(setProjectId)(event.target.value);
            setNextActionId("");
            setAssigneeUserId("");
          }}
        >
          {projects.length === 0 ? <option value="">No projects</option> : null}
          {projects.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Task (optional)</span>
        <select
          value={nextActionId}
          onChange={(event) => {
            edit(setNextActionId)(event.target.value);
            const picked = project?.tasks.find((entry) => entry.id === event.target.value);
            if (picked && !title.trim()) setTitle(picked.title);
          }}
        >
          <option value="">No linked task</option>
          {(project?.tasks ?? []).map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.title}
            </option>
          ))}
        </select>
      </label>

      {assignKind === "HUMAN" ? (
        <label className="field">
          <span>Team member</span>
          <select
            value={assigneeUserId}
            onChange={(event) => edit(setAssigneeUserId)(event.target.value)}
          >
            <option value="">
              {projectTeammates.length === 0 ? "No team members yet" : "Choose a team member"}
            </option>
            {projectTeammates.map((mate) => (
              <option key={`${mate.companyId}:${mate.userId}`} value={mate.userId}>
                {mate.label}
                {mate.role === "PROJECT_ADMIN" ? " · admin" : ""}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="quiet">
          Ghost AI uses the same test-review path as “Assign worker”: MOCK only, $0 charged, no
          live provider is called.
        </p>
      )}

      <label className="field">
        <span>Title</span>
        <input
          type="text"
          value={title}
          maxLength={200}
          placeholder={task?.title ?? "What should be done?"}
          onChange={(event) => edit(setTitle)(event.target.value)}
        />
      </label>

      <label className="field">
        <span>Instructions</span>
        <textarea
          rows={4}
          value={instructions}
          maxLength={8000}
          onChange={(event) => edit(setInstructions)(event.target.value)}
        />
      </label>

      {assignKind === "HUMAN" ? (
        <label className="field">
          <span>Due date (optional)</span>
          <input
            type="date"
            value={dueAt}
            onChange={(event) => edit(setDueAt)(event.target.value)}
          />
        </label>
      ) : null}

      {!previewed ? (
        <button
          type="button"
          className="button"
          disabled={!canPreview}
          onClick={() => setPreviewed(true)}
        >
          Preview assignment
        </button>
      ) : (
        <div className="today-assign-preview">
          <h3>{preview.heading}</h3>
          <ul>
            {preview.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {preview.chargeLabel ? <p className="notice">{preview.chargeLabel}</p> : null}
          <ActionForm
            action={action}
            submitLabel={assignKind === "AI" ? "Assign to Ghost AI" : "Assign to teammate"}
          >
            <input type="hidden" name="previewConfirmed" value="yes" />
            <input type="hidden" name="assignKind" value={assignKind} />
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="nextActionId" value={nextActionId} />
            <input type="hidden" name="assigneeUserId" value={assignKind === "HUMAN" ? assigneeUserId : ""} />
            <input type="hidden" name="title" value={effectiveTitle} />
            <input type="hidden" name="instructions" value={instructions} />
            <input type="hidden" name="dueAt" value={assignKind === "HUMAN" ? dueAt : ""} />
            <input
              type="hidden"
              name="mapScopeJson"
              value={mapScope ? JSON.stringify(mapScope) : ""}
            />
          </ActionForm>
          <button type="button" className="button-secondary" onClick={() => setPreviewed(false)}>
            Edit assignment
          </button>
        </div>
      )}
    </section>
  );
}
