import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { useMachine } from '@xstate/react';
import { lessonMachine } from '@polymath/statechart';
import type { ComponentSpec, Rep, ServerMessage } from '@polymath/contract';
import { AgentSocket } from './ws/client.js';
import { adaptAction } from './ws/actionAdapter.js';
import { AnimateOrNot } from './motion/AnimateOrNot.js';
import { renderComponent, type RepSubmitPayload } from './components/registry.js';
import { transferRepRefusal } from './copy/refusals.js';
import { LESSON_1_INTRO } from './lessonIntroContent.js';
import { AskTutorButton } from './voice/AskTutorButton.js';

type ConnState = 'connecting' | 'open' | 'closed';

const REP_PHRASES: Record<Rep, RegExp> = {
  truth_table: /truth\s*table/i,
  circuit: /\bcircuit\b/i,
  pseudocode: /pseudo\s*code|\bcode\b/i,
};

/** During a transfer probe, any question that *mentions* an active hidden rep is
 *  refused — not just ones with a reveal verb. "What's the truth table for this?"
 *  or "fill the table for me" would leak the held-out rep just as much as "show me
 *  the truth table", so mention alone is the bar (the integrity boundary beats a
 *  few false-refusals on an incidental mention). Returns the mentioned hidden rep,
 *  else null. */
export function wantsHiddenRep(question: string, hiddenReps: readonly Rep[]): Rep | null {
  return hiddenReps.find((rep) => REP_PHRASES[rep].test(question)) ?? null;
}

/** A stable identity for the mounted workspace, used as a React `key` so a new
 *  item remounts fresh (no stale submitted/cells state from the prior item). */
