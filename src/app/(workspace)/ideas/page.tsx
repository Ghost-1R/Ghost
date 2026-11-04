import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState, ErrorState, Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { getSession } from "@/lib/auth/session";
import { captureIdeaAction } from "@/lib/ideas/actions";
import { listIdeas } from "@/lib/ideas/queries";
import { formatTimestamp } from "@/lib/format";

export const metadata: Metadata = {
  title: "Idea Lab",
};

export default async function IdeasPage() {
  const session = await getSession();
  if (session.status !== "authenticated") {
    redirect("/login");
  }

  const ideas = await listIdeas(session.supabase);
  const rows = ideas.status === "ok" ? ideas.data : [];
  const needingDecision = rows.filter((idea) => idea.status === "NEEDS_DECISION");
  const approved = rows.filter((idea) => idea.status === "APPROVED");
  const recent = rows.slice(0, 12);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Idea Lab</p>
          <h1>Think before you build.</h1>
        </div>
        <Link className="button-secondary" href="/dashboard">
          Dashboard
        </Link>
      </div>

      <Panel title="Capture an idea">
        <p className="quiet">Start rough. Ghost will help structure it — Ghost will not decide for you.</p>
        <ActionForm action={captureIdeaAction} submitLabel="Save idea">
          <label className="field">
            <span>Raw idea</span>
            <textarea
              name="rawIdea"
              required
              maxLength={8000}
              placeholder="An app that automatically organizes receipts for small businesses."
            />
          </label>
          <label className="field">
            <span>Working title (optional)</span>
            <input name="title" maxLength={200} />
          </label>
          <label className="field">
            <span>Note / context (optional)</span>
            <textarea name="note" maxLength={4000} />
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Needs a decision">
        {needingDecision.length === 0 ? (
          <EmptyState>No ideas are waiting on a founder decision.</EmptyState>
        ) : (
          <div className="stack">
            {needingDecision.map((idea) => (
              <article className="list-item" key={idea.id}>
                <h3>
                  <Link href={`/ideas/${idea.id}`}>{idea.title}</Link>
                </h3>
                <p className="quiet">
                  {idea.readiness} · {idea.status}
                </p>
              </article>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Approved — ready for strategy / project">
        {approved.length === 0 ? (
          <EmptyState>No approved ideas yet.</EmptyState>
        ) : (
          <div className="stack">
            {approved.map((idea) => (
              <article className="list-item" key={idea.id}>
                <h3>
                  <Link href={`/ideas/${idea.id}`}>{idea.title}</Link>
                </h3>
                <p className="quiet">{idea.summary || "Approved. Strategy and project promotion live on the idea page."}</p>
              </article>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Recently explored">
        {ideas.status === "error" ? <ErrorState message={ideas.message} /> : null}
        {ideas.status === "ok" && recent.length === 0 ? (
          <EmptyState>No ideas yet. Capture one above.</EmptyState>
        ) : null}
        {recent.map((idea) => (
          <article className="list-item" key={`recent-${idea.id}`}>
            <h3>
              <Link href={`/ideas/${idea.id}`}>{idea.title}</Link>
            </h3>
            <ul className="meta">
              <li>
                <StatusBadge status={idea.status} />
              </li>
              <li>{idea.readiness}</li>
              <li>Updated {formatTimestamp(idea.updatedAt)}</li>
            </ul>
            {idea.summary ? <p className="quiet">{idea.summary}</p> : null}
          </article>
        ))}
      </Panel>
    </div>
  );
}
