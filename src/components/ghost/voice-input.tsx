"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import {
  composeDraft,
  createVoiceInput,
  onDeviceRecognition,
  recognitionLanguage,
  UNSUPPORTED_INPUT,
  type VoiceInputSnapshot,
  type VoiceInputStatus,
} from "@/lib/experience/voice-input";

const LABELS: Record<VoiceInputStatus, string> = {
  unsupported: "Voice input unavailable",
  idle: "Dictate with on-device voice input",
  result: "Dictate again",
  error: "Dictate with on-device voice input",
  preparing: "Cancel the speech download",
  listening: "Stop listening",
  unavailable: "Voice input is unavailable in this browser",
};

export type VoiceInput = { snapshot: VoiceInputSnapshot; toggle: () => void };

export function useVoiceInput(targetRef: RefObject<HTMLTextAreaElement | null>): VoiceInput {
  const base = useRef("");
  const [controller] = useState(() =>
    createVoiceInput(typeof window === "undefined" ? null : onDeviceRecognition(window as unknown as Record<string, unknown>)),
  );
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, () => UNSUPPORTED_INPUT);

  useEffect(() => {
    const field = targetRef.current;
    const form = field?.form;
    const reset = () => controller.reset();
    const stopListening = controller.onTranscript((text) => {
      if (field) field.value = composeDraft(base.current, text);
    });
    form?.addEventListener("submit", reset);
    return () => {
      stopListening();
      form?.removeEventListener("submit", reset);
      controller.reset();
    };
  }, [controller, targetRef]);

  useEffect(() => {
    const field = targetRef.current;
    if (snapshot.status === "result" && field) {
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    }
  }, [snapshot.status, targetRef]);

  return {
    snapshot,
    toggle() {
      if (snapshot.status === "listening" || snapshot.status === "preparing") {
        controller.stop();
        return;
      }
      base.current = targetRef.current?.value ?? "";
      void controller.start(recognitionLanguage(navigator.language));
    },
  };
}

export function MicButton({ voice }: { voice: VoiceInput }) {
  const { status } = voice.snapshot;
  if (status === "unsupported") {
    return null;
  }
  return (
    <span className="voice-input" data-status={status}>
      <button
        className="command-action command-mic"
        type="button"
        aria-label={LABELS[status]}
        aria-pressed={status === "listening"}
        title={LABELS[status]}
        disabled={status === "unavailable"}
        onClick={voice.toggle}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 1 0-7 0v5A3.5 3.5 0 0 0 12 15Zm6-3.5a6 6 0 0 1-12 0M12 17.5V21m-3.5 0h7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </span>
  );
}
