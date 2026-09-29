import type { ContextItem } from "./types";

const DEPLOYMENT_CLAIM = /\b(we deployed|production is deployed|deployed to vercel|deployment is finished|production is ready)\b/i;
const RETRACTION = /\b(that(?:'|’)s wrong|that is wrong|haven(?:'|’)t deployed|have not deployed|not deployed|correct that)\b/i;

export function claimItems(
  messages: Array<{ role: string; content: string }>,
  projectId: string | null,
): ContextItem[] {
  return messages
    .filter((message) => message.role === "user")
    .map((message, index) => ({
      id: `claim-${index}`,
      type: "conversation_claim",
      authority: "CONVERSATION_CLAIM" as const,
      sourceTable: "ghost_messages",
      sourceId: `claim-${index}`,
      projectId,
      title: "Conversation claim",
      content: message.content,
      status: "CLAIM",
      relevance: 1,
      keep: false,
      selectedBecause: "Recent user message. This is a claim, not verified evidence.",
    }));
}

export function conflictItems(input: {
  messages: Array<{ role: string; content: string }>;
  productionVerified: boolean;
  projectId: string | null;
}): ContextItem[] {
  const users = input.messages.filter((message) => message.role === "user");
  const latest = users.at(-1)?.content ?? "";
  const deploymentClaim = users.some((message) => DEPLOYMENT_CLAIM.test(message.content));
  const retracted = RETRACTION.test(latest);
  const items: ContextItem[] = [];

  if (deploymentClaim && !input.productionVerified) {
    items.push({
      id: "conflict-deployment",
      type: "conflict",
      authority: "PROJECT_STATE",
      sourceTable: "verification_records",
      sourceId: "conflict-deployment",
      projectId: input.projectId,
      title: "Deployment conflict",
      content: retracted
        ? "CONFLICT: a conversation claimed deployment, then retracted it. Verification was not changed. Production is not verified."
        : "CONFLICT: the conversation claims deployment, but project verification does not verify deployment.",
      status: "CONFLICT",
      relevance: 5,
      keep: true,
      selectedBecause: "Conversation claim disagrees with verification.",
    });
  }

  return items;
}
