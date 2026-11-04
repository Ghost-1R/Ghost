import type { Freshness } from "@/lib/presentation/freshness";
import type { PresentationResult } from "@/lib/presentation/types";

export type CoreState = "IDLE" | "THINKING" | "BUILDING" | "INSPECTING" | "BLOCKED" | "VERIFIED" | "READY";

export function presentationCoreState(result: PresentationResult | null, freshness: Freshness | null): CoreState {
  if (!result || freshness !== "fresh") {
    return "IDLE";
  }
  if (result === "READY") {
    return "READY";
  }
  if (result === "READY_WITH_GAPS") {
    return "VERIFIED";
  }
  return "BLOCKED";
}
