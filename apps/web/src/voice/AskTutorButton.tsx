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
    case 'requesting-permission':
      return '🎤 Ask the tutor';
    case 'connecting':
      return 'Connecting…';
    case 'connected':
      return 'Listening…';
    case 'unavailable':
      return 'Voice unavailable';
    case 'error':
      return 'Voice unavailable';
  }
}

function isDisabled(state: VoiceState): boolean {
  return state !== 'idle';
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
  }, [client]);

  const handleClick = useCallback(() => {
    void (async () => {
      await client.start();
      setVoiceState(client.state);
    })();
  }, [client]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDisabled(voiceState)}
      data-voice-state={voiceState}
      aria-label={voiceState === 'connected' ? 'Voice session active' : 'Start voice session with tutor'}
    >
      {labelFor(voiceState)}
    </button>
  );
}
