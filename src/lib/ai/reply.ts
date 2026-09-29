import { authorizeProjectContext } from "../brain/authorize";
import type { GhostContext } from "../brain/types";
import { buildModelRequest } from "./request";
import { UNCONFIGURED_NOTICE, type ConversationTurn, type ModelProvider } from "./types";

export async function prepareReply(input: {
  requestedProjectId: string | null;
  visibleProjectId: string | null;
  context: GhostContext | null;
  messages: ConversationTurn[];
  provider: ModelProvider | null;
}): Promise<
  | { ok: false; called: false; reason: "not-visible" }
  | { ok: false; called: false; reason: "unconfigured"; notice: string }
  | { ok: true; called: true; content: string; provider: string; model: string }
> {
  const access = authorizeProjectContext({
    requestedProjectId: input.requestedProjectId,
    visibleProjectId: input.visibleProjectId,
  });

  if (!access.ok) {
    return { ok: false, called: false, reason: "not-visible" };
  }

  if (!input.provider || !input.context) {
    return { ok: false, called: false, reason: "unconfigured", notice: UNCONFIGURED_NOTICE };
  }

  const response = await input.provider.complete(buildModelRequest(input.context, input.messages));
  return {
    ok: true,
    called: true,
    content: response.content,
    provider: response.provider,
    model: response.model,
  };
}
