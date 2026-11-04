/**
 * Pilot 03 code-generation task contract for durable remote-dev requests.
 * Encodes provider/model into the immutable authorization scope fingerprint.
 * Never enables live dispatch.
 */

import { centsToUsdDisplay } from "@/lib/allowance";
import {
  CODING_PROVIDER_CONFIGS,
  isCodegenLiveEnabled,
  LIVE_CODING_MODEL_ALLOWLIST,
} from "./provider-config";
import { PILOT_03_ALLOWED_FILES, PILOT_03_OBJECTIVE } from "./pilot03-constants";
import type { CodingProviderId, DataClassification } from "./types";
import { estimateTrialCostCents } from "./live-adapters";

export type CodegenDispatchMode = "DISABLED" | "MOCK_ONLY" | "LIVE";

const DISPATCH_MODES = new Set<CodegenDispatchMode>(["DISABLED", "MOCK_ONLY", "LIVE"]);

export function parseDispatchMode(value: string | undefined): CodegenDispatchMode | null {
  if (!value) return null;
  return DISPATCH_MODES.has(value as CodegenDispatchMode) ? (value as CodegenDispatchMode) : null;
}

export type VerifiedCodingOption = {
  value: string;
  providerId: CodingProviderId;
  model: string;
  label: string;
  runnableNow: boolean;
  liveReady: boolean;
  paid: boolean;
  note: string;
};

export type CodegenTaskContract = {
  kind: "CODEGEN_PILOT_03";
  providerId: CodingProviderId;
  model: string;
  classification: DataClassification;
  dispatch: CodegenDispatchMode;
  estimatedCostCents: number;
  maxSpendCents: number;
  objective: string;
  allowedFiles: readonly string[];
  liveFlagEnabled: boolean;
};

const OPTION_SEP = "|";

/** Verified UI options: mock (runnable) + allowlisted prepared live models (not callable). */
export function listVerifiedCodingOptions(
  env: Record<string, string | undefined> = process.env,
): VerifiedCodingOption[] {
  const liveFlag = isCodegenLiveEnabled(env);
  const options: VerifiedCodingOption[] = [
    {
      value: "mock:mock-codegen-v1",
      providerId: "mock",
      model: "mock-codegen-v1",
      label: "Mock — mock-codegen-v1 (deterministic, $0)",
      runnableNow: true,
      liveReady: false,
      paid: false,
      note: "MOCK_GENERATION only. No external API. Safe for prep.",
    },
  ];

  for (const row of LIVE_CODING_MODEL_ALLOWLIST) {
    const config = CODING_PROVIDER_CONFIGS[row.providerId];
    if (!config?.enabled) continue;
    options.push({
      value: `${row.providerId}:${row.model}`,
      providerId: row.providerId,
      model: row.model,
      label: `${config.label} — ${row.model} (prepared, live HTTP off)`,
      runnableNow: false,
      liveReady: false,
      paid: config.paid,
      note: liveFlag
        ? "Live flag is on — Remote Dev still refuses live dispatch until founder-gated $1 trial entrypoint."
        : "Live coding disabled (GHOST_CODEGEN_LIVE_ENABLED≠1). Selection binds intent only.",
    });
  }

  return options;
}

export function parseCodingOptionValue(
  value: string,
): { ok: true; providerId: CodingProviderId; model: string } | { ok: false; reason: string; message: string } {
  const trimmed = value.trim();
  const colon = trimmed.indexOf(":");
  if (colon <= 0) {
    return { ok: false, reason: "INVALID_OPTION", message: "Provider/model selection is required." };
  }
  const providerId = trimmed.slice(0, colon) as CodingProviderId;
  const model = trimmed.slice(colon + 1).trim();
  const allowed = listVerifiedCodingOptions().some(
    (o) => o.providerId === providerId && o.model === model,
  );
  if (!allowed) {
    return {
      ok: false,
      reason: "OPTION_NOT_VERIFIED",
      message: "Selected provider/model is not a verified configured option.",
    };
  }
  return { ok: true, providerId, model };
}

/** Display estimate for Pilot 03 ≤$1 trial ceiling (informational; mock actual = $0). */
export function estimatePilot03DisplayCostCents(providerId: CodingProviderId): {
  estimatedCents: number;
  maxSpendCents: number;
  attribution: "MOCK_ESTIMATE" | "LIVE_RATE_ESTIMATE";
  detail: string;
} {
  if (providerId === "mock") {
    return {
      estimatedCents: 0,
      maxSpendCents: 100,
      attribution: "MOCK_ESTIMATE",
      detail: "Mock generation cost $0.00. Proposed live trial ceiling remains $1.00.",
    };
  }
  // Published-rate style estimate for gpt-5-mini class — display only, not a charge.
  const cents = estimateTrialCostCents({
    inputTokens: 2_000,
    outputTokens: 4_000,
    inputPerMillionUsd: 0.25,
    outputPerMillionUsd: 2.0,
  });
  return {
    estimatedCents: Math.min(cents, 100),
    maxSpendCents: 100,
    attribution: "LIVE_RATE_ESTIMATE",
    detail: `Estimated ~${centsToUsdDisplay(Math.min(cents, 100))} for a small PUBLIC task; hard ceiling ${centsToUsdDisplay(100)}. Not charged until live trial is authorized and implemented.`,
  };
}