function mountKey(spec: ComponentSpec): string {
  switch (spec.kind) {
    case 'TruthTablePractice':
      return `tt:${spec.expression}`;
    case 'CircuitBuilder':
      return `circuit:${spec.targetExpression}`;
    case 'PseudocodeChallenge':
      return `pseudo:${spec.targetExpression}`;
    case 'TransferProbe':
      return `probe:${spec.itemId}`;
    default:
      return spec.kind;
  }
}

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
  /** The current hint, shown in a side slot — NOT in the main workspace, so the
   *  practice item the learner is solving stays mounted and answerable. */
  const [hint, setHint] = useState<ComponentSpec | null>(null);
  /** The id of the item currently mounted, echoed on submit. */
  const currentItemId = useRef<string>('l1-and');
  /** When the current item was mounted (for the submit's response-time report). */
  const itemMountedAt = useRef<number>(Date.now());
  const socketRef = useRef<AgentSocket | null>(null);
  const [question, setQuestion] = useState('');
  /** The active transfer probe's id + held-out reps, tracked in refs so the WS
   *  message closure reads the current value (not a stale capture). Set when a
   *  TransferProbe mounts; cleared when the phase leaves `transferring`. */
  const currentProbeItemId = useRef<string | null>(null);
  const activeHiddenReps = useRef<Rep[]>([]);
  /** The current phase, mirrored into a ref for the WS closure (the adapter needs
   *  it to enforce the transfer-probe hidden-rep refusal). */
  const phaseRef = useRef<string>('introducing');

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
            const r = adaptAction(msg.action, {
              phase: phaseRef.current,
              hiddenReps: activeHiddenReps.current,
            });
            // A mount refused by the transfer-probe guard is simply dropped — the
            // held-out rep is never revealed (ADR-005 refusal #2).
            if (r.refused) return;
            if (r.lessonEvents) for (const e of r.lessonEvents) send(e);
            if (r.mount) {
              // A HintCard renders in the side hint slot, leaving the practice item
              // mounted (the learner keeps solving). Everything else is the main
              // workspace.
              if (r.mount.kind === 'HintCard') {
                setHint(r.mount);
              } else {
                setMounted(r.mount);
                setHint(null); // a new workspace clears any stale hint
                if (r.mount.kind === 'TransferProbe') {
                  currentProbeItemId.current = r.mount.itemId;
                  activeHiddenReps.current = r.mount.hiddenReps;
                }
              }
            }
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

  // When a new item is mounted, remember its id so a submit can name it, and stamp
  // the mount time so a submit can report how long the learner took (the rule
  // gate's response-time band, ADR-011).
  useEffect(() => {
    if (mounted.kind === 'TruthTablePractice') currentItemId.current = mounted.expression;
    else if (mounted.kind === 'CircuitBuilder' || mounted.kind === 'PseudocodeChallenge') {
      currentItemId.current = mounted.targetExpression;
    }
    itemMountedAt.current = Date.now();
  }, [mounted]);

  const onSubmit = useCallback(
    (payload: RepSubmitPayload): void => {
      if (!sessionId) return;
      // During a transfer probe, the learner's submission is a `transfer_submitted`
      // event (validated server-side against the held-out bank item), not a regular
      // practice `submit`.
      if (mounted.kind === 'TransferProbe' && currentProbeItemId.current) {
        socketRef.current?.send({
          kind: 'transfer_submitted',
          sessionId,
          itemId: currentProbeItemId.current,
          submission: payload.submission,
        });
        return;
      }
      socketRef.current?.send({
        kind: 'submit',
        sessionId,
        itemId: currentItemId.current,
        submission: payload.submission,
        repSubmission: payload.repSubmission,
        correct: payload.correct,
        responseTimeMs: Date.now() - itemMountedAt.current,
      });
    },
    [sessionId, mounted.kind],
  );

  const onAskQuestion = useCallback((): void => {
    const q = question.trim();
    if (!sessionId || q.length === 0) return;
    // ADR-005 refusal #2: during a transfer probe, a request to bring back a
    // held-out rep is refused by the interface itself — even before asking the
    // agent. The learner sees the warm stock refusal, not the hidden rep.
    if (phaseRef.current === 'transferring' && activeHiddenReps.current.length > 0) {
      const asked = wantsHiddenRep(q, activeHiddenReps.current);
      if (asked) {
        setAnswer({
          kind: 'AgentAnswer',
          question: q,
          answer: transferRepRefusal(asked),
          topicClassification: 'on_topic',
        });
        setQuestion('');
        return;
      }
    }
    socketRef.current?.send({ kind: 'learner_question', sessionId, question: q });
    setQuestion('');
  }, [question, sessionId]);

  const onRequestHint = useCallback((): void => {
    if (!sessionId) return;
    socketRef.current?.send({
      kind: 'request_hint',
      sessionId,
      itemId: currentItemId.current,
    });
  }, [sessionId]);

  const phase = currentPhase(snapshot.value);

  // Mirror the phase into a ref for the WS closure, and clear the active probe's
  // held-out reps once we leave the transferring phase (nothing hidden otherwise).
  useEffect(() => {
    phaseRef.current = phase;
    if (phase !== 'transferring') {
      activeHiddenReps.current = [];
      currentProbeItemId.current = null;
    }
  }, [phase]);

  return (
    <main>
      {/* Key the workspace by the mounted item's identity so the agent mounting a
          *new* item of the same kind remounts a fresh component — without the key,
          React reuses the instance and the prior item's submitted/cells state (and
          its disabled submit button) would bleed into the new item, blocking it. */}
      <AnimateOrNot phase={phase}>
        <div key={mountKey(mounted)}>{renderComponent(mounted, { onSubmit })}</div>
      </AnimateOrNot>

      {hint && <aside className="hint-slot">{renderComponent(hint)}</aside>}

      {answer && <div className="agent-answer-slot">{renderComponent(answer)}</div>}

      {(phase === 'practicing' || phase === 'transferring') && (
        <button
          type="button"
          className="hint-button"
          onClick={onRequestHint}
          disabled={conn !== 'open' || phase === 'transferring'}
          aria-label="Request a hint"
          data-phase={phase}
        >
          Hint
        </button>
      )}

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

      {/* The spoken counterpart to the text question form: the mic permission is
          requested only when this is clicked, never at session start. Mounts once
          the session id exists (the token endpoint is session-scoped). */}
      {sessionId && <AskTutorButton sessionId={sessionId} />}

      <p aria-live="polite" data-conn={conn} data-phase={phase}>
        Agent: {conn}
      </p>
    </main>
  );
}
