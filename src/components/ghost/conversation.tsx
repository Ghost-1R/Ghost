"use client";

import { useEffect } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useExperience } from "@/components/ghost/experience";
import { Markdown } from "@/components/ghost/markdown";
import { useVoiceReader, VoiceControls } from "@/components/ghost/voice";
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

function Bubble({ message }: { message: ConversationMessage }) {
  return (
    <article className={message.role === "user" ? "bubble bubble-user" : "bubble"}>
      <div className="bubble-head">
        <p className="eyebrow">{message.role === "user" ? "You" : "Ghost"}</p>
        {message.role === "assistant" ? <VoiceControls messageId={message.id} source={splitAnswer(message.content).answer} /> : null}
      </div>
      {message.role === "assistant" ? <Markdown source={splitAnswer(message.content).answer} /> : <p className="bubble-text">{message.content}</p>}
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
  );
}

function Thread({ messages }: { messages: ConversationMessage[] }) {
  return (
    <div className="thread">
      {messages.map((message) => (
        <Bubble message={message} key={message.id} />
      ))}
    </div>
  );
}

export function GhostConversation({
  projectId,
  projectName,
  conversationId,
  messages,
  providerConfigured,
  variant = "thread",
}: {
  projectId: string | null;
  projectName: string | null;
  conversationId: string | null;
  messages: ConversationMessage[];
  providerConfigured: boolean;
  variant?: "thread" | "command";
}) {
  const [state, formAction] = useActionState(sendGhostMessage, initialActionState);
  useVoiceReader(`${projectId ?? "all"}:${conversationId ?? "new"}`, messages);
  const command = variant === "command";
  const recentStart = command ? Math.max(0, messages.length - 2) : 0;

  const intro = (
    <p className="quiet">
      {projectName
        ? `Ask Ghost about ${projectName}. This thread stays on this project.`
        : "Ask across your projects. Ghost loads one project's detail only after it matches a project you can see."}
    </p>
  );
  const providerNotice = providerConfigured ? null : (
    <p className="notice" role="status">
      No model provider is configured. Ghost can store the question, but it will not invent an answer.
    </p>
  );
  const form = (
    <form action={formAction} className={command ? "command-bar" : "stack"}>
      <ConversationActivity />
      <input type="hidden" name="projectId" value={projectId ?? ""} />
      <input type="hidden" name="conversationId" value={conversationId ?? ""} />
      <label className="field">
        <span>{projectName ? "Ask about this project" : "Ask Ghost"}</span>
        <textarea name="message" required maxLength={4000} placeholder="What should happen next?" />
      </label>
      <SubmitButton label="Ask Ghost" />
    </form>
  );
  const feedback = (
    <>
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
    </>
  );

  if (command) {
    const earlier = messages.slice(0, recentStart);
    const recent = messages.slice(recentStart);
    return (
      <div className="stack">
        {form}
        {feedback}
        {providerNotice}
        {intro}
        {recent.length > 0 ? <Thread messages={recent} /> : null}
        {earlier.length > 0 ? (
          <details className="thread-history">
            <summary>Earlier in this thread ({earlier.length} messages)</summary>
            <Thread messages={earlier} />
          </details>
        ) : null}
      </div>
    );
  }

  return (
    <div className="stack">
      {intro}
      {providerNotice}
      {messages.length > 0 ? <Thread messages={messages} /> : null}
      {form}
      {feedback}
    </div>
  );
}
