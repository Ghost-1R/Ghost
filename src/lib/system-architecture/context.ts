import type { ContextItem } from "@/lib/ghost-context/types";
import { answerSystemTruthQuestion } from "./truth";
import type { SystemArchitectureBundle } from "./types";
import { buildCoverageMatrix, evaluateSystemBundle, summarizeCoverage } from "./workflow";

export function collectSystemArchitectureItems(input: { question: string; bundle: SystemArchitectureBundle }): ContextItem[] {
  const { bundle } = input;
  const architecture = bundle.architecture;
  const { readiness, defects } = evaluateSystemBundle(bundle);
  const matrix = buildCoverageMatrix({
    requirements: bundle.requirements,
    coverage: bundle.coverage,
    components: bundle.components,
    interfaces: bundle.interfaces,
  });
  const coverage = summarizeCoverage(matrix);
  const approved = architecture.status === "APPROVED" || architecture.status === "ARCHITECTURE_READY";

  const items: ContextItem[] = [
    {
      id: `system-arch-${architecture.id}`,
      type: "system_architecture",
      authority: approved ? "PROJECT_STATE" : "PROJECT_NOTE",
      sourceTable: "system_architectures",
      sourceId: architecture.id,
      projectId: architecture.projectId,
      title: `System Architecture (${architecture.status})`,
      content: [
        `Status: ${architecture.status}`,
        `Summary: ${architecture.summary || "unknown"}`,
        architecture.authSummary ? `Authentication: ${architecture.authSummary}` : "Authentication: not recorded",
        architecture.authorizationSummary ? `Authorization: ${architecture.authorizationSummary}` : "Authorization: not recorded",
        architecture.runtimeTopology.length ? `Topology: ${architecture.runtimeTopology.join("; ")}` : null,
        `Product architecture status: ${bundle.productStatus ?? "missing"}`,
        `Components: ${bundle.components.length}; entities: ${bundle.entities.length}; interfaces: ${bundle.interfaces.length}; integrations: ${bundle.integrations.length}`,
        `Coverage: ${coverage.COVERED} covered, ${coverage.PARTIALLY_COVERED} partial, ${coverage.NOT_COVERED} not covered`,
        `Architecture ready: ${readiness.architectureReady ? "YES" : "NO"}`,
        `Schema defects: ${defects.length}`,
        ...readiness.reasons.slice(0, 6).map((reason) => `Readiness note: ${reason}`),
        "Architecture is design only. It is not implementation, a deployed database, a live API, or a deployed product.",
        "Proposed records are not approved. Past Ghost answers are not evidence. Secret values are never stored, only names.",
      ]
        .filter(Boolean)
        .join("\n"),
      status: architecture.status,
      relevance: 1,
      keep: true,
      selectedBecause: "system architecture workspace",
    },
  ];

  const truth = answerSystemTruthQuestion(input.question, {
    architecture,
    readinessReasons: readiness.reasons,
    entities: bundle.entities,
  });
  if (truth) {
    items.push({
      id: `system-truth-${architecture.id}`,
      type: "truth_boundary",
      authority: "SYSTEM",
      sourceTable: "system_architectures",
      sourceId: architecture.id,
      projectId: architecture.projectId,
      title: "System Architecture truth answer",
      content: `${truth.answer}: ${truth.reason} [${truth.kind}]`,
      status: truth.answer,
      relevance: 1,
      keep: true,
      selectedBecause: "truth boundary",
    });
  }

  const q = input.question.toLowerCase();
  const wantComponents = /component|service|runtime|topology|worker/.test(q);
  const wantDatabase = /database|schema|entity|table|rls|field|relationship|data model/.test(q);
  const wantInterfaces = /api|interface|endpoint|contract/.test(q);
  const wantIntegrations = /integration|provider|secret|env|config|stripe|email/.test(q);
  const wantRisks = /risk|constraint|danger/.test(q);
  const wantQuestions = /question|decision|unresolved|block/.test(q);
  const wantCoverage = /coverage|requirement|traceab|covered/.test(q);

  for (const component of bundle.components.slice(0, wantComponents ? 12 : 4)) {
    items.push({
      id: `system-comp-${component.id}`,
      type: "system_component",
      authority: component.status === "APPROVED" ? "PROJECT_STATE" : "PROJECT_NOTE",
      sourceTable: "system_components",
      sourceId: component.id,
      projectId: component.projectId,
      title: `${component.humanId}: ${component.name}`,
      content: [
        `Status: ${component.status}`,
        `Type: ${component.componentType}`,
        component.purpose,
        component.responsibilities.length ? `Responsibilities: ${component.responsibilities.join("; ")}` : null,
        `Provenance: ${component.provenance}`,
      ]
        .filter(Boolean)
        .join("\n"),
      status: component.status,
      relevance: wantComponents ? 0.95 : 0.55,
      keep: component.status === "APPROVED" || wantComponents,
      selectedBecause: "system component",
    });
  }

  for (const entity of bundle.entities.slice(0, wantDatabase ? 12 : 3)) {
    const fields = bundle.fields.filter((field) => field.entityId === entity.id);
    items.push({
      id: `system-ent-${entity.id}`,
      type: "system_entity",
      authority: entity.status === "APPROVED" ? "PROJECT_STATE" : "PROJECT_NOTE",
      sourceTable: "system_entities",
      sourceId: entity.id,
      projectId: entity.projectId,
      title: `${entity.humanId}: ${entity.name}`,
      content: [
        `Status: ${entity.status} (designed table, not deployed)`,
        entity.purpose,
        `Fields: ${fields.map((field) => `${field.name}${field.isPk ? " (pk)" : ""}`).join(", ") || "none"}`,
        entity.ownershipField ? `Ownership field: ${entity.ownershipField}` : "Ownership field: none",
        entity.rlsExpectation ? `RLS expectation (planned, not implemented): ${entity.rlsExpectation}` : "RLS expectation: none",
        `Sensitive class: ${entity.sensitiveClass}`,
      ].join("\n"),
      status: entity.status,
      relevance: wantDatabase ? 0.95 : 0.5,
      keep: entity.status === "APPROVED" || wantDatabase,
      selectedBecause: "system entity",
    });
  }

  for (const iface of bundle.interfaces.slice(0, wantInterfaces ? 12 : 3)) {
    items.push({
      id: `system-api-${iface.id}`,
      type: "system_interface",
      authority: iface.status === "APPROVED" ? "PROJECT_STATE" : "PROJECT_NOTE",
      sourceTable: "system_interfaces",
      sourceId: iface.id,
      projectId: iface.projectId,
      title: `${iface.humanId}: ${iface.name}`,
      content: [
        `Status: ${iface.status} (designed interface, not live)`,
        `${iface.caller || "unknown"} → ${iface.receiver || "unknown"}: ${iface.operation || "unspecified"}`,
        `Auth required: ${iface.authRequired ? "yes" : "no"}`,
        iface.failureBehavior ? `Failure behavior: ${iface.failureBehavior}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      status: iface.status,
      relevance: wantInterfaces ? 0.95 : 0.5,
      keep: iface.status === "APPROVED" || wantInterfaces,
      selectedBecause: "system interface",
    });
  }

  if (wantIntegrations) {
    for (const integration of bundle.integrations.slice(0, 8)) {
      items.push({
        id: `system-intg-${integration.id}`,
        type: "system_integration",
        authority: integration.status === "APPROVED" ? "PROJECT_STATE" : "PROJECT_NOTE",
        sourceTable: "system_integrations",
        sourceId: integration.id,
        projectId: integration.projectId,
        title: `${integration.humanId}: ${integration.provider}`,
        content: [
          `Status: ${integration.status}`,
          integration.purpose,
          `Secret names (never values): ${integration.secretNames.join(", ") || "none"}`,
          integration.failureImpact ? `Failure impact: ${integration.failureImpact}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
        status: integration.status,
        relevance: 0.85,
        keep: true,
        selectedBecause: "system integration",
      });
    }
  }

  if (wantRisks) {
    for (const risk of bundle.risks.slice(0, 8)) {
      items.push({
        id: `system-risk-${risk.id}`,
        type: "system_risk",
        authority: "PROJECT_NOTE",
        sourceTable: "system_technical_risks",
        sourceId: risk.id,
        projectId: risk.projectId,
        title: `${risk.humanId} (${risk.severity})`,
        content: `${risk.description}\nMitigation: ${risk.mitigation || "none recorded"}\nStatus: ${risk.status}`,
        status: risk.status,
        relevance: 0.85,
        keep: true,
        selectedBecause: "system risk",
      });
    }
  }

  if (wantCoverage) {
    for (const row of matrix.filter((entry) => entry.coverage === "NOT_COVERED").slice(0, 8)) {
      items.push({
        id: `system-cov-${row.requirementId}`,
        type: "system_coverage",
        authority: "PROJECT_NOTE",
        sourceTable: "system_requirement_coverage",
        sourceId: row.requirementId,
        projectId: architecture.projectId,
        title: `Uncovered: ${row.humanId} ${row.title}`,
        content: `Priority ${row.priority}. Not covered by the system design. ${row.gapNote}`.trim(),
        status: row.coverage,
        relevance: 0.85,
        keep: true,
        selectedBecause: "uncovered requirement",
      });
    }
  }

  for (const question of bundle.questions.filter((row) => row.status === "OPEN" || row.status === "ESCALATED").slice(0, wantQuestions ? 8 : 3)) {
    items.push({
      id: `system-q-${question.id}`,
      type: "system_question",
      authority: "PROJECT_NOTE",
      sourceTable: "system_questions",
      sourceId: question.id,
      projectId: question.projectId,
      title: `Unresolved: ${question.question}`,
      content: `Status: ${question.status}. ${question.decisionId ? `Linked decision ${question.decisionId}` : "Not escalated."}`,
      status: question.status,
      relevance: wantQuestions ? 0.9 : 0.5,
      keep: true,
      selectedBecause: "unresolved system question",
    });
  }

  return items;
}
