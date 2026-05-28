import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { useMachine } from '@xstate/react';
import { lessonMachine } from '@polymath/statechart';
import type { ComponentSpec, ServerMessage } from '@polymath/contract';
import { AgentSocket } from './ws/client.js';
import { adaptAction } from './ws/actionAdapter.js';
import { AnimateOrNot } from './motion/AnimateOrNot.js';
import { renderComponent, type RepSubmitPayload } from './components/registry.js';
import { LESSON_1_INTRO } from './lessonIntroContent.js';

type ConnState = 'connecting' | 'open' | 'closed';

/** Map the lesson sub-statechart's current state value to the contract PhaseName
 *  the motion wrapper expects. The spine's state ids ARE the PhaseNames. */
function currentPhase(value: unknown): 'introducing' | 'practicing' | 'transferring' {
  if (value === 'practicing' || value === 'transferring') return value;
  return 'introducing';
}

export function App(): ReactElement {
  const [snapshot, send] = useMachine(lessonMachine, { input: { lessonId: 1 } });
  const [conn, setConn] = useState<ConnState>('connecting');
  const [sessionId, setSessionId] = useState<string | null>(null);
  /** The component the agent has mounted (the inner loop's output). Starts on the
   *  lesson intro until the first agent `mount` arrives. */
  const [mounted, setMounted] = useState<ComponentSpec>(LESSON_1_INTRO);
  /** The agent's most recent answer to a learner question (ADR-003 Q&A). */
  const [answer, setAnswer] = useState<ComponentSpec | null>(null);
  /** The id of the item currently mounted, echoed on submit. */
  const currentItemId = useRef<string>('l1-and');
  const socketRef = useRef<AgentSocket | null>(null);
  const [question, setQuestion] = useState('');

  useEffect(() => {
    let cancelled = false;
    const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/agent`;

    void fetch('/api/session', { method: 'POST' })
      .then((r) => r.json())
      .then((body: { sessionId: string }) => {
        if (cancelled) return;
        setSessionId(body.sessionId);
        const socket = new AgentSocket(wsUrl, {
          // Send session_start once the socket is OPEN — sending it synchronously
          // after connect() would be dropped (the socket is still CONNECTING). On
          // a reconnect this re-announces the session, which is harmless.
          onOpen: () => {
            setConn('open');
            socket.send({ kind: 'session_start', sessionId: body.sessionId, lessonId: 1 });
          },
          onClose: () => setConn('closed'),
          onMessage: (msg: ServerMessage) => {
            if (msg.kind !== 'action') return;
            const r = adaptAction(msg.action);
            if (r.lessonEvent) send(r.lessonEvent);
            if (r.mount) setMounted(r.mount);
            if (r.answer) {
              setAnswer({
                kind: 'AgentAnswer',
                question: r.answer.question,
                answer: r.answer.answer,
                topicClassification: r.answer.topicClassification,
              });
            }
          },
        });
        socket.connect();
        socketRef.current = socket;
      })
      .catch(() => setConn('closed'));

    return () => {
      cancelled = true;
      socketRef.current?.close();
    };
  }, [send]);

  // When a new item is mounted, remember its id so a submit can name it. Only the
  // item-generating specs carry an itemId concept; we derive a stable id from the
  // expression (the lesson loader's items are keyed by expression too).
  useEffect(() => {
    if (mounted.kind === 'TruthTablePractice') currentItemId.current = mounted.expression;
    else if (mounted.kind === 'CircuitBuilder' || mounted.kind === 'PseudocodeChallenge') {
      currentItemId.current = mounted.targetExpression;
    }
  }, [mounted]);

  const onSubmit = useCallback(
    (payload: RepSubmitPayload): void => {
      if (!sessionId) return;
      socketRef.current?.send({
        kind: 'submit',
        sessionId,
        itemId: currentItemId.current,
        submission: payload.submission,
        repSubmission: payload.repSubmission,
      });
    },
    [sessionId],
  );

  const onAskQuestion = useCallback((): void => {
    const q = question.trim();
    if (!sessionId || q.length === 0) return;
    socketRef.current?.send({ kind: 'learner_question', sessionId, question: q });
    setQuestion('');
  }, [question, sessionId]);

  const phase = currentPhase(snapshot.value);

  return (
    <main>
      <AnimateOrNot phase={phase}>{renderComponent(mounted, { onSubmit })}</AnimateOrNot>

      {answer && <div className="agent-answer-slot">{renderComponent(answer)}</div>}

      <form
        className="ask-agent"
        onSubmit={(e) => {
          e.preventDefault();
          onAskQuestion();
        }}
      >
        <label htmlFor="ask-agent-input">Ask the tutor a question</label>
        <input
          id="ask-agent-input"
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={conn !== 'open'}
          placeholder="e.g. what does an AND gate do?"
        />
        <button type="submit" disabled={conn !== 'open' || question.trim().length === 0}>
          Ask
        </button>
      </form>

      <p aria-live="polite" data-conn={conn} data-phase={phase}>
        Agent: {conn}
      </p>
    </main>
  );
}
