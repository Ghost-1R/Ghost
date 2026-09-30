export type VoiceInputStatus = "unsupported" | "idle" | "preparing" | "listening" | "result" | "unavailable" | "error";
export type VoiceInputSnapshot = { status: VoiceInputStatus; message: string | null };

export type RecognitionAvailability = "available" | "downloadable" | "downloading" | "unavailable";
type RecognitionOptions = { langs: string[]; processLocally: boolean };

type RecognitionAlternative = { transcript: string };
type RecognitionResult = ArrayLike<RecognitionAlternative> & { isFinal: boolean };

export type RecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  processLocally: boolean;
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

export type RecognitionCtorLike = {
  new (): RecognitionLike;
  prototype: object;
  available: (options: RecognitionOptions) => Promise<RecognitionAvailability>;
  install: (options: RecognitionOptions) => Promise<boolean>;
};

export const IDLE_INPUT: VoiceInputSnapshot = { status: "idle", message: null };
export const UNSUPPORTED_INPUT: VoiceInputSnapshot = { status: "unsupported", message: null };

const UNAVAILABLE_MESSAGE = "On-device speech recognition isn't available for this language in this browser.";

// Voice input is offered only where the browser can recognise speech on the device.
// Cloud recognition would send the founder's audio to a third-party service, so it is never used.
export function onDeviceRecognition(scope: Record<string, unknown>): RecognitionCtorLike | null {
  for (const name of ["SpeechRecognition", "webkitSpeechRecognition"]) {
    const value: unknown = scope[name];
    if (typeof value !== "function") continue;
    const candidate = value as Partial<RecognitionCtorLike>;
    if (
      typeof candidate.available === "function" &&
      typeof candidate.install === "function" &&
      candidate.prototype &&
      "processLocally" in candidate.prototype
    ) {
      return candidate as RecognitionCtorLike;
    }
  }
  return null;
}

export function recognitionLanguage(language: string | undefined): string {
  const tag = (language ?? "").trim();
  if (/^[a-z]{2,3}$/i.test(tag)) return tag.toLowerCase() === "en" ? "en-US" : tag.toLowerCase();
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})+$/i.test(tag) ? tag : "en-US";
}

export function transcriptFrom(results: ArrayLike<RecognitionResult>): string {
  return Array.from(results)
    .map((result) => result[0]?.transcript ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

export function composeDraft(base: string, transcript: string): string {
  const spoken = transcript.trim();
  if (!spoken) return base;
  const kept = base.trimEnd();
  return (kept ? `${kept} ${spoken}` : spoken).slice(0, 4000);
}

export function recognitionFailure(code: string): VoiceInputSnapshot {
  switch (code) {
    case "no-speech":
      return { status: "idle", message: "No speech was heard." };
    case "aborted":
      return IDLE_INPUT;
    case "not-allowed":
      return { status: "error", message: "Microphone access is blocked. Allow it in the browser to dictate." };
    case "audio-capture":
      return { status: "error", message: "No microphone was found." };
    case "service-not-allowed":
    case "language-not-supported":
      return { status: "unavailable", message: UNAVAILABLE_MESSAGE };
    default:
      return { status: "error", message: "Voice input stopped. Nothing was sent." };
  }
}

export type VoiceInputController = ReturnType<typeof createVoiceInput>;

export function createVoiceInput(ctor: RecognitionCtorLike | null) {
  let snapshot: VoiceInputSnapshot = ctor ? IDLE_INPUT : UNSUPPORTED_INPUT;
  let active: RecognitionLike | null = null;
  let run = 0;
  const listeners = new Set<() => void>();
  const transcriptListeners = new Set<(text: string) => void>();
  const set = (next: VoiceInputSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onTranscript(listener: (text: string) => void) {
      transcriptListeners.add(listener);
      return () => {
        transcriptListeners.delete(listener);
      };
    },
    async start(language: string): Promise<void> {
      if (!ctor || active || snapshot.status === "preparing") return;
      const current = ++run;
      const options = { langs: [language], processLocally: true };
      const availability = await ctor.available(options).catch((): RecognitionAvailability => "unavailable");
      if (current !== run) return;
      if (availability === "unavailable") {
        set({ status: "unavailable", message: UNAVAILABLE_MESSAGE });
        return;
      }
      if (availability !== "available") {
        set({ status: "preparing", message: `Downloading on-device speech for ${language}…` });
        const installed = await ctor.install(options).catch(() => false);
        if (current !== run) return;
        if (!installed) {
          set({ status: "unavailable", message: "The on-device speech pack could not be installed." });
          return;
        }
      }

      const recognition = new ctor();
      recognition.lang = language;
      recognition.processLocally = true;
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.maxAlternatives = 1;
      let heard = "";
      let failure: VoiceInputSnapshot | null = null;
      recognition.onresult = (event) => {
        if (current !== run) return;
        heard = transcriptFrom(event.results);
        for (const listener of transcriptListeners) listener(heard);
      };
      recognition.onerror = (event) => {
        if (current !== run) return;
        failure = recognitionFailure(event.error);
      };
      recognition.onend = () => {
        if (current !== run) return;
        active = null;
        if (failure) set(failure);
        else if (heard) set({ status: "result", message: "Transcript ready. Edit it, then send." });
        else set({ status: "idle", message: "No speech was heard." });
      };
      active = recognition;
      set({ status: "listening", message: "Listening…" });
      try {
        recognition.start();
      } catch {
        active = null;
        set(recognitionFailure("unknown"));
      }
    },
    stop() {
      if (active) {
        active.stop();
        return;
      }
      if (snapshot.status === "preparing") {
        run += 1;
        set(IDLE_INPUT);
      }
    },
    reset() {
      run += 1;
      active?.abort();
      active = null;
      if (ctor) set(IDLE_INPUT);
    },
  };
}
