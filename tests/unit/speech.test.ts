// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/speech.test.ts
//
// Pin the observable contract of `lib/a11y/speech.ts`:
//
//   1. `getSpeechSupport()` reports `supported: false` with a reason when
//      neither `SpeechRecognition` nor `webkitSpeechRecognition` exist.
//   2. `getSpeechSupport()` reports `supported: true` when a constructor is
//      present.
//   3. `startSpeechRecognition()` calls `onError` and returns a no-op
//      session when no constructor is available.
//   4. `startSpeechRecognition()` wires `onresult`/`onerror`/`onend` and
//      reports both interim and final transcripts faithfully.
//   5. `session.stop()` ends the underlying recognition.
//
// Why these properties: the dictation feature is a user-permission-gated
// network feature on Chromium (audio leaves the device). If support
// detection or wiring drifts, the consent flow in EkeChat could be
// bypassed or could silently fail.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSpeechSupport,
  startSpeechRecognition,
} from "@/lib/a11y/speech";

class FakeSpeechRecognition {
  public lang = "";
  public interimResults = false;
  public continuous = false;
  public onresult: ((e: any) => void) | null = null;
  public onerror: ((e: any) => void) | null = null;
  public onend: (() => void) | null = null;
  public started = false;
  public stopped = false;

  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
    this.onend?.();
  }
}

describe("a11y/speech", () => {
  const w = window as any;
  let original: { SR: any; webkit: any };

  beforeEach(() => {
    original = { SR: w.SpeechRecognition, webkit: w.webkitSpeechRecognition };
  });

  afterEach(() => {
    w.SpeechRecognition = original.SR;
    w.webkitSpeechRecognition = original.webkit;
  });

  it("reports unsupported when neither constructor exists", () => {
    delete w.SpeechRecognition;
    delete w.webkitSpeechRecognition;
    const s = getSpeechSupport();
    expect(s.supported).toBe(false);
    expect(typeof s.reason).toBe("string");
    expect(s.reason!.length).toBeGreaterThan(0);
  });

  it("reports supported when a constructor exists", () => {
    w.SpeechRecognition = FakeSpeechRecognition;
    expect(getSpeechSupport().supported).toBe(true);
  });

  it("startSpeechRecognition calls onError when unsupported", () => {
    delete w.SpeechRecognition;
    delete w.webkitSpeechRecognition;
    const onError = vi.fn();
    const onResult = vi.fn();
    const onEnd = vi.fn();
    const session = startSpeechRecognition({ onResult, onError, onEnd });
    expect(onError).toHaveBeenCalledTimes(1);
    // session.stop() must be a no-op, not throw.
    expect(() => session.stop()).not.toThrow();
  });

  it("forwards interim and final results with correct isFinal flag", () => {
    let lastInstance: FakeSpeechRecognition | null = null;
    class Recording extends FakeSpeechRecognition {
      constructor() {
        super();
        lastInstance = this;
      }
    }
    w.SpeechRecognition = Recording;

    const seen: { text: string; isFinal: boolean }[] = [];
    startSpeechRecognition(
      {
        onResult: (text, isFinal) => seen.push({ text, isFinal }),
        onError: () => {},
        onEnd: () => {},
      },
      { lang: "en", interimResults: true },
    );

    expect(lastInstance).not.toBeNull();
    expect(lastInstance!.lang).toBe("en");
    expect(lastInstance!.interimResults).toBe(true);
    expect(lastInstance!.started).toBe(true);

    // Simulate two onresult firings: one interim, one final.
    lastInstance!.onresult?.({
      results: [[{ transcript: "hello" }]].map((r, i) =>
        Object.assign(r, { isFinal: false, [0]: r[0] })
      ),
    });
    lastInstance!.onresult?.({
      results: [[{ transcript: "hello world" }]].map((r) =>
        Object.assign(r, { isFinal: true, [0]: r[0] })
      ),
    });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({ text: "hello", isFinal: false });
    expect(seen[1]).toEqual({ text: "hello world", isFinal: true });
  });

  it("session.stop() stops the underlying recognition", () => {
    let lastInstance: FakeSpeechRecognition | null = null;
    class Recording extends FakeSpeechRecognition {
      constructor() {
        super();
        lastInstance = this;
      }
    }
    w.SpeechRecognition = Recording;

    const session = startSpeechRecognition({
      onResult: () => {},
      onError: () => {},
      onEnd: () => {},
    });
    session.stop();
    expect(lastInstance!.stopped).toBe(true);
  });

  it("forwards onerror events with a string error message", () => {
    let lastInstance: FakeSpeechRecognition | null = null;
    class Recording extends FakeSpeechRecognition {
      constructor() {
        super();
        lastInstance = this;
      }
    }
    w.SpeechRecognition = Recording;

    const errors: string[] = [];
    startSpeechRecognition({
      onResult: () => {},
      onError: (m) => errors.push(m),
      onEnd: () => {},
    });

    lastInstance!.onerror?.({ error: "not-allowed" });
    expect(errors).toContain("not-allowed");
  });
});
