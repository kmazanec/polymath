import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { VoiceClient } from './client.js';
import { MicLevelMeter } from './MicLevelMeter.js';
import { ActivityGlyph, activityAnnouncement } from './ActivityGlyph.js';

/** The conversational voice activity state, driven by transcript_stream events
 *  (ADR-018). Only meaningful while the voice session is connected. */
export type VoiceActivity = 'listening' | 'thinking' | 'agent-speaking';

export interface AskTutorButtonProps {
  sessionId: string;
  /** Injectable for tests. Defaults to a new VoiceClient built from sessionId. */
  client?: VoiceClient;
  /** Injectable for tests; defaults to global fetch. Used only for the availability
   *  probe (the VoiceClient owns its own fetch for the mint). */
  fetchFn?: typeof fetch;
  /** The current conversational activity while connected (ADR-018). Optional —
   *  absent when not connected or when the caller doesn't track voice activity.
   *  Reflected on the button as `data-voice-activity` so CSS can style each state.
   *  Does NOT affect interactive behaviour — display only. */
  activity?: VoiceActivity;
}

type VoiceState = VoiceClient['state'];

/** Whether voice is configured on this deployment, resolved by the availability
 *  probe. `unknown` while the probe is in flight; `false` is the honest
 *  fail-closed default if the probe errors. */
type Availability = 'unknown' | 'available' | 'unavailable';

/** Text-only labels for the button (no emoji — the emoji is injected as a
 *  separate aria-hidden span so screen readers don't announce "microphone"). */
function labelFor(state: VoiceState): string {
  switch (state) {
    case 'idle':
      return 'Ask the tutor';
    case 'requesting-permission':
      return 'Connecting…';
    case 'connecting':
      return 'Connecting…';
    case 'connected':
      return 'End voice session';
    case 'unavailable':
      return 'Voice unavailable';
    case 'error':
      return 'Voice unavailable';
  }
}

/** The button is actionable when idle (start) or connected (stop); the transient
 *  connecting states and the terminal unavailable/error states are disabled. */
function isDisabled(state: VoiceState): boolean {
  return state !== 'idle' && state !== 'connected';
}

/**
 * A button that lets the learner start a voice session with the tutor.
 *
 * Microphone permission is requested ONLY on click — never at render/mount — AND
 * never at all when voice is not configured on this deployment. On mount we probe
 * `/api/realtime/availability` (a side-effect-free check that mints nothing); if
 * voice isn't configured we render an honest, explicitly-disabled affordance with a
 * short explanation instead of a live-looking button that prompts for the mic and
 * then silently dies on the 503. This is the degraded-state fix: the prior button
 * looked clickable, asked for the mic, then flattened to "Voice unavailable" with no
 * reason — which read as "the button does nothing".
 */
