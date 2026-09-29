"use client";

import { useEffect } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useExperience } from "@/components/ghost/experience";
import { sendGhostMessage } from "@/lib/conversation/actions";
import { initialActionState } from "@/lib/action-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { splitAnswer, type ConversationMessage } from "@/lib/conversation/queries";

function ConversationActivity() {
  const { pending } = useFormStatus();
  const { setActivity } = useExperience();
  useEffect(() => {
    setActivity(pending ? "THINKING" : null);
    return () => setActivity(null);
  }, [pending, setActivity]);
  return null;
}

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
              <p>{message.role === "assistant" ? splitAnswer(message.content).answer : message.content}</p>
              {message.role === "assistant" && message.sources.length > 0 ? (
                <details className="sources">
                  <summary>Grounded in {message.sources.length} sources</summary>
                  <ul>
                    {message.sources.map((source) => (
                      <li key={`${source.type}-${source.id}`}>
                        {source.type}: {source.title}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
      <form action={formAction} className="stack">
        <ConversationActivity />
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