export function buildCodegenTaskContract(input: {
  providerId: CodingProviderId;
  model: string;
  classification?: DataClassification;
  objective?: string;
  maxSpendUsd?: number;
  dispatch?: CodegenDispatchMode;
  env?: Record<string, string | undefined>;
}):
  | { ok: true; contract: CodegenTaskContract }
  | { ok: false; reason: string; message: string } {
  const parsed = parseCodingOptionValue(`${input.providerId}:${input.model}`);
  if (!parsed.ok) return parsed;

  const classification = input.classification ?? "PUBLIC";
  if (classification !== "PUBLIC" && input.providerId !== "mock") {
    return {
      ok: false,
      reason: "CLASSIFICATION_RESTRICTED",
      message: "Non-PUBLIC classification is not authorized for prepared live coding providers.",
    };
  }

  const costs = estimatePilot03DisplayCostCents(input.providerId);
  const maxSpendCents = Math.round((input.maxSpendUsd ?? costs.maxSpendCents / 100) * 100);
  if (!Number.isFinite(maxSpendCents) || maxSpendCents < 0 || maxSpendCents > 100) {
    return {
      ok: false,
      reason: "INVALID_MAX_SPEND",
      message: "Pilot 03 max spend ceiling must be between $0.00 and $1.00 until a larger trial is authorized.",
    };
  }

  const liveFlag = isCodegenLiveEnabled(input.env);
  // LIVE is never implied by the environment flag — founder scope must name it.
  const dispatch: CodegenDispatchMode =
    input.dispatch ?? (input.providerId === "mock" ? "MOCK_ONLY" : "DISABLED");
  if (dispatch === "LIVE" && input.providerId === "mock") {
    return {
      ok: false,
      reason: "DISPATCH_MISMATCH",
      message: "Mock provider cannot carry LIVE dispatch.",
    };
  }

  return {
    ok: true,
    contract: {
      kind: "CODEGEN_PILOT_03",
      providerId: input.providerId,
      model: input.model,
      classification,
      dispatch,
      estimatedCostCents: costs.estimatedCents,
      maxSpendCents,
      objective: (input.objective?.trim() || PILOT_03_OBJECTIVE).slice(0, 4000),
      allowedFiles: PILOT_03_ALLOWED_FILES,
      liveFlagEnabled: liveFlag,
    },
  };
}

/** Compact scope fragment included in founder authorization action_scope (fingerprint-bound). */
export function encodeCodegenScopeFragment(contract: CodegenTaskContract): string {
  return [
    "codegen=pilot03",
    `provider=${contract.providerId}`,
    `model=${contract.model}`,
    `class=${contract.classification}`,
    `dispatch=${contract.dispatch}`,
    `estCents=${contract.estimatedCostCents}`,
    `maxCents=${contract.maxSpendCents}`,
    "deploy=false",
  ].join(";");
}

export function parseCodegenScopeFragment(
  actionScope: string,
): CodegenTaskContract | null {
  if (!actionScope.includes("codegen=pilot03")) return null;
  const parts = actionScope.split(OPTION_SEP);
  const frag = parts.find((p) => p.includes("codegen=pilot03")) ?? "";
  const map = new Map(
    frag
      .split(";")
      .map((kv) => kv.split("="))
      .filter((p) => p.length === 2)
      .map(([k, v]) => [k!, v!] as const),
  );
  const providerId = map.get("provider") as CodingProviderId | undefined;
  const model = map.get("model");
  if (!providerId || !model) return null;
  const dispatch = parseDispatchMode(map.get("dispatch"));
  const built = buildCodegenTaskContract({
    providerId,
    model,
    classification: (map.get("class") as DataClassification) || "PUBLIC",
    maxSpendUsd: Number(map.get("maxCents") ?? 100) / 100,
    dispatch: dispatch ?? undefined,
  });
  if (!built.ok) return null;
  if (dispatch && built.contract.dispatch !== dispatch) return null;
  return built.contract;
}

export function isCodegenPilotScope(actionScope: string): boolean {
  return actionScope.includes("codegen=pilot03");
}

export function describeEvidenceAttribution(input: {
  actionScope: string;
  simulationLabel: "SIMULATED" | "NONE";
  hasLiveUsage: boolean;
}): {
  mode: "MOCK_GENERATION" | "LIVE_PROVIDER" | "SIMULATED_REMOTE_DEV" | "DURABLE_NON_CODEGEN" | "NONE";
  label: string;
} {
  if (isCodegenPilotScope(input.actionScope)) {
    if (input.hasLiveUsage) {
      return { mode: "LIVE_PROVIDER", label: "LIVE_PROVIDER usage (actual)" };
    }
    return { mode: "MOCK_GENERATION", label: "MOCK_GENERATION / prepared (not live spend)" };
  }
  if (input.simulationLabel === "SIMULATED") {
    return { mode: "SIMULATED_REMOTE_DEV", label: "SIMULATED remote-dev (fake provider)" };
  }
  return { mode: "DURABLE_NON_CODEGEN", label: "Durable non-codegen execution evidence" };
}

export { PILOT_03_OBJECTIVE, PILOT_03_ALLOWED_FILES };
