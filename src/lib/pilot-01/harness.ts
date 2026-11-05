/**
 * Pilot 01 end-to-end harness — wires existing Ghost contracts without a parallel agent.
 * Preparation-only: does not activate workers, live providers, or hosted SQL.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getIsolatedPilotGate, PILOT_DEFAULT_LIMITS } from "@/lib/agent-runtime/pilot-config";
import { runIsolatedPilot, summarizePilotReport, type PilotRunReport } from "@/lib/agent-runtime/pilot-executor";
import { createCodeWorkspaceContract } from "@/lib/agent-runtime/workspace";
import { developmentApprovalGrantsDeployment } from "@/lib/agent-runtime/authorization-kind";
import { assertExecutionAuthorized } from "@/lib/approvals/execution-gate";
import type { FounderActionAuthorization } from "@/lib/approvals/types";
import { scopeFingerprint } from "@/lib/approvals/workflow";
import {
  PILOT_01_ACTION_TYPE,
  PILOT_01_AUTHORIZATION_KIND,
  PILOT_01_ENVIRONMENT,
  PILOT_01_ID,
  PILOT_01_OBJECTIVE,
  PILOT_01_PERMITTED_FILES,
  PILOT_01_PROHIBITIONS,
  PILOT_01_RESOURCE_LIMITS,
  PILOT_01_REVIEW_CRITERIA,
  buildPilot01ActionScope,
} from "./task-spec";

export type Pilot01SourceCheck = {
  path: string;
  present: boolean;
  bytes: number;
};

export type Pilot01StaticReview = {
  criterionId: string;
  pass: boolean;
  detail: string;
};

export type Pilot01HarnessReport = {
  pilotId: typeof PILOT_01_ID;
  objective: typeof PILOT_01_OBJECTIVE;
  preparedAt: string;
  authorizationContract: {
    actionType: typeof PILOT_01_ACTION_TYPE;
    authorizationKind: typeof PILOT_01_AUTHORIZATION_KIND;
    environmentLabel: typeof PILOT_01_ENVIRONMENT;
    actionScope: string;
    scopeFingerprint: string;
    deploymentGrantedByDevelopmentApproval: boolean;
    reusePolicy: "ONE_TIME";
    requiredStatusesForBind: ["APPROVED", "CONSUMED"];
    rejectedStatusesForBind: ["REVOKED", "REJECTED", "EXPIRED", "PENDING"];
  };
  sourceChecks: Pilot01SourceCheck[];
  staticReview: Pilot01StaticReview[];
  workspace: {
    ok: boolean;
    root: string | null;
    detail: string;
  };
  dockerPilot: {
    gateEnabled: boolean;
    gateReason: string | null;
    report: PilotRunReport | null;
    summary: ReturnType<typeof summarizePilotReport> | null;
    attribution: "GHOST_ISOLATED_PILOT" | "NOT_RUN";
  };
  executionAttribution: {
    ghostDurableWorkflow: "PREPARED_NOT_DISPATCHED";
    ghostIsolatedDockerPilot: "RUN" | "NOT_RUN";
    cursorCloudOrDesktopPreparation: "SOURCE_AND_HARNESS";
  };
  prohibitions: typeof PILOT_01_PROHIBITIONS;
  resourceLimits: typeof PILOT_01_RESOURCE_LIMITS;
  evidenceSha256: string;
  overall: "READY" | "BLOCKED" | "PARTIAL";
  blockers: string[];
};

function repoRootFrom(cwd = process.cwd()): string {
  return cwd;
}

export function inspectPilot01Sources(root = repoRootFrom()): Pilot01SourceCheck[] {
  return PILOT_01_PERMITTED_FILES.map((rel) => {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) return { path: rel, present: false, bytes: 0 };
    return { path: rel, present: true, bytes: readFileSync(abs).byteLength };
  });
}

export function reviewPilot01Sample(root = repoRootFrom()): Pilot01StaticReview[] {
  const htmlPath = path.join(root, PILOT_01_PERMITTED_FILES[0]);
  const cssPath = path.join(root, PILOT_01_PERMITTED_FILES[1]);
  const jsPath = path.join(root, PILOT_01_PERMITTED_FILES[2]);
  const html = existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "";
  const css = existsSync(cssPath) ? readFileSync(cssPath, "utf8") : "";
  const js = existsSync(jsPath) ? readFileSync(jsPath, "utf8") : "";

  const vehicleCards = (html.match(/<article class="vehicle">/g) ?? []).length;
  const hasHero = /class="hero"/i.test(html) && /Northwind Drive/i.test(html);
  const hasForm =
    /id="inquiry-form"/i.test(html) &&
    /preventDefault/i.test(js) &&
    /aria-invalid/i.test(js) &&
    /isPickupNotPast/i.test(js);
  const noFetch = !/\bfetch\s*\(/.test(js) && !/\bXMLHttpRequest\b/.test(js) && !/mailto:/i.test(html);
  const responsive = /@media/i.test(css);
  const scoped = inspectPilot01Sources(root).every((row) => row.present);

  return PILOT_01_REVIEW_CRITERIA.map((criterion) => {
    switch (criterion.id) {
      case "hero":
        return { criterionId: criterion.id, pass: hasHero, detail: hasHero ? "hero present" : "hero missing" };
      case "vehicles":
        return {
          criterionId: criterion.id,
          pass: vehicleCards === 3,
          detail: `vehicle cards=${vehicleCards}`,
        };
      case "form":
        return {
          criterionId: criterion.id,
          pass: hasForm && noFetch,
          detail: hasForm && noFetch ? "local validation only" : "form/network issue",
        };
      case "scope":
        return { criterionId: criterion.id, pass: scoped, detail: scoped ? "permitted files present" : "missing files" };
      case "no_secrets":
        return {
          criterionId: criterion.id,
          pass: noFetch && !/sk-|api[_-]?key|password/i.test(`${html}${js}`),
          detail: "scanned sample sources",
        };
      case "auth_gates":
        return {
          criterionId: criterion.id,
          pass: !developmentApprovalGrantsDeployment(PILOT_01_ACTION_TYPE, "DEPLOYMENT"),
          detail: "DEVELOPMENT does not grant deployment",
        };
      case "independent_verify":
        return {
          criterionId: criterion.id,
          pass: true,
          detail: "founder MARK_VERIFIED still requires independent evidence (existing review.ts)",
        };
      default:
        return { criterionId: criterion.id, pass: false, detail: "unknown criterion" };
    }
  }).concat(
    responsive
      ? [{ criterionId: "responsive", pass: true, detail: "css media query present" }]
      : [{ criterionId: "responsive", pass: false, detail: "missing responsive css" }],
  );
}

export function buildPilot01AuthorizationPreview(input?: {
  ownerId?: string;
  projectId?: string;
}): {
  actionScope: string;
  fingerprint: string;
  gateDryRun: ReturnType<typeof assertExecutionAuthorized>;
} {
  const ownerId = input?.ownerId ?? "00000000-0000-4000-8000-000000000001";
  const projectId = input?.projectId ?? "00000000-0000-4000-8000-000000000002";
  const actionScope = buildPilot01ActionScope();
  const fingerprint = scopeFingerprint({
    projectId,
    environmentLabel: PILOT_01_ENVIRONMENT,
    actionType: PILOT_01_ACTION_TYPE,
    actionScope,
  });
  const view: FounderActionAuthorization = {
    id: "00000000-0000-4000-8000-000000000099",
    ownerId,
    projectId,
    projectName: "Pilot 01",
    environmentLabel: PILOT_01_ENVIRONMENT,
    decisionId: null,
    actionType: PILOT_01_ACTION_TYPE,
    actionScope,
    scopeFingerprint: fingerprint,
    reason: "Pilot 01 supervised coding preparation dry-run.",
    evidence: [{ source: "pilot-01", reference: PILOT_01_ID, at: new Date().toISOString() }],
    sideEffects: "none — preparation only",
    estimatedCost: "UNKNOWN",
    status: "APPROVED",
    effectiveStatus: "APPROVED",
    reusePolicy: "ONE_TIME",
    useCount: 0,
    maxUses: null,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    requestedAt: new Date().toISOString(),
    decidedAt: new Date().toISOString(),
    decidedBy: ownerId,
    revokedAt: null,
    revokedBy: null,
    revokeReason: "",
    consumedAt: null,
    idempotencyKey: `pilot-01-${PILOT_01_ID}`,
  };
  const gateDryRun = assertExecutionAuthorized(view, {
    authorizationId: view.id,
    ownerId: view.ownerId,
    projectId: view.projectId,
    actionType: PILOT_01_ACTION_TYPE,
    actionScope,
    environmentLabel: PILOT_01_ENVIRONMENT,
  });
  return { actionScope, fingerprint, gateDryRun };
}

/**
 * Prepare Pilot 01 review pack. Optional Docker run only when isolated pilot gate is enabled.
 */
