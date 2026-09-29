import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EmptyState, Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { getSession } from "@/lib/auth/session";
import { loadPatterns } from "@/lib/patterns/library";
import path from "node:path";

export const metadata: Metadata = {
  title: "Patterns",
};

export default async function PatternsPage() {
  const session = await getSession();
  if (session.status !== "authenticated") {
    redirect("/login");
  }

  const patterns = await loadPatterns(path.join(process.cwd(), "ghost-patterns"));
  const drafts = patterns.filter((pattern) => pattern.status === "DRAFT");

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Patterns</p>
          <h1>Reusable approaches from Ghost.</h1>
        </div>
      </div>
      <Panel title="Approval">
        <p className="quiet">
          {drafts.length} draft patterns are grounded in this repository and are not trusted until you change Status
          to APPROVED in the pattern file. Ghost will not treat a draft as a proven cross-project pattern.
        </p>
      </Panel>
      {patterns.length === 0 ? <EmptyState>No patterns are stored.</EmptyState> : null}
      {patterns.map((pattern) => (
        <Panel title={pattern.name} key={pattern.id}>
          <p>{pattern.purpose}</p>
          <ul className="meta">
            <li>
              <StatusBadge status={pattern.status} />
            </li>
            <li>Use when: {pattern.useWhen}</li>
            <li>Do not use when: {pattern.doNotUseWhen}</li>
          </ul>
          <p className="quiet">{pattern.provenance}</p>
        </Panel>
      ))}
    </div>
  );
}
