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
 * Production Settings status — no agent-runtime imports (keeps Settings decoupled).
 * Approval-bound contract may exist in code; workers remain unavailable/disabled.
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
    agentExecution: "DISABLED",
    agentExecutionDetail: executionFlag
      ? "GHOST_AGENT_EXECUTION_ENABLED is set, but workers stay disabled — approval-bound task contract only; no activation from Settings."
      : "Approval-bound agent-task contract is available in code. Workers are disabled; no Settings control can start them.",
    hostedAgentAllowed: false,
    consequentialPolicy:
      "Conversation Soft gate: Save Plan / Start Building are classified CONSEQUENTIAL; Ghost must not mutate lifecycle from chat alone. Hard execution remains Inspector / dedicated OS routes with founder approval.",
    emergencyStop:
      "Agent execution is disabled. No Settings control can start workers.",
    incidents: [
      {
        severity: "INFO",
        title: "Agent runtime",
        detail:
          "Contract + queue foundations exist; workers not activated. Founder approval required before any execution.",
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
