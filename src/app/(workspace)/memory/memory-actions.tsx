"use client";

import { useActionState } from "react";
import { initialActionState } from "@/lib/action-state";
import { retireFounderRule, reviewMemoryProposal } from "@/lib/memory/actions";
import { SubmitButton } from "@/components/ui/submit-button";

function ReviewForm({
  proposalId,
  decision,
  label,
}: {
  proposalId: string;
  decision: "APPROVED" | "REJECTED" | "PROJECT_ONLY";
  label: string;
}) {
  const [state, action] = useActionState(reviewMemoryProposal, initialActionState);

  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="proposalId" value={proposalId} />
      <input type="hidden" name="decision" value={decision} />
      <SubmitButton label={label} />
      {state.error ? (
        <p className="alert" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function ProposalActions({
  proposalId,
  scope,
  projectId,
}: {
  proposalId: string;
  scope: "FOUNDER_RULE" | "PROJECT_KNOWLEDGE";
  projectId: string | null;
}) {
  return (
    <div className="stack">
      {scope === "FOUNDER_RULE" ? (
        <ReviewForm proposalId={proposalId} decision="APPROVED" label="Approve" />
      ) : null}
      <ReviewForm proposalId={proposalId} decision="REJECTED" label="Reject" />
      {projectId ? <ReviewForm proposalId={proposalId} decision="PROJECT_ONLY" label="Keep project only" /> : null}
    </div>
  );
}

export function RetireRuleButton({ ruleId }: { ruleId: string }) {
  const [state, action] = useActionState(retireFounderRule, initialActionState);

  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="ruleId" value={ruleId} />
      <SubmitButton label="Retire" />
      {state.error ? (
        <p className="alert" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
