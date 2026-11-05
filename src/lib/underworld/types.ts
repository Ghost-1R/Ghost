export type UnderworldGoalStatus = "DRAFT" | "ACTIVE" | "COMPLETED" | "CANCELLED";
export type UnderworldPlanStatus = "DRAFT" | "PREVIEWED" | "ACTIVE" | "COMPLETED" | "CANCELLED";
export type UnderworldStepRole = "PLANNER" | "EXECUTOR" | "REVIEWER";
export type UnderworldAssigneeKind = "HUMAN" | "AI";
export type UnderworldStepStatus =
  | "PENDING"
  | "READY"
  | "CLAIMED"
  | "RUNNING"
  | "CHECKPOINT"
  | "WAITING_REVIEW"
  | "WAITING_FOUNDER"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "BLOCKED";

export type DataClassification = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";

export type UnderworldGoal = {
  id: string;
  companyId: string;
  projectId: string;
  ownerId: string;
  title: string;
  objective: string;
  classification: DataClassification;
  budgetCents: number;
  stopCondition: string;
  status: UnderworldGoalStatus;
};

export type UnderworldPlan = {
  id: string;
  goalId: string;
  version: number;
  status: UnderworldPlanStatus;
  scopeSummary: string;
  scopeFingerprint: string;
  previewedAt: string | null;
};

export type UnderworldStep = {
  id: string;
  planId: string;
  seq: number;
  title: string;
  role: UnderworldStepRole;
  assigneeKind: UnderworldAssigneeKind;
  dependsOn: string[];
  assignmentId: string | null;
  agentTaskId: string | null;
  status: UnderworldStepStatus;
  stopCondition: string;
  attemptCount: number;
  maxAttempts: number;
};

export type ProposedStep = {
  seq: number;
  title: string;
  role: UnderworldStepRole;
  assigneeKind: UnderworldAssigneeKind;
  stopCondition: string;
};
