import { relevanceScore } from "@/lib/ghost-context/select";
import type { ContextItem } from "@/lib/ghost-context/types";
import type { PatternRecord } from "@/lib/patterns/parse";
import { explicitRepositoryPaths, type RepoSnapshot } from "./snapshot";

export function repositoryContextItems(
  question: string,
  snapshot: RepoSnapshot,
  patterns: PatternRecord[],
): ContextItem[] {
  const items: ContextItem[] = [
    {
      id: `repo-status-${snapshot.commit.slice(0, 12)}`,
      type: "repo_status",
      authority: "REPOSITORY_EVIDENCE",
      sourceTable: "repository",
      sourceId: snapshot.commit,
      projectId: null,
      title: `Repository ${snapshot.branch} @ ${snapshot.commit.slice(0, 7)}`,
      content: `Branch ${snapshot.branch}. Commit ${snapshot.commit}. Working tree ${snapshot.workingTree}. Captured at ${snapshot.capturedAt}. This is repository evidence, not production verification. A build script or a file does not prove deployment.`,
      status: snapshot.workingTree,
      relevance: 1,
      keep: true,
      selectedBecause: "Current Git state is read from the local repository at request time.",
    },
  ];

  const named = new Set(explicitRepositoryPaths(question));
  for (const file of snapshot.files) {
    const explicit = named.has(file.path);
    items.push({
      id: `repo-file-${file.path}`,
      type: "repo_file",
      authority: "REPOSITORY_EVIDENCE",
      sourceTable: "repository",
      sourceId: file.path,
      projectId: null,
      title: file.path,
      content: file.excerpt,
      status: "OBSERVED",
      relevance: relevanceScore(question, file.path, file.excerpt),
      keep: explicit,
      selectedBecause: explicit
        ? "The question names this path. The excerpt is repository data from the captured working tree."
        : "The path shares terms with the question. The excerpt is from the file at the captured commit state.",
    });
  }

  if (tokensOverlap(question, "migration supabase schema") && snapshot.migrations.length > 0) {
    items.push({
      id: "repo-migrations",
      type: "repo_config",
      authority: "REPOSITORY_EVIDENCE",
      sourceTable: "repository",
      sourceId: "supabase/migrations",
      projectId: null,
      title: "Migration files",
      content: snapshot.migrations.join("\n"),
      status: "OBSERVED",
      relevance: 2,
      keep: false,
      selectedBecause: "The question mentions migrations, so file names are included. Presence in the repo does not prove a remote migration was applied.",
    });
  }

  for (const pattern of patterns) {
    if (pattern.status === "RETIRED") {
      continue;
    }
    const relevance = relevanceScore(question, pattern.name, `${pattern.purpose} ${pattern.useWhen}`);
    if (relevance === 0) {
      continue;
    }
    items.push({
      id: `pattern-${pattern.id}`,
      type: "pattern",
      authority: "REPOSITORY_EVIDENCE",
      sourceTable: "ghost-patterns",
      sourceId: pattern.id,
      projectId: null,
      title: pattern.name,
      content: `${pattern.purpose} Status: ${pattern.status}. ${pattern.status === "APPROVED" ? "This is an approved reusable pattern." : "This pattern is not a trusted reusable pattern until the founder approves it."} Provenance: ${pattern.provenance}`,
      status: pattern.status,
      relevance,
      keep: false,
      selectedBecause: "The pattern shares terms with the question.",
    });
  }

  return items;
}

function tokensOverlap(question: string, text: string): boolean {
  return relevanceScore(question, text, text) > 0;
}