export function AskTutorButton({ sessionId, client: injectedClient, fetchFn, activity }: AskTutorButtonProps): ReactElement {
  // Build the client lazily (once, stable across renders) unless one is injected.
  const [client] = useState<VoiceClient>(() => injectedClient ?? new VoiceClient({ sessionId }));

  // Mirror the client's state into React state so the button re-renders on changes.
  const [voiceState, setVoiceState] = useState<VoiceState>(() => client.state);

  // Track the live mic stream so MicLevelMeter receives the real stream when
  // connected and null otherwise. Polled from client.stream after state changes —
  // same cadence as setVoiceState (both update in the same callback).
  const [micStream, setMicStream] = useState<MediaStream | null>(() => client.stream);

  // Whether voice is configured on this deployment (probed on mount). Until known we
  // render a neutral "checking" disabled button so we never prompt the mic blindly.
  const [availability, setAvailability] = useState<Availability>('unknown');

  const doFetch = useRef(fetchFn ?? globalThis.fetch.bind(globalThis));

  // Probe availability once on mount. An injected test client implies the test is
  // exercising the live path, so we still probe via the injectable fetch (tests can
  // stub it); if the probe is absent/throws we fail closed to 'unavailable'.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await doFetch.current('/api/realtime/availability');
        if (cancelled) return;
        if (res.ok) {
          const body = (await res.json()) as { available?: boolean };
          setAvailability(body.available ? 'available' : 'unavailable');
        } else {
          setAvailability('unavailable');
        }
      } catch {
        if (!cancelled) setAvailability('unavailable');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Sync React state whenever the client's state property changes. The client
  // doesn't emit events, so we poll via a lightweight wrapper: we call
  // setVoiceState after each async operation initiated by this component. For
  // injected test clients that expose onStateChange, we also subscribe.
  useEffect(() => {
    // Support test clients that expose onStateChange.
    const maybeSubscribable = client as unknown as { onStateChange?: (fn: () => void) => void };
    if (typeof maybeSubscribable.onStateChange === 'function') {
      maybeSubscribable.onStateChange(() => {
        setVoiceState(client.state);
        setMicStream(client.stream);
      });
    }
    setVoiceState(client.state);
    setMicStream(client.stream);
    // Tear the session down on unmount: stop the mic and the token refresher so
    // navigating away from the lesson can't leave a hot mic or a minting loop
    // running. stop() is idle-safe (a no-op if voice was never started).
    return () => {
      void client.stop();
    };
  }, [client]);

  const handleClick = useCallback(() => {
    void (async () => {
      // Toggle: start a session from idle, end it when connected. This is the only
      // in-UI way to stop voice — without it the learner could only end by
      // navigating away (unmount cleanup).
      if (client.state === 'connected') {
        await client.stop();
      } else {
        await client.start();
      }
      setVoiceState(client.state);
      setMicStream(client.stream);
    })();
  }, [client]);

  // Only expose data-voice-activity while connected; absent in all other states
  // so CSS can key cleanly on the attribute's presence (ADR-018).
  const isConnected = voiceState === 'connected';
  const activeActivity = isConnected && activity !== undefined ? activity : undefined;
  const isUnavailable = availability === 'unavailable';

  // All render branches share a single <div className="ask-tutor ..."><button> DOM
  // structure so that React reconciles the same node across availability transitions.
  // A split return (early `if`) would replace the button element on transition, making
  // any captured DOM reference stale. Shared structure keeps the reference alive.
  return (
    <div className={`ask-tutor${isUnavailable ? ' ask-tutor--unavailable' : ''}`}>
      {/* aria-live region: announces activity changes to screen readers without
          relying on aria-label alone (which is only re-announced on focus, not on
          prop change). polite so it doesn't interrupt the transcript region.
          ADR-016 / ADR-018 / WCAG 4.1.3. */}
      {isConnected && activity !== undefined && (
        <span className="visually-hidden" aria-live="polite" aria-atomic="true">
          {activityAnnouncement(activity)}
        </span>
      )}
      <button
        type="button"
        className="ask-tutor__button"
        onClick={isUnavailable ? undefined : handleClick}
        disabled={isUnavailable || availability === 'unknown' || isDisabled(voiceState)}
        {...(isUnavailable ? { 'aria-disabled': 'true' as const } : {})}
        data-voice-state={isUnavailable ? undefined : voiceState}
        {...(activeActivity !== undefined ? { 'data-voice-activity': activeActivity } : {})}
        aria-label={
          isUnavailable ? 'Voice tutor unavailable'
          : voiceState === 'connected' ? 'End voice session with tutor'
          : 'Start voice session with tutor'
        }
      >
        {/* Button content varies by state:
            - unavailable: emoji + explanatory text
            - unknown (probing): "Checking voice…"
            - connected + active: per-state SVG glyph (distinct shape, inherits
              currentColor, survives reduced-motion — ADR-004/WCAG 1.4.1)
            - otherwise: emoji + label text
            The emoji is aria-hidden; the button's aria-label is the announced name. */}
        {isUnavailable ? (
          <><span aria-hidden="true">🎤</span> Voice tutor unavailable</>
        ) : availability === 'unknown' ? 'Checking voice…' : (
          activeActivity !== undefined
            ? <ActivityGlyph activity={activeActivity} />
            : <><span aria-hidden="true">🎤</span> {labelFor(voiceState)}</>
        )}
      </button>
      {/* Explanation note — only shown (visible) when unavailable; hidden otherwise
          by CSS (.ask-tutor__note { display: none } in the non-unavailable case). */}
      {isUnavailable && (
        <span className="ask-tutor__note">
          Voice isn&rsquo;t set up on this deployment — use the text box above to ask the tutor.
        </span>
      )}
      {/* Live mic level meter — only rendered while connected and a stream is available.
          Gives the learner visual proof that audio is being captured (ADR-018). */}
      {isConnected && <MicLevelMeter stream={micStream} />}
    </div>
  );
}
