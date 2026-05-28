import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentSpec } from '@polymath/contract';

type ExplainBackPromptSpec = Extract<ComponentSpec, { kind: 'ExplainBackPrompt' }>;

/**
 * T-11a — the explain-back prompt (the integrity-boundary front-end, F-11).
 *
 * Lifecycle:
 *   1. On mount, TTS the `promptBody` (a single ~3s read) over the voice client.
 *   2. Open a `maxDurationSec` recording window with a VISIBLE countdown.
 *   3. On window close (countdown hits 0, or the learner clicks Done), capture the
 *      transcript and dispatch `explain_back_recording_ended` with `targetItemId`,
 *      `transcript`, and the measured `durationMs`.
 *
 * FAIL CLOSED at the edges: a blocked mic / no audio → an EMPTY transcript (the
 * server's precondition #3 then fails closed). A TTS throw (the iOS-Safari quirk)
 * is swallowed — the recording window still opens. The component NEVER throws in
 * render.
 *
 * The TTS + recording are injected via `deps` so the component is deterministically
 * testable without a real mic or the Realtime API (mirrors the `voice/client.ts`
 * injectable-seam pattern). In production `App` supplies the F-10 voice-client seam.
 */

/** Injectable side-effect seams (real ones supplied by `App`; doubles in tests). */
export interface ExplainBackPromptDeps {
  /** Speak the prompt once (the ~3s TTS read). Wraps the F-10 voice client. */
  speak: (text: string) => void;
  /**
   * Begin capturing the learner's utterance over the WebRTC bridge. Returns a
   * `stop()` that ends capture and yields the final transcript ('' when no audio
   * was captured — the fail-closed signal).
   */
  startRecording: () => () => string;
  /** Injectable clock (defaults to Date.now) for a deterministic `durationMs`. */
  now?: () => number;
}

/** The payload the parent dispatches as an `explain_back_recording_ended` event. */
export interface ExplainBackEndPayload {
  targetItemId: string;
  transcript: string;
  durationMs: number;
}

export function ExplainBackPrompt({
  spec,
  deps,
  onExplainBackEnd,
}: {
  spec: ExplainBackPromptSpec;
  deps: ExplainBackPromptDeps;
  onExplainBackEnd?: (payload: ExplainBackEndPayload) => void;
}): ReactElement {
  const now = deps.now ?? Date.now;
  const [remaining, setRemaining] = useState(spec.maxDurationSec);
  // Guards against a double-close (the countdown firing AND a Done click racing).
  const closedRef = useRef(false);
  const startedAtRef = useRef<number>(now());
  const stopRecordingRef = useRef<(() => string) | null>(null);

  // (1) TTS the prompt + open the recording window — ONCE, on mount. A TTS throw
  // (iOS Safari) must not break the window; swallow it. A recording-start throw
  // (no mic) leaves `stopRecordingRef` null → an empty transcript on close.
  useEffect(() => {
    try {
      deps.speak(spec.promptBody);
    } catch {
      // iOS-Safari TTS quirk / unavailable synth — degrade silently; the window
      // still opens so the learner can speak.
    }
    try {
      stopRecordingRef.current = deps.startRecording();
    } catch {
      stopRecordingRef.current = null;
    }
    startedAtRef.current = now();
    // Mount-only: the spec identity changes via React key on a remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    // Capture the transcript (fail closed to '' on any error / no audio).
    let transcript = '';
    try {
      transcript = stopRecordingRef.current?.() ?? '';
    } catch {
      transcript = '';
    }
    const durationMs = Math.max(0, now() - startedAtRef.current);
    onExplainBackEnd?.({ targetItemId: spec.targetItemId, transcript, durationMs });
  }, [onExplainBackEnd, spec.targetItemId, now]);

  // (2) The visible countdown ticks every second (purely cosmetic). (3) A SEPARATE
  // absolute-deadline timeout closes the window at maxDurationSec — independent of
  // the cosmetic tick so a missed render can never leave the window open forever.
  useEffect(() => {
    const tick = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1_000);
    const deadline = setTimeout(() => close(), spec.maxDurationSec * 1_000);
    return () => {
      clearInterval(tick);
      clearTimeout(deadline);
    };
    // Mount-only window; the spec identity changes via React key on a remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="explain-back" aria-label="Explain-back check" role="group">
      <p className="explain-back__prompt">{spec.promptBody}</p>
      <div className="explain-back__recorder" aria-live="polite">
        <span className="explain-back__indicator" aria-hidden="true">
          ● Recording
        </span>
        <span className="explain-back__countdown" aria-label="seconds remaining">
          {Math.max(0, remaining).toString()}s
        </span>
      </div>
      <button
        type="button"
        className="explain-back__done"
        onClick={close}
        aria-label="Done explaining"
      >
        Done
      </button>
    </section>
  );
}
