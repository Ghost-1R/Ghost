"use client";

import { useActionState } from "react";
import { sendGhostMessage } from "@/lib/conversation/actions";
import { initialActionState } from "@/lib/action-state";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ConversationMessage } from "@/lib/conversation/queries";

export function GhostConversation({
  projectId,
  projectName,
  conversationId,
  messages,
  providerConfigured,
}: {
  projectId: string | null;
  projectName: string | null;
  conversationId: string | null;
  messages: ConversationMessage[];
  providerConfigured: boolean;
}) {
  const [state, formAction] = useActionState(sendGhostMessage, initialActionState);

  return (
    <div className="stack">
      <p className="quiet">
        {projectName
          ? `Ask Ghost about ${projectName}. This thread stays on this project.`
          : "Ask across your projects. Ghost loads one project's detail only after it matches a project you can see."}
      </p>
      {providerConfigured ? null : (
        <p className="notice" role="status">
          No model provider is configured. Ghost can store the question, but it will not invent an answer.
        </p>
      )}
      {messages.length > 0 ? (
        <div className="thread">
          {messages.map((message) => (
            <article className={message.role === "user" ? "bubble bubble-user" : "bubble"} key={message.id}>
              <p className="eyebrow">{message.role === "user" ? "You" : "Ghost"}</p>
              <p>{message.content}</p>
            </article>
          ))}
        </div>
      ) : null}
      <form action={formAction} className="stack">
        <input type="hidden" name="projectId" value={projectId ?? ""} />
        <input type="hidden" name="conversationId" value={conversationId ?? ""} />
        <label className="field">
          <span>{projectName ? "Ask about this project" : "Ask Ghost"}</span>
          <textarea name="message" required maxLength={4000} placeholder="What should happen next?" />
        </label>
        <SubmitButton label="Ask Ghost" />
      </form>
      {state.error ? (
        <p className="alert" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p className="notice" role="status">
          {state.notice}
        </p>
      ) : null}
    </div>
  );
}
