"use client";

import { useEffect, useId, useOptimistic, useRef, useState, type KeyboardEvent } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { GhostCore, useExperience } from "@/components/ghost/experience";
import { Markdown } from "@/components/ghost/markdown";
import { useVoiceReader, VoiceControls } from "@/components/ghost/voice";
import { MicButton, useVoiceInput } from "@/components/ghost/voice-input";
import { sendGhostMessage } from "@/lib/conversation/actions";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { splitAnswer, type ConversationMessage } from "@/lib/conversation/queries";
import { getSoundPreference, playSound } from "@/lib/experience/sound";
import { isLongAnswer, latestExchange, READY_HOLD_MS } from "@/lib/conversation/latest";

function useCoreActivity(pending: boolean, latestAnswerId: string | null) {
  const { setActivity } = useExperience();
  const seen = useRef(latestAnswerId);

  useEffect(() => {
    if (pending) {
      setActivity("THINKING");
      return;
    }
    if (latestAnswerId && latestAnswerId !== seen.current) {
      seen.current = latestAnswerId;
      setActivity("READY");
      playSound("ghost.notification", getSoundPreference());
      const timer = window.setTimeout(() => setActivity(null), READY_HOLD_MS);
      return () => window.clearTimeout(timer);
    }
    setActivity(null);
  }, [pending, latestAnswerId, setActivity]);

  useEffect(() => () => setActivity(null), [setActivity]);
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

function Thinking() {
  return (
    <div className="ghost-thinking" role="status">
      <span className="thinking-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      Ghost is thinking…
    </div>
  );
}

function Thread({ messages, pendingQuestion = null }: { messages: ConversationMessage[]; pendingQuestion?: string | null }) {
  return (
    <div className="thread">
      {messages.map((message) => (
        <Bubble message={message} key={message.id} />
      ))}
      {pendingQuestion ? (
        <>
          <article className="bubble bubble-user">
            <div className="bubble-head">
              <p className="eyebrow">You</p>
            </div>
            <p className="bubble-text">{pendingQuestion}</p>
          </article>
          <Thinking />
        </>
      ) : null}
    </div>
  );
}

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <button className="command-action command-send" type="submit" disabled={pending} aria-label={pending ? "Ghost is thinking" : "Ask Ghost"}>
      {pending ? (
        <span className="command-spinner" aria-hidden="true" />
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 12h12.5M12.5 6.5 18 12l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
  event.preventDefault();
  const form = event.currentTarget.form;
  if (event.currentTarget.value.trim() && form?.dataset.pending !== "true") {
    form?.requestSubmit();
  }
}

function ConversationDialog({
  messages,
  open,
  onClose,
}: {
  messages: ConversationMessage[];
  open: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      if (body.current) body.current.scrollTop = body.current.scrollHeight;
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="conversation-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      <div className="dialog-head">
        <h2 id={titleId}>Conversation</h2>
        <button className="button-secondary" type="button" onClick={() => dialog.current?.close()}>
          Close
        </button>
      </div>
      <div className="dialog-body" ref={body}>
        {open ? <Thread messages={messages} /> : null}
      </div>
    </dialog>
  );
}

function LatestAnswer({ answer }: { answer: ConversationMessage }) {
  const [expanded, setExpanded] = useState(false);
  const long = isLongAnswer(answer.content);
  return (
    <div className="latest-answer" data-long={long} data-expanded={expanded}>
      <Bubble message={answer} />
      {long ? (
        <button className="latest-more" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Show less" : "Show full answer"}
        </button>
      ) : null}
    </div>
  );
}

function LatestExchange({
  messages,
  pendingQuestion,
}: {
  messages: ConversationMessage[];
  pendingQuestion: string | null;
}) {
  const [open, setOpen] = useState(false);
  const exchange = latestExchange(messages, pendingQuestion);
  if (!exchange.ask && !exchange.answer) {
    return null;
  }
  return (
    <section className="latest" aria-labelledby="latest-title">
      <div className="latest-head">
        <h2 className="eyebrow" id="latest-title">
          Latest from Ghost
        </h2>
        {messages.length > 0 ? (
          <button className="latest-open" type="button" onClick={() => setOpen(true)}>
            Open conversation <span className="latest-count">{messages.length} messages</span>
          </button>
        ) : null}
      </div>
      {exchange.ask ? (
        <p className="latest-ask">
          <span className="sr-only">You asked: </span>
          {exchange.ask}
        </p>
      ) : null}
      {exchange.thinking ? <Thinking /> : null}
      {exchange.answer ? <LatestAnswer answer={exchange.answer} key={exchange.answer.id} /> : null}
      {exchange.unanswered ? <p className="quiet">Ghost did not store an answer for this request.</p> : null}
      <ConversationDialog messages={messages} open={open} onClose={() => setOpen(false)} />
    </section>
  );
}

export function GhostConversation({
  projectId,
  projectName,
  ideaId = null,
  conversationId,
  messages,
  providerConfigured,
  variant = "thread",
}: {
  projectId: string | null;
  projectName: string | null;
  ideaId?: string | null;
  conversationId: string | null;
  messages: ConversationMessage[];
  providerConfigured: boolean;
  variant?: "thread" | "command";
}) {
  const [pendingQuestion, showPendingQuestion] = useOptimistic<string | null>(null);
  const [state, formAction, pending] = useActionState(async (previous: ActionState, formData: FormData) => {
    showPendingQuestion(String(formData.get("message") ?? "").trim() || null);
    return sendGhostMessage(previous, formData);
  }, initialActionState);
  useVoiceReader(`${ideaId ?? projectId ?? "all"}:${conversationId ?? "new"}`, messages);
  const latestAnswerId = [...messages].reverse().find((message) => message.role === "assistant")?.id ?? null;
  useCoreActivity(pending, latestAnswerId);
  const field = useRef<HTMLTextAreaElement>(null);
  const voice = useVoiceInput(field);
  const hintId = useId();

  const providerNotice = providerConfigured ? null : (
    <p className="notice" role="status">
      No model provider is configured. Ghost can store the question, but it will not invent an answer.
    </p>
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
  const hidden = (
    <>
      <input type="hidden" name="projectId" value={projectId ?? ""} />
      <input type="hidden" name="ideaId" value={ideaId ?? ""} />
      <input type="hidden" name="conversationId" value={conversationId ?? ""} />
    </>
  );

  if (variant === "command") {
    return (
      <div className="command-experience">
        <div className="command-dock">
          <form action={formAction} className="command-bar" data-pending={pending}>
            {hidden}
            <span className="command-mark" aria-hidden="true">
              <GhostCore size="mark" />
            </span>
            <label className="sr-only" htmlFor="ghost-command">
              Ask Ghost
            </label>
            <textarea
              id="ghost-command"
              ref={field}
              name="message"
              rows={1}
              required
              maxLength={4000}
              enterKeyHint="send"
              placeholder="Ask Ghost anything…"
              aria-describedby={hintId}
              onKeyDown={submitOnEnter}
            />
            <MicButton voice={voice} />
            <SendButton />
          </form>
          <p className="command-voice" role="status" aria-live="polite" data-status={voice.snapshot.status}>
            {voice.snapshot.message}
          </p>
          <p className="command-hint" id={hintId}>
            Enter sends · Shift+Enter adds a line · Ghost answers from your Project Brain and says when something is unknown.
          </p>
        </div>
        {feedback}
        {providerNotice}
        <LatestExchange messages={messages} pendingQuestion={pendingQuestion} />
      </div>
    );
  }

  return (
    <div className="stack">
      <p className="quiet">
        {projectName
          ? `Ask Ghost about ${projectName}. This thread stays on this project.`
          : "Ask across your projects. Ghost loads one project's detail only after it matches a project you can see."}
      </p>
      {providerNotice}
      {messages.length > 0 || pendingQuestion ? <Thread messages={messages} pendingQuestion={pendingQuestion} /> : null}
      <form action={formAction} className="stack">
        {hidden}
        <label className="field">
          <span>{projectName ? "Ask about this project" : "Ask Ghost"}</span>
          <textarea name="message" required maxLength={4000} placeholder="What should happen next?" />
        </label>
        <SubmitButton label="Ask Ghost" />
      </form>
      {feedback}
    </div>
  );
}
