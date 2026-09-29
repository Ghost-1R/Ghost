import type { ConversationSource } from "@/lib/conversation/queries";
import type { ContextItem } from "@/lib/ghost-context/types";
import { relevanceScore } from "@/lib/ghost-context/select";
import { isStale, staleSummary } from "./status";
import type { InspectionResult } from "./types";

export function latestInspections(results: InspectionResult[]): InspectionResult[] {
  const seen = new Set<string>();
  const latest: InspectionResult[] = [];
  for (const result of results) {
    if (seen.has(result.checkId)) {
      continue;
    }
    seen.add(result.checkId);
    latest.push(result);
  }
  return latest;
}

export function inspectionQuestion(message: string): "inventory" | "build" | null {
  const text = message.trim().toLocaleLowerCase();
  if (text.includes("what has actually been verified")) {
    return "inventory";
  }
  if (
    /current (?:commit|code)/.test(text) &&
    (/build verified/.test(text) || /pass the build/.test(text) || /verified/.test(text))
  ) {
    return "build";
  }
  return null;
}

function sourceFor(result: InspectionResult): ConversationSource {
  const commit = result.commit ? result.commit.slice(0, 7) : "unknown";
  const exit = result.exitCode == null ? "no exit" : `exit ${result.exitCode}`;
  return {
    id: result.id,
    type: "inspection",
    title: `${result.checkType} ${result.status} commit ${commit} ${exit} checked ${result.completedAt}`,
    status: result.status,
  };
}

export function explainInspections(input: {
  question: "inventory" | "build";
  results: InspectionResult[];
  current: { commit: string; workingTree: "clean" | "dirty"; treeStamp: string };
  verificationLines: string[];
}): { text: string; sources: ConversationSource[] } {
  const latest = latestInspections(input.results);
  if (input.question === "build") {
    const build = latest.find((result) => result.checkId === "build");
    if (!build) {
      return {
        text: "The current code is not build verified. No build inspection is recorded for this account.",
        sources: [],
      };
    }
    const source = sourceFor(build);
    if (isStale(build, input.current)) {
      return { text: staleSummary(build, input.current), sources: [source] };
    }
    if (build.status === "VERIFIED") {
      return {
        text: `The build command was VERIFIED at commit ${build.commit?.slice(0, 7)} with working tree ${build.workingTree}, exit ${build.exitCode}, checked ${build.completedAt}. That verifies the build command for this tree only. It does not verify deployment.`,
        sources: [source],
      };
    }
    return {
      text: `The recorded build check is ${build.status} at commit ${build.commit?.slice(0, 7) ?? "unknown"}. It is not a successful verification of the current tree.`,
      sources: [source],
    };
  }

  const lines = latest.map((result) => {
    const commit = result.commit ? result.commit.slice(0, 7) : "no commit";
    const fresh = result.treeStamp ? !isStale(result, input.current) : false;
    const coverage = result.treeStamp ? (fresh ? "matches the current tree" : "does not cover the current tree") : "not bound to a tree";
    return `${result.name}: ${result.status}. ${coverage}. Commit ${commit}. ${result.summary}`;
  });
  const failed = latest.filter((result) => result.status === "FAILED").map((result) => result.name);
  const lead = failed.length > 0 ? `Failed checks stay failed: ${failed.join(", ")}.` : "No recorded check is FAILED.";
  const records = input.verificationLines.length
    ? `Stored verification records: ${input.verificationLines.join(" ")}`
    : "No stored verification records were loaded for this answer.";
  return {
    text: `${lead} ${lines.join(" ")} ${records} A model sentence is not verification. Build success is not deployment.`,
    sources: latest.map(sourceFor),
  };
}

export function inspectionContextItems(question: string, results: InspectionResult[]): ContextItem[] {
  return latestInspections(results).flatMap((result) => {
    const content = `${result.summary} Status ${result.status}. Commit ${result.commit ?? "none"}. Checked ${result.completedAt}.`;
    const relevance = relevanceScore(question, `${result.name} ${result.checkType} ${result.status}`, content);
    if (relevance === 0) {
      return [];
    }
    return [
      {
        id: result.id,
        type: "inspection",
        authority: result.status === "VERIFIED" || result.status === "FAILED" ? "VERIFIED_EVIDENCE" : "PROJECT_NOTE",
        sourceTable: "inspector",
        sourceId: result.id,
        projectId: result.projectId,
        title: result.name,
        content,
        status: result.status,
        relevance,
        keep: result.status === "FAILED",
        selectedBecause: "The inspection record shares terms with the question.",
      } satisfies ContextItem,
    ];
  });
}