export function preparePilot01Harness(input?: {
  root?: string;
  runDockerPilot?: boolean;
  workspaceRoot?: string;
}): Pilot01HarnessReport {
  const root = input?.root ?? repoRootFrom();
  const preparedAt = new Date().toISOString();
  const blockers: string[] = [];
  const authPreview = buildPilot01AuthorizationPreview();
  const sourceChecks = inspectPilot01Sources(root);
  const staticReview = reviewPilot01Sample(root);

  if (sourceChecks.some((row) => !row.present)) {
    blockers.push("Sample source files missing from permitted workspace.");
  }
  if (staticReview.some((row) => !row.pass)) {
    blockers.push("Static review criteria failed.");
  }
  if (!authPreview.gateDryRun.ok) {
    blockers.push("Authorization dry-run gate failed unexpectedly.");
  }

  let workspace: Pilot01HarnessReport["workspace"] = {
    ok: false,
    root: null,
    detail: "Workspace contract not materialized in preparation mode.",
  };
  if (input?.workspaceRoot) {
    const contract = createCodeWorkspaceContract({
      workspaceRoot: input.workspaceRoot,
      ownerId: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      taskId: PILOT_01_ID,
    });
    if (contract.ok) {
      workspace = {
        ok: true,
        root: contract.contract.hostPath,
        detail: "Isolated workspace contract created.",
      };
    } else {
      workspace = { ok: false, root: null, detail: contract.message };
      blockers.push(`Workspace contract failed: ${contract.message}`);
    }
  }

  const gate = getIsolatedPilotGate();
  let dockerReport: PilotRunReport | null = null;
  let dockerSummary: ReturnType<typeof summarizePilotReport> | null = null;
  let dockerAttribution: Pilot01HarnessReport["dockerPilot"]["attribution"] = "NOT_RUN";

  if (input?.runDockerPilot) {
    if (!gate.ok) {
      blockers.push(gate.reason);
    } else {
      dockerReport = runIsolatedPilot({
        workspaceRoot: input.workspaceRoot,
        ownerId: "00000000-0000-4000-8000-000000000001",
        projectId: "00000000-0000-4000-8000-000000000002",
        taskId: PILOT_01_ID,
      });
      dockerSummary = summarizePilotReport(dockerReport);
      dockerAttribution = dockerReport.realContainerExecution ? "GHOST_ISOLATED_PILOT" : "NOT_RUN";
      if (!dockerReport.realContainerExecution) {
        blockers.push("Docker pilot did not perform real container execution in this environment.");
      }
    }
  }

  const overall: Pilot01HarnessReport["overall"] =
    blockers.length === 0 ? "READY" : sourceChecks.every((r) => r.present) ? "PARTIAL" : "BLOCKED";

  const report: Pilot01HarnessReport = {
    pilotId: PILOT_01_ID,
    objective: PILOT_01_OBJECTIVE,
    preparedAt,
    authorizationContract: {
      actionType: PILOT_01_ACTION_TYPE,
      authorizationKind: PILOT_01_AUTHORIZATION_KIND,
      environmentLabel: PILOT_01_ENVIRONMENT,
      actionScope: authPreview.actionScope,
      scopeFingerprint: authPreview.fingerprint,
      deploymentGrantedByDevelopmentApproval: developmentApprovalGrantsDeployment(
        PILOT_01_ACTION_TYPE,
        "DEPLOYMENT",
      ),
      reusePolicy: "ONE_TIME",
      requiredStatusesForBind: ["APPROVED", "CONSUMED"],
      rejectedStatusesForBind: ["REVOKED", "REJECTED", "EXPIRED", "PENDING"],
    },
    sourceChecks,
    staticReview,
    workspace,
    dockerPilot: {
      gateEnabled: gate.ok,
      gateReason: gate.ok ? null : gate.reason,
      report: dockerReport,
      summary: dockerSummary,
      attribution: dockerAttribution,
    },
    executionAttribution: {
      ghostDurableWorkflow: "PREPARED_NOT_DISPATCHED",
      ghostIsolatedDockerPilot: dockerAttribution === "GHOST_ISOLATED_PILOT" ? "RUN" : "NOT_RUN",
      cursorCloudOrDesktopPreparation: "SOURCE_AND_HARNESS",
    },
    prohibitions: PILOT_01_PROHIBITIONS,
    resourceLimits: {
      ...PILOT_01_RESOURCE_LIMITS,
      // Keep aligned with existing pilot defaults when overlapping.
      memoryBytes: PILOT_DEFAULT_LIMITS.memoryBytes,
    },
    evidenceSha256: "",
    overall,
    blockers,
  };

  report.evidenceSha256 = createHash("sha256").update(JSON.stringify(report)).digest("hex");
  return report;
}

export function writePilot01Evidence(
  report: Pilot01HarnessReport,
  writeDir: string,
): string {
  mkdirSync(writeDir, { recursive: true });
  const out = path.join(writeDir, `pilot-01-harness-${report.evidenceSha256.slice(0, 12)}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2));
  return out;
}
