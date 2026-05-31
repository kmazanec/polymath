import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { VoiceClient } from './client.js';

export interface AskTutorButtonProps {
  sessionId: string;
  /** Injectable for tests. Defaults to a new VoiceClient built from sessionId. */
  client?: VoiceClient;
  /** Injectable for tests; defaults to global fetch. Used only for the availability
   *  probe (the VoiceClient owns its own fetch for the mint). */
  fetchFn?: typeof fetch;
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
export function AskTutorButton({ sessionId, client: injectedClient, fetchFn }: AskTutorButtonProps): ReactElement {
  // Build the client lazily (once, stable across renders) unless one is injected.
  const [client] = useState<VoiceClient>(() => injectedClient ?? new VoiceClient({ sessionId }));

  // Mirror the client's state into React state so the button re-renders on changes.
  const [voiceState, setVoiceState] = useState<VoiceState>(() => client.state);

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
      maybeSubscribable.onStateChange(() => setVoiceState(client.state));
    }
    setVoiceState(client.state);
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
    })();
  }, [client]);

  // Voice not configured on this deployment → render an honest, non-interactive
  // affordance. No mic prompt, no dead-looking button.
  if (availability === 'unavailable') {
    return (
      <div className="ask-tutor ask-tutor--unavailable">
        {/* aria-label makes the announced name unambiguous without the emoji glyph. */}
        <button
          type="button"
          className="ask-tutor__button"
          disabled
          aria-disabled="true"
          aria-label="Voice tutor unavailable"
        >
          <span aria-hidden="true">🎤</span> Voice tutor unavailable
        </button>
        <span className="ask-tutor__note">
          Voice isn&rsquo;t set up on this deployment — use the text box above to ask the tutor.
        </span>
      </div>
    );
  }

  return (
    <div className="ask-tutor">
      <button
        type="button"
        className="ask-tutor__button"
        onClick={handleClick}
        disabled={availability === 'unknown' || isDisabled(voiceState)}
        data-voice-state={voiceState}
        aria-label={voiceState === 'connected' ? 'End voice session with tutor' : 'Start voice session with tutor'}
      >
        {/* The microphone emoji is decorative — aria-hidden keeps it out of the
            accessible name (the aria-label above is the announced text). */}
        {availability === 'unknown' ? 'Checking voice…' : (
          <><span aria-hidden="true">🎤</span> {labelFor(voiceState)}</>
        )}
      </button>
    </div>
  );
}
