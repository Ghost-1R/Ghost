import type { ContextItem } from "@/lib/ghost-context/types";
import { answerDeploymentTruthQuestion } from "./truth";
import type { ReleaseBundle } from "./types";
import { evaluateReleaseBundle } from "./workflow";

export function collectReleaseItems(input: { question: string; bundle: ReleaseBundle }): ContextItem[] {
  const { bundle } = input;
  const release = bundle.release;
  const { readiness, production, latestDeployment } = evaluateReleaseBundle(bundle);
  const productionVerified = release.status === "PRODUCTION_VERIFIED";
  const environment = bundle.environments.find((row) => row.id === release.environmentId) ?? null;

  const items: ContextItem[] = [
    {
      id: `release-${release.id}`,
      type: "release",
      authority: productionVerified ? "PROJECT_STATE" : "PROJECT_NOTE",
      sourceTable: "releases",
      sourceId: release.id,
      projectId: release.projectId,
      title: `Release ${release.humanId} (${release.status})`,
      content: [
        `Status: ${release.status}`,
        `Verification status: ${bundle.verificationStatus ?? "missing"}`,
        `Source commit: ${release.sourceCommitSha || "unknown"}`,
        release.sourceBranch ? `Branch: ${release.sourceBranch}` : null,
        `Environment: ${environment ? `${environment.name} (${environment.environmentType}, ${environment.provider || "provider unknown"})` : "none selected"}`,
        `Deployment attempts: ${bundle.deployments.length}`,
        latestDeployment ? `Latest deployment: ${latestDeployment.humanId} ${latestDeployment.status}` : null,
        `Deployment readiness: ${readiness.ready ? "YES" : "NO"}`,
        `Production verification: ${production.productionVerified ? "YES" : "NO"}`,
        `Open decisions: ${bundle.openDecisionCount}`,
        ...(release.status === "DRAFT" || release.status === "DEPLOYMENT_READY"
          ? readiness.gaps.slice(0, 6).map((gap) => `Readiness gap: ${gap.message}`)
          : production.gaps.slice(0, 6).map((gap) => `Production gap: ${gap.message}`)),
        ...production.warnings.map((warning) => `Warning: ${warning}`),
        "VERIFIED is not deployed. DEPLOYED is not PRODUCTION_VERIFIED. Configuration is recorded as presence only; secret values are never stored.",
        "Past Ghost answers are not evidence.",
      ]
        .filter(Boolean)
        .join("\n"),
      status: release.status,
      relevance: 1,
      keep: true,
      selectedBecause: "deployment workspace",
    },
  ];

  const truth = answerDeploymentTruthQuestion(input.question, {
    release,
    verificationStatus: bundle.verificationStatus,
    deployments: bundle.deployments,
    migrations: bundle.migrations,
    healthChecks: bundle.healthChecks,
    rollbacks: bundle.rollbacks,
    readinessGaps: readiness.gaps.map((gap) => gap.message),
    productionGaps: production.gaps.map((gap) => gap.message),
  });
  if (truth) {
    items.push({
      id: `release-truth-${release.id}`,
      type: "truth_boundary",
      authority: "SYSTEM",
      sourceTable: "releases",
      sourceId: release.id,
      projectId: release.projectId,
      title: "Deployment truth answer",
      content: `${truth.answer}: ${truth.reason} [${truth.kind}]`,
      status: truth.answer,
      relevance: 1,
      keep: true,
      selectedBecause: "truth boundary",
    });
  }

  const q = input.question.toLowerCase();
  const wantDeployments = /deploy|live|release|attempt|sha|commit|version/.test(q);
  const wantConfig = /config|env|variable|secret|key/.test(q);
  const wantMigrations = /migrat|schema|database/.test(q);
  const wantHealth = /health|production|prod|inspector|presentation/.test(q);
  const wantRollback = /roll ?back|revert/.test(q);
  const wantEvidence = /evidence|prove|proof/.test(q);

  for (const row of bundle.deployments.slice(0, wantDeployments ? 5 : 2)) {
    items.push({
      id: `deployment-${row.id}`,
      type: "deployment",
      authority: "PROJECT_NOTE",
      sourceTable: "deployments",
      sourceId: row.id,
      projectId: row.projectId,
      title: `${row.humanId}: ${row.status}`,
      content: [
        `Status: ${row.status}`,
        `Expected SHA: ${row.expectedCommitSha || "unknown"}`,
        `Live SHA: ${row.liveCommitSha || "not recorded"}`,
        row.inspectorResult ? `Inspector: ${row.inspectorResult}` : null,
        row.presentationResult ? `Presentation: ${row.presentationResult}` : null,
        row.failureReason ? `Failure: ${row.failureReason}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      status: row.status,
      relevance: wantDeployments ? 0.95 : 0.55,
      keep: wantDeployments || row.status === "IN_PROGRESS" || row.status === "FAILED",
      selectedBecause: "deployment attempt",
    });
  }

  if (wantConfig) {
    for (const row of bundle.configRequirements.slice(0, 12)) {
      items.push({
        id: `release-config-${row.id}`,
        type: "release_config",
        authority: "PROJECT_NOTE",
        sourceTable: "release_config_requirements",
        sourceId: row.id,
        projectId: row.projectId,
        title: `${row.variableName}: ${row.presence}`,
        content: `${row.isRequired ? "Required" : "Optional"} ${row.isSecret ? "secret" : "non-secret"} configuration. Presence only; the value is never stored.`,
        status: row.presence,
        relevance: 0.9,
        keep: true,
        selectedBecause: "configuration presence",
      });
    }
  }

  if (wantMigrations) {
    for (const row of bundle.migrations.slice(0, 12)) {
      items.push({
        id: `release-migration-${row.id}`,
        type: "release_migration",
        authority: "PROJECT_NOTE",
        sourceTable: "release_migrations",
        sourceId: row.id,
        projectId: row.projectId,
        title: `${row.migrationPath}: ${row.status}`,
        content: `${row.isRequired ? "Required" : "Optional"} migration. Committed is not applied; status is ${row.status}.`,
        status: row.status,
        relevance: 0.9,
        keep: true,
        selectedBecause: "release migration",
      });
    }
  }

  if (wantHealth) {
    for (const row of bundle.healthChecks.slice(0, 8)) {
      items.push({
        id: `release-health-${row.id}`,
        type: "deployment_health",
        authority: "PROJECT_NOTE",
        sourceTable: "deployment_health_checks",
        sourceId: row.id,
        projectId: row.projectId,
        title: `${row.checkName}: ${row.status}`,
        content: [row.expectedValue ? `Expected: ${row.expectedValue}` : null, row.observedValue ? `Observed: ${row.observedValue}` : null]
          .filter(Boolean)
          .join("\n") || "Health check record.",
        status: row.status,
        relevance: 0.85,
        keep: true,
        selectedBecause: "deployment health",
      });
    }
  }

  if (wantRollback) {
    for (const row of bundle.rollbacks.slice(0, 5)) {
      items.push({
        id: `release-rollback-${row.id}`,
        type: "release_rollback",
        authority: "PROJECT_NOTE",
        sourceTable: "release_rollbacks",
        sourceId: row.id,
        projectId: row.projectId,
        title: `Rollback ${row.status}`,
        content: [row.targetCommitSha ? `Target: ${row.targetCommitSha}` : null, row.reason || null].filter(Boolean).join("\n") || "Rollback record.",
        status: row.status,
        relevance: 0.9,
        keep: true,
        selectedBecause: "rollback record",
      });
    }
  }

  if (wantEvidence) {
    for (const row of bundle.evidence.slice(0, 8)) {
      items.push({
        id: `deployment-evidence-${row.id}`,
        type: "deployment_evidence",
        authority: "PROJECT_NOTE",
        sourceTable: "deployment_evidence",
        sourceId: row.id,
        projectId: row.projectId,
        title: `${row.kind}: ${row.reference.slice(0, 80)}`,
        content: row.summary || "Deployment evidence reference (not a secret value).",
        status: row.kind,
        relevance: 0.9,
        keep: true,
        selectedBecause: "deployment evidence",
      });
    }
  }

  return items;
}
