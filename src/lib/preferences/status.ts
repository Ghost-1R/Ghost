import { describeProviderPolicy } from "@/lib/ai/provider";
import type { FounderPreferences } from "./types";

export type ControlCenterStatus = {
  providerReady: boolean;
  providerSummary: string;
  privacyNote: string;
  agentExecution: "DISABLED" | "NOT_DEPLOYED";
  agentExecutionDetail: string;
  hostedAgentAllowed: boolean;
  consequentialPolicy: string;
  emergencyStop: string;
  incidents: Array<{ title: string; detail: string; severity: "INFO" | "HIGH" }>;
  preferenceSummary: string;
};

/**
 * Production Settings V1 status — no agent-runtime imports.
 * Agent workers are not part of this release; report honest unavailable/disabled state.
 */
export function buildControlCenterStatus(preferences: FounderPreferences): ControlCenterStatus {
  const intelligence = describeProviderPolicy();
  const ready = intelligence.status === "READY";
  const executionFlag = process.env.GHOST_AGENT_EXECUTION_ENABLED?.trim() === "1";

  return {
    providerReady: ready,
    providerSummary: `${intelligence.provider} / ${intelligence.model} — ${ready ? "Ready" : "Not configured"}`,
    privacyNote:
      "Free-first Groq path; paid fallback disabled. API keys stay in server environment variables — never in Settings UI.",
    agentExecution: "NOT_DEPLOYED",
    agentExecutionDetail: executionFlag
      ? "Agent execution flag is set in the environment, but agent workers/tables are not part of this Settings release — treat as unavailable."
      : "Agent workers are not deployed on this release. Execution remains unavailable.",
    hostedAgentAllowed: false,
    consequentialPolicy:
      "Conversation Soft gate: Save Plan / Start Building are classified CONSEQUENTIAL; Ghost must not mutate lifecycle from chat alone. Hard execution remains Inspector / dedicated OS routes with founder approval.",
    emergencyStop:
      "Agent execution is not enabled by this release. No Settings control can start workers.",
    incidents: [
      {
        severity: "INFO",
        title: "Agent runtime",
        detail: "Not included in Settings V1 release candidate.",
      },
      {
        severity: ready ? "INFO" : "HIGH",
        title: "Active model provider",
        detail: ready
          ? "Provider path is configured for non-secret settings summary."
          : "No ready provider — Ask fails closed until configuration is valid.",
      },
    ],
    preferenceSummary: `${preferences.responseStyle} · ${preferences.responseDetail} · motion ${
      preferences.reduceMotion ? "reduced" : "standard"
    } · ${preferences.appearance.toLowerCase()}`,
  };
}
