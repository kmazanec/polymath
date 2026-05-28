import { type ReactElement, useCallback, useEffect, useState } from 'react';
import { VoiceClient } from './client.js';

export interface AskTutorButtonProps {
  sessionId: string;
  /** Injectable for tests. Defaults to a new VoiceClient built from sessionId. */
  client?: VoiceClient;
}

type VoiceState = VoiceClient['state'];

function labelFor(state: VoiceState): string {
  switch (state) {
    case 'idle':
      return '🎤 Ask the tutor';
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
 * Microphone permission is requested ONLY on click — never at render/mount.
 */
export function AskTutorButton({ sessionId, client: injectedClient }: AskTutorButtonProps): ReactElement {
  // Build the client lazily (once, stable across renders) unless one is injected.
  const [client] = useState<VoiceClient>(() => injectedClient ?? new VoiceClient({ sessionId }));

  // Mirror the client's state into React state so the button re-renders on changes.
  const [voiceState, setVoiceState] = useState<VoiceState>(() => client.state);

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

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDisabled(voiceState)}
      data-voice-state={voiceState}
      aria-label={voiceState === 'connected' ? 'End voice session with tutor' : 'Start voice session with tutor'}
    >
      {labelFor(voiceState)}
    </button>
  );
}
