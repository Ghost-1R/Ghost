import { REDACTED, redactSecrets } from "../security/redact";
import { evidenceFreshness } from "./freshness";
import type {
  EvidenceCheckType,
  EvidenceRecord,
  PresentationResult,
  RequirementStatus,
  ReviewFinding,
  TraceRow,
} from "./types";

const MANDATORY_CHECKS: EvidenceCheckType[] = ["lint", "typecheck", "test", "build"];

const SEVERITY_RANK = { BLOCKER: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export type GateInput = {
  evidence: EvidenceRecord[];
  current: { commitSha: string; treeHash: string };
  environment: "local" | "production";
  findings: ReviewFinding[];
  traceability: TraceRow[];
  presentingProduction: boolean;
};

export type GateReport = {
  result: PresentationResult;
  fresh: string[];
  stale: string[];
  missing: string[];
  failed: string[];
  blocked: string[];
  gaps: string[];
  fixQueue: ReviewFinding[];
};

export function classifyRequirementScope(title: string, content: string): "current" | "future" {
  const heading = title.toLowerCase();
  const body = content.toLowerCase();
  if (heading.startsWith("future ") || body.includes("not part of this milestone")) {
    return "future";
  }
  return "current";
}

export function traceRequirement(input: {
  title: string;
  implementationEvidence?: string | null;
  verificationEvidence?: string | null;
  failed?: boolean;
  applicable?: boolean;
  scope?: "current" | "future";
  requiredNow?: boolean;
  observed?: boolean;
  blocked?: boolean;
}): TraceRow {
  const implementationEvidence = input.implementationEvidence ?? null;
  const verificationEvidence = input.verificationEvidence ?? null;
  if (input.scope === "future" && input.requiredNow) {
    return { requirement: input.title, implementationEvidence, verificationEvidence, status: "NOT_VERIFIED" };
  }
  if (input.scope === "future") {
    return { requirement: input.title, implementationEvidence: null, verificationEvidence: null, status: "FUTURE_SCOPE" };
  }
  if (input.applicable === false) {
    return { requirement: input.title, implementationEvidence, verificationEvidence, status: "NOT_APPLICABLE" };
  }
  if (input.blocked) {
    return { requirement: input.title, implementationEvidence, verificationEvidence, status: "BLOCKED" };
  }
  if (input.failed) {
    return { requirement: input.title, implementationEvidence, verificationEvidence, status: "FAIL" };
  }
  if (input.observed && !(implementationEvidence && verificationEvidence)) {
    return { requirement: input.title, implementationEvidence, verificationEvidence, status: "OBSERVED" };
  }
  if (implementationEvidence && verificationEvidence) {
    return { requirement: input.title, implementationEvidence, verificationEvidence, status: "PASS" };
  }
  if (implementationEvidence || verificationEvidence) {
    return { requirement: input.title, implementationEvidence, verificationEvidence, status: "OBSERVED" };
  }
  return { requirement: input.title, implementationEvidence, verificationEvidence, status: "NOT_VERIFIED" };
}

export function derivePresentation(input: GateInput): GateReport {
  const fresh: string[] = [];
  const stale: string[] = [];
  const missing: string[] = [];
  const failed: string[] = [];
  const blocked: string[] = [];
  const required = [...MANDATORY_CHECKS];
  if (input.presentingProduction || input.environment === "production") {
    required.push("prod_health");
  }
  required.push("security", "customer_flows", "responsive", "requirements");

  for (const checkType of required) {
    const matches = input.evidence.filter((row) => row.checkType === checkType);
    const latest = matches.at(-1);
    if (!latest) {
      missing.push(checkType);
      continue;
    }
    if (evidenceFreshness(latest, input.current) === "stale") {
      stale.push(checkType);
      continue;
    }
    if (latest.status === "passed") {
      fresh.push(checkType);
    } else if (latest.status === "failed") {
      failed.push(checkType);
    } else if (latest.status === "blocked") {
      blocked.push(checkType);
    } else {
      missing.push(checkType);
    }
  }

  const unresolved = input.findings.filter((finding) => finding.severity === "BLOCKER" || finding.severity === "HIGH");
  const low = input.findings.filter((finding) => finding.severity === "LOW" || finding.severity === "MEDIUM");
  const failedRequirements = input.traceability.filter((row) => row.status === "FAIL");
  const unverifiedRequirements = input.traceability.filter((row) => row.status === "NOT_VERIFIED" || row.status === "OBSERVED" || row.status === "BLOCKED");
  const futureRequirements = input.traceability.filter((row) => row.status === "FUTURE_SCOPE");
  const gaps = [
    ...futureRequirements.map((row) => `Future scope: ${row.requirement}`),
    ...stale.map((check) => `${check} evidence is stale`),
    ...missing.map((check) => `${check} evidence is missing`),
    ...failed.map((check) => `${check} failed`),
    ...blocked.map((check) => `${check} is blocked`),
    ...failedRequirements.map((row) => `Requirement failed: ${row.requirement}`),
    ...unverifiedRequirements.map((row) => `Requirement not verified: ${row.requirement}`),
    ...unresolved.map((finding) => `${finding.severity}: ${finding.description}`),
    ...low.map((finding) => `${finding.severity}: ${finding.description}`),
  ];
  const critical =
    stale.length > 0 ||
    missing.length > 0 ||
    failed.length > 0 ||
    blocked.length > 0 ||
    unresolved.length > 0 ||
    failedRequirements.length > 0 ||
    unverifiedRequirements.length > 0;
  const result: PresentationResult = critical ? "NOT_READY" : low.length > 0 ? "READY_WITH_GAPS" : "READY";
  return {
    result,
    fresh,
    stale,
    missing,
    failed,
    blocked,
    gaps,
    fixQueue: [...unresolved, ...low].sort((left, right) => SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]),
  };
}

export function customerHandoff(input: {
  result: PresentationResult;
  current: boolean;
  built: string[];
  completedRequirements: string[];
  flows: string[];
  responsive: string[];
  deployment: string | null;
  limitations: string[];
  demo: string[];
}): string | null {
  if (input.result !== "READY" || !input.current) {
    return null;
  }
  const lines = [
    "What was built",
    ...input.built,
    "Requirements completed",
    ...input.completedRequirements,
    "Flows verified",
    ...input.flows,
    "Responsive coverage",
    ...input.responsive,
    `Deployment: ${input.deployment ?? "not a production presentation"}`,
    "Limitations",
    ...input.limitations,
    "Demo",
    ...input.demo,
  ];
  return redactSecrets(lines.join("\n")).replace(/password\s*[:=]\s*\S+/gi, REDACTED);
}

export function requirementBlocksReady(status: RequirementStatus): boolean {
  return status === "FAIL" || status === "NOT_VERIFIED" || status === "OBSERVED" || status === "BLOCKED";
}
