// ─────────────────────────────────────────────────────────────────────────────
// lib/a11y/speech.ts
//
// Speech-to-text utilities for the learner chat input.
//
// Implementation notes
// ───────────────────
// • Uses the Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`).
// • This is browser-dependent and is not available in every environment.
// • In Chromium-based browsers, speech recognition typically uses a remote
//   service. This means microphone audio may be sent off-device. Even Keel Learning
//   therefore requires explicit user consent before starting recognition.
// • No transcript is persisted by this module — it only returns live text.
//
// This module is intentionally small and dependency-free.
// ─────────────────────────────────────────────────────────────────────────────

export interface SpeechSupport {
  supported: boolean;
  reason?: string;
}

export function getSpeechSupport(): SpeechSupport {
  if (typeof window === "undefined") return { supported: false, reason: "SSR" };
  const w = window as any;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) {
    return {
      supported: false,
      reason:
        "SpeechRecognition API not available. Try a Chromium browser (Chrome/Edge) or enable speech recognition in the browser.",
    };
  }
  return { supported: true };
}

export type SpeechEventHandlers = {
  onResult: (text: string, isFinal: boolean) => void;
  onError: (err: string) => void;
  onEnd: () => void;
};

export interface SpeechSession {
  stop: () => void;
}

export interface StartSpeechOptions {
  lang?: string;
  interimResults?: boolean;
}

export function startSpeechRecognition(
  handlers: SpeechEventHandlers,
  opts: StartSpeechOptions = {},
): SpeechSession {
  if (typeof window === "undefined") {
    handlers.onError("SpeechRecognition is not available during server render.");
    return { stop: () => {} };
  }

  const w = window as any;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) {
    handlers.onError("SpeechRecognition API is not available in this browser.");
    return { stop: () => {} };
  }

  const recog: any = new Ctor();
  recog.lang = opts.lang ?? "en";
  recog.interimResults = opts.interimResults ?? true;
  recog.continuous = true;

  recog.onresult = (event: any) => {
    try {
      // event.results is SpeechRecognitionResultList
      const res = event.results?.[event.results.length - 1];
      const alt = res?.[0];
      const text = alt?.transcript;
      const isFinal = Boolean(res?.isFinal);
      if (typeof text === "string") handlers.onResult(text, isFinal);
    } catch (err: any) {
      handlers.onError(err?.message ?? String(err));
    }
  };

  recog.onerror = (event: any) => {
    const msg = event?.error ? String(event.error) : "speech_error";
    handlers.onError(msg);
  };

  recog.onend = () => {
    handlers.onEnd();
  };

  try {
    recog.start();
  } catch (err: any) {
    // Some browsers throw if start() is called twice.
    handlers.onError(err?.message ?? String(err));
  }

  return {
    stop: () => {
      try {
        recog.stop();
      } catch {
        /* no-op */
      }
    },
  };
}
