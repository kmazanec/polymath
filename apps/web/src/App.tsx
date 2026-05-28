import { type ReactElement, useEffect, useRef, useState } from 'react';
import { useMachine } from '@xstate/react';
import { lessonMachine } from '@polymath/statechart';
import type { Action, ServerMessage } from '@polymath/contract';
import { AgentSocket } from './ws/client.js';
import { AnimateOrNot } from './motion/AnimateOrNot.js';
import { renderComponent } from './components/registry.js';
import { LESSON_1_INTRO } from './lessonIntroContent.js';

type ConnState = 'connecting' | 'open' | 'closed';

/** Map the lesson sub-statechart's current state value to the contract PhaseName
 *  the motion wrapper expects. The spine's state ids ARE the PhaseNames. */
function currentPhase(value: unknown): 'introducing' | 'practicing' | 'transferring' {
  if (value === 'practicing' || value === 'transferring') return value;
  return 'introducing';
}

export function App(): ReactElement {
  const [snapshot] = useMachine(lessonMachine, { input: { lessonId: 1 } });
  const [conn, setConn] = useState<ConnState>('connecting');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<Action | null>(null);
  const socketRef = useRef<AgentSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/agent`;

    void fetch('/api/session', { method: 'POST' })
      .then((r) => r.json())
      .then((body: { sessionId: string }) => {
        if (cancelled) return;
        setSessionId(body.sessionId);
        const socket = new AgentSocket(wsUrl, {
          onOpen: () => setConn('open'),
          onClose: () => setConn('closed'),
          onMessage: (msg: ServerMessage) => {
            if (msg.kind === 'action') setLastAction(msg.action);
          },
        });
        socket.connect();
        socketRef.current = socket;
        socket.send({ kind: 'session_start', sessionId: body.sessionId, lessonId: 1 });
      })
      .catch(() => setConn('closed'));

    return () => {
      cancelled = true;
      socketRef.current?.close();
    };
  }, []);

  const onSubmit = (): void => {
    if (!sessionId) return;
    socketRef.current?.send({
      kind: 'submit',
      sessionId,
      itemId: 'l1-and',
      submission: 'A AND B',
    });
  };

  const phase = currentPhase(snapshot.value);

  return (
    <main>
      <AnimateOrNot phase={phase}>{renderComponent(LESSON_1_INTRO)}</AnimateOrNot>
      <p aria-live="polite" data-conn={conn}>
        Agent: {conn}
      </p>
      <button type="button" onClick={onSubmit} disabled={conn !== 'open'}>
        Submit
      </button>
      {lastAction && (
        <p data-last-action={lastAction.type}>
          Agent responded: <code>{lastAction.type}</code>
        </p>
      )}
    </main>
  );
}
