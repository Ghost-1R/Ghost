import type { AssignmentKind, AssignmentStatus } from "@/lib/access/types";

/**
 * Aggregate-only map scope stored in work_assignments.map_scope.
 * Never carries addresses, customer keys, or order ids.
 */
export type MapScope = {
  states: string[];
  zips: string[];
  radius: { centerZip: string; miles: number } | null;
  dateFrom: string | null;
  dateTo: string | null;
};

export type AssignmentRow = {
  id: string;
  companyId: string;
  projectId: string;
  nextActionId: string | null;
  agentTaskId: string | null;
  kind: AssignmentKind;
  status: AssignmentStatus;
  title: string;
  instructions: string;
  dueAt: string | null;
  assigneeUserId: string | null;
  assignedBy: string;
  progressNote: string;
  submissionNote: string;
  submittedAt: string | null;
  reviewNote: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  handedOffFromAssignmentId: string | null;
  mapScope: MapScope | null;
  createdAt: string;
  updatedAt: string;
  projectName?: string;
};

export type CreateHumanAssignmentInput = {
  projectId: string;
  companyId: string;
  nextActionId?: string | null;
  title: string;
  instructions: string;
  dueAt?: string | null;
  assigneeUserId: string;
  mapScope?: MapScope | null;
};

export type CreateAiAssignmentInput = {
  projectId: string;
  companyId: string;
  nextActionId?: string | null;
  title: string;
  instructions: string;
  mapScope?: MapScope | null;
};

export type AssignmentResult<T = { assignmentId: string }> =
  | ({ ok: true; notice: string } & T)
  | { ok: false; error: string };

export const ASSIGNMENT_COLUMNS =
  "id, company_id, project_id, next_action_id, agent_task_id, kind, status, title, instructions, due_at, assignee_user_id, assigned_by, progress_note, submission_note, submitted_at, review_note, reviewed_by, reviewed_at, handed_off_from_assignment_id, map_scope, created_at, updated_at";

type RawAssignment = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function sanitizeMapScope(raw: unknown): MapScope | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const states = Array.isArray(value.states)
    ? value.states
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim().toUpperCase())
        .filter((entry) => /^[A-Z]{2}$/.test(entry))
        .slice(0, 60)
    : [];
  const zips = Array.isArray(value.zips)
    ? value.zips
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => /^[0-9]{5}$/.test(entry))
        .slice(0, 200)
    : [];
  let radius: MapScope["radius"] = null;
  if (value.radius && typeof value.radius === "object") {
    const r = value.radius as Record<string, unknown>;
    const miles = typeof r.miles === "number" ? r.miles : Number(r.miles);
    const centerZip = typeof r.centerZip === "string" ? r.centerZip.trim() : "";
    if (/^[0-9]{5}$/.test(centerZip) && Number.isFinite(miles) && miles > 0 && miles <= 3000) {
      radius = { centerZip, miles: Math.round(miles * 10) / 10 };
    }
  }
  const date = (entry: unknown) =>
    typeof entry === "string" && /^\d{4}-\d{2}-\d{2}$/.test(entry.trim()) ? entry.trim() : null;
  const scope: MapScope = {
    states: [...new Set(states)],
    zips: [...new Set(zips)],
    radius,
    dateFrom: date(value.dateFrom),
    dateTo: date(value.dateTo),
  };
  const empty =
    scope.states.length === 0 && scope.zips.length === 0 && !scope.radius;
  return empty ? null : scope;
}

export function describeMapScope(scope: MapScope): string {
  const parts: string[] = [];
  if (scope.states.length > 0) parts.push(`States ${scope.states.join(", ")}`);
  if (scope.zips.length > 0) {
    parts.push(
      scope.zips.length > 6
        ? `${scope.zips.length} ZIP areas`
        : `ZIP ${scope.zips.join(", ")}`,
    );
  }
  if (scope.radius) parts.push(`${scope.radius.miles} mi around ${scope.radius.centerZip}`);
  if (scope.dateFrom || scope.dateTo) {
    parts.push(`${scope.dateFrom ?? "start"} → ${scope.dateTo ?? "today"}`);
  }
  return parts.join(" · ") || "Selected area";
}

export function mapAssignmentRow(row: RawAssignment): AssignmentRow {
  const projects = row.projects as { name?: unknown } | { name?: unknown }[] | null | undefined;
  const projectName = Array.isArray(projects) ? projects[0]?.name : projects?.name;
  return {
    id: str(row.id),
    companyId: str(row.company_id),
    projectId: str(row.project_id),
    nextActionId: strOrNull(row.next_action_id),
    agentTaskId: strOrNull(row.agent_task_id),
    kind: row.kind === "AI" ? "AI" : "HUMAN",
    status: str(row.status) as AssignmentStatus,
    title: str(row.title),
    instructions: str(row.instructions),
    dueAt: strOrNull(row.due_at),
    assigneeUserId: strOrNull(row.assignee_user_id),
    assignedBy: str(row.assigned_by),
    progressNote: str(row.progress_note),
    submissionNote: str(row.submission_note),
    submittedAt: strOrNull(row.submitted_at),
    reviewNote: str(row.review_note),
    reviewedBy: strOrNull(row.reviewed_by),
    reviewedAt: strOrNull(row.reviewed_at),
    handedOffFromAssignmentId: strOrNull(row.handed_off_from_assignment_id),
    mapScope: sanitizeMapScope(row.map_scope),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    projectName: typeof projectName === "string" ? projectName : undefined,
  };
}

export const ASSIGNMENT_STATUS_LABEL: Record<AssignmentStatus, string> = {
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted for review",
  IN_REVIEW: "In review",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};
