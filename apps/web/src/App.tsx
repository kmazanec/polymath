import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { useMachine } from '@xstate/react';
import { lessonMachine, type LessonEvent } from '@polymath/statechart';
import type { ComponentSpec, Rep, ServerMessage } from '@polymath/contract';
import { AgentSocket } from './ws/client.js';
import { adaptAction } from './ws/actionAdapter.js';
import { AnimateOrNot } from './motion/AnimateOrNot.js';
import { renderComponent, type RepSubmitPayload } from './components/registry.js';
import { transferRepRefusal } from './copy/refusals.js';
import { introForLesson, LESSON_2_INTRO } from './lessonIntroContent.js';
import { AskTutorButton } from './voice/AskTutorButton.js';
import { AboutSessionData } from './components/AboutSessionData.js';
import { ConsentModal } from './observability/ConsentModal.js';
import { initPostHog, capture, groupBySession } from './observability/posthog.js';

type ConnState = 'connecting' | 'open' | 'closed';

/**
 * F-13 AC#8 dev seam: the lesson the SPA runs, from a `?lesson=2` URL param. Until
 * F-15 lands the earned L1→L2 advance, L2 is reachable ONLY this way — and the
 * SERVER independently gates it (the `?lesson` query is forwarded on the WS upgrade
 * and the agent only honors lesson > 1 when `POLYMATH_ENABLE_TEST_SEAMS` is set and
 * `NODE_ENV!=='production'`). A forged param can't skip L1 in production: the server
 * clamps it to 1. Defaults to 1; anything other than 2 is treated as 1.
 */
function lessonFromUrl(): number {
  const raw = new URLSearchParams(window.location.search).get('lesson');
  return raw === '2' ? 2 : 1;
}

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
    case 'ExplainBackPrompt':
      // Keyed by item + prompt body so a retry re-mount (same item, new stock copy)
      // remounts fresh — a new countdown + recording window, not a stale instance.
      return `explain:${spec.targetItemId}:${spec.promptBody}`;
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

/** The imperative bridge between App (which owns the socket + its message closure)
 *  and the per-lesson `LessonSession` (which owns the XState spine). The session
 *  registers its `send` here on mount so App's stable WS closure can dispatch lesson
 *  events to the *currently mounted* spine — and re-instantiating the session on an
 *  L1→L2 advance swaps the target without App needing a new closure. `setPhase`
 *  lifts the spine's phase up so App can mirror it into `phaseRef` (the transfer
 *  refusal context) and gate the Hint button. */
interface LessonBridge {
  send: ((event: LessonEvent) => void) | null;
  setPhase: (phase: 'introducing' | 'practicing' | 'transferring') => void;
}

/** One lesson's worth of UI: the XState spine + the mounted workspace. App renders
 *  this keyed on the current lessonId, so advancing L1→L2 UNMOUNTS the L1 instance
 *  (whose spine has reached a `final`/`assessed` dead end carrying `lessonId:1`) and
 *  RE-MOUNTS a fresh one with `input.lessonId:2` — the real macro transition the
 *  plan specifies (the locked spine cannot be re-entered from a `final` state, so a
 *  session-level re-instantiation, not a parent machine, is the mechanism). The
 *  fresh spine starts in `introducing` for L2; the server's deterministic L2 mount
 *  then drives it to `practicing`. */
function LessonSession({
  lessonId,
  bridge,
  mounted,
  hint,
  answer,
  conn,
  onSubmit,
  explainBackDeps,
  onExplainBackEnd,
  onContinue,
  onRequestHint,
}: {
  lessonId: number;
  bridge: LessonBridge;
  mounted: ComponentSpec;
  hint: ComponentSpec | null;
  answer: ComponentSpec | null;
  conn: ConnState;
  onSubmit: (payload: RepSubmitPayload) => void;
  explainBackDeps: import('./components/registry.js').RenderOptions['explainBackDeps'];
  onExplainBackEnd: (payload: { targetItemId: string; transcript: string; durationMs: number }) => void;
  onContinue: (nextLessonId: number) => void;
  onRequestHint: () => void;
}): ReactElement {
  const [snapshot, send] = useMachine(lessonMachine, { input: { lessonId } });
  const phase = currentPhase(snapshot.value);

  // Register this spine's dispatcher with App's WS closure, and lift the phase up so
  // App can mirror it into the transfer-refusal ref and gate the Hint button. The
  // register/unregister is keyed on the actor identity so an L1→L2 re-mount swaps the
  // live target cleanly.
  useEffect(() => {
    bridge.send = send;
    return () => {
      if (bridge.send === send) bridge.send = null;
    };
  }, [bridge, send]);
  useEffect(() => {
    bridge.setPhase(phase);
  }, [bridge, phase]);

  return (
    <>
      {/* Key the workspace by the mounted item's identity so the agent mounting a
          *new* item of the same kind remounts a fresh component — without the key,
          React reuses the instance and the prior item's submitted/cells state (and
          its disabled submit button) would bleed into the new item, blocking it. */}
      <AnimateOrNot phase={phase}>
        <div key={mountKey(mounted)}>
          {renderComponent(mounted, { onSubmit, explainBackDeps, onExplainBackEnd, onContinue })}
        </div>
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
    </>
  );
}

export function App(): ReactElement {
  /** The lesson the spine is currently bound to. Bumping it (on an L1→L2 advance)
   *  re-instantiates `LessonSession` — a fresh spine in `introducing` for L2 — which
   *  is the macro transition (AC#2). The INITIAL value comes from F-13's `?lesson=2`
   *  dev seam (`lessonFromUrl()`), so a `?lesson=2` run starts bound to L2; defaults
   *  to L1. It parameterises the spine input, the `session_start` frame, and the
   *  intro. */
  const [lessonId, setLessonId] = useState(lessonFromUrl);
  const [phase, setPhase] = useState<'introducing' | 'practicing' | 'transferring'>('introducing');
  /** The imperative bridge to the active spine (see `LessonBridge`). A stable ref so
   *  App's WS closure dispatches to whichever `LessonSession` is currently mounted. */
  const bridgeRef = useRef<LessonBridge>({ send: null, setPhase });
  const [conn, setConn] = useState<ConnState>('connecting');
  const [sessionId, setSessionId] = useState<string | null>(null);
  /** The component the agent has mounted (the inner loop's output). Starts on the
   *  lesson intro until the first agent `mount` arrives. */
  const [mounted, setMounted] = useState<ComponentSpec>(introForLesson(lessonId));
  /** The agent's most recent answer to a learner question (ADR-003 Q&A). */
  const [answer, setAnswer] = useState<ComponentSpec | null>(null);
  /** The current hint, shown in a side slot — NOT in the main workspace, so the
   *  practice item the learner is solving stays mounted and answerable. */
  const [hint, setHint] = useState<ComponentSpec | null>(null);
  /** F-14: the current cross-lesson recall callout, shown in a side slot (like the
   *  hint) — NOT in the main workspace. The recall is a short, dismissible callout;
   *  the practice item the learner is mid-solving MUST survive it (a workspace
   *  replacement would destroy the in-progress item with no restore path). Dismissing
   *  it simply clears this slot and resumes the practice flow at the same item (AC#3). */
  const [recall, setRecall] = useState<ComponentSpec | null>(null);
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

  /** Analytics consent gate (AC#2/#7). `null` = undecided (the modal is showing);
   *  `true`/`false` = the learner's explicit choice. PostHog stays uninitialized — a
   *  complete no-op — until this is `true` AND the build carries both PostHog env vars,
   *  so analytics + session replay are OFF by default and ON only for an opted-in
   *  subject. */
  const [analyticsConsent, setAnalyticsConsent] = useState<boolean | null>(null);

  const onAcceptAnalytics = useCallback((): void => {
    setAnalyticsConsent(true);
    // Init is fail-closed: a partial/absent VITE_POSTHOG_* config makes this a no-op
    // even with consent (no key/host inlined into the bundle → analytics simply off).
    void initPostHog({
      key: import.meta.env.VITE_POSTHOG_KEY ?? '',
      host: import.meta.env.VITE_POSTHOG_HOST ?? '',
      consent: true,
    });
  }, []);

  const onDeclineAnalytics = useCallback((): void => {
    setAnalyticsConsent(false); // PostHog never initialized — stays a no-op for the session
  }, []);

  useEffect(() => {
    let cancelled = false;
    // F-13 AC#8: forward `?lesson=2` on the WS upgrade so the server's dev seam can
    // honor an L2 binding (it stays inert unless POLYMATH_ENABLE_TEST_SEAMS is set and
    // NODE_ENV!=='production'). Omitted for the default L1 run.
    const lessonQuery = lessonId === 2 ? '?lesson=2' : '';
    const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/agent${lessonQuery}`;

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
            socket.send({ kind: 'session_start', sessionId: body.sessionId, lessonId });
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
            // Dispatch lesson events to the CURRENTLY mounted spine via the bridge.
            // After an L1→L2 advance this is the freshly re-instantiated L2 spine —
            // App keeps one stable WS closure across the re-instantiation.
            if (r.lessonEvents) for (const e of r.lessonEvents) bridgeRef.current.send?.(e);
            if (r.mount) {
              // A HintCard renders in the side hint slot, leaving the practice item
              // mounted (the learner keeps solving). A CrossLessonRecall is likewise a
              // non-destructive side callout — it must NOT clobber the in-progress
              // practice item (the spec's "short callout the learner dismisses before
              // continuing", not a workspace replacement). Everything else is the main
              // workspace.
              if (r.mount.kind === 'HintCard') {
                setHint(r.mount);
              } else if (r.mount.kind === 'CrossLessonRecall') {
                setRecall(r.mount);
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
    // The socket lives for App's lifetime and routes lesson events to whichever
    // `LessonSession` is mounted (via the stable `bridgeRef`), so it has no reactive
    // deps — re-instantiating the L2 spine must NOT tear down the session socket
    // (that would mint/re-announce and break F-14's cross-lesson recall).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Associate analytics events with the session group (ADR-006: group key = sessionId)
  // once both are known. A no-op when PostHog is inactive (declined/unconfigured).
  useEffect(() => {
    if (analyticsConsent === true && sessionId) groupBySession(sessionId);
  }, [analyticsConsent, sessionId]);

  // UI-MOUNT TELEMETRY (AC#3, AC#6). Fire once per mounted workspace component:
  //  - the `ui_mount` WS beacon (the AGENT-SIDE churn source the observability endpoint
  //    folds — works with ZERO external keys, the headline counter-metric), and
  //  - the PostHog `mount` event (the redundant product-analytics view; a clean no-op
  //    when analytics are off).
  // Keyed on the stable `mountKey` so it fires on a genuinely new item, not a re-render.
  // Side slots (hint/recall/answer) have their own events; this tracks the workspace.
  const lastBeaconedMount = useRef<string>('');
  useEffect(() => {
    if (!sessionId) return;
    const key = mountKey(mounted);
    if (key === lastBeaconedMount.current) return;
    lastBeaconedMount.current = key;
    socketRef.current?.send({
      kind: 'ui_mount',
      sessionId,
      componentKind: mounted.kind,
      phase: phaseRef.current,
    });
    capture('mount', { componentKind: mounted.kind, phase: phaseRef.current });
    // The mastery celebration is the `mastery_declared` analytics signal (AC: mastery
    // transition). It mounts as the workspace component on the gate-clearing turn.
    if (mounted.kind === 'MasteryCelebration') {
      capture('mastery_declared', { lessonId });
    }
  }, [mounted, sessionId, lessonId]);

  // TRANSFER-PROBE entry/exit analytics. The probe is the `transferring` phase; emit
  // exactly on the boundary crossing (a no-op when analytics are off).
  const prevPhase = useRef<string>('introducing');
  useEffect(() => {
    const was = prevPhase.current;
    prevPhase.current = phase;
    if (was === phase) return;
    if (phase === 'transferring') capture('transfer_probe_entered', {});
    else if (was === 'transferring') capture('transfer_probe_exited', {});
  }, [phase]);

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

  // F-14 AC#3: dismissing the recall callout clears the side slot and resumes the
  // practice flow at the SAME in-progress item — which is still mounted in the main
  // workspace because the recall never replaced it. The recall is server-throttled to
  // ≤1 per session per KC, so there is nothing to re-request; clearing the slot is the
  // resume. (Argument is the recall's `currentItemId`, unused here but kept so the
  // callback matches `RenderOptions.onCrossLessonRecallDismiss` and a future flow that
  // needs to re-request an item can use it.)
  const onCrossLessonRecallDismiss = useCallback((_currentItemId: string): void => {
    setRecall(null);
  }, []);

  const onRequestHint = useCallback((): void => {
    if (!sessionId) return;
    socketRef.current?.send({
      kind: 'request_hint',
      sessionId,
      itemId: currentItemId.current,
    });
    capture('hint_request', { itemId: currentItemId.current }); // no-op when analytics off
  }, [sessionId]);

  // F-11: when the explain-back window closes, dispatch the completion signal to
  // the server (the deterministic reflex's input). Per the approved design the
  // learner's transcript + prosody arrive SERVER-SIDE via the F-10 WebRTC bridge;
  // the client sends the bare completion signal + measured durationMs (the server
  // CLAMPS the window regardless, AC#9). An empty transcript here means "no
  // client-side capture" — the server-side bridge/preconditions decide, fail closed.
  const onExplainBackEnd = useCallback(
    (payload: { targetItemId: string; transcript: string; durationMs: number }): void => {
      if (!sessionId) return;
      socketRef.current?.send({
        kind: 'explain_back_recording_ended',
        sessionId,
        targetItemId: payload.targetItemId,
        transcript: payload.transcript,
        durationMs: payload.durationMs,
      });
    },
    [sessionId],
  );

  // F-15: the "continue to Lesson 2" handler. The macro L1→L2 transition has two
  // halves that must BOTH fire:
  //  (1) SERVER reflex — send a single `advance_lesson` event on the SAME session
  //      (never minting a new one — that would silently zero F-14's cross-lesson
  //      recall); the server re-derives L1 mastery (the earned-it guard) and
  //      DETERMINISTICALLY mounts L2's first item (~<500ms). That L2 mount arrives as
  //      the next `action` over this socket and re-fills the workspace. `socketRef`
  //      stays in App so this routes to the active socket without a stale closure.
  //  (2) CLIENT re-instantiation (AC#2) — bump `lessonId`, which re-keys
  //      `LessonSession` so React unmounts the L1 spine (now at a `final`/dead-end
  //      state carrying `lessonId:1`) and re-mounts a FRESH spine with
  //      `input.lessonId:2`, starting in `introducing`. The locked spine has no edge
  //      back out of `mastered`, so a re-instantiation — not a parent machine — is the
  //      mechanism (the statechart re-instantiation-parity test proves the L2 actor
  //      walks introducing→practicing→mastered identically). Without (2) the spine is
  //      stuck where L1 left it and AC#2 ("transitions to lesson_2.introducing") is
  //      false on the client.
  // The durable lesson-arc record lives server-side in `sessions.lessonProgress`.
  //
  // NOTE (convergence with F-13/F-14): the server-side lesson binding lives in
  // server.ts (handleAdvanceLessonTurn).
  const onContinue = useCallback(
    (nextLessonId: number): void => {
      if (!sessionId) return;
      socketRef.current?.send({ kind: 'advance_lesson', sessionId, toLessonId: nextLessonId });
      capture('lesson_transition', { toLessonId: nextLessonId }); // no-op when analytics off
      // Reset the mounted workspace + side slots to a clean intro for the new lesson
      // (the server's L2 first-item mount lands next), then re-instantiate the spine.
      setMounted(LESSON_2_INTRO);
      setHint(null);
      setAnswer(null);
      setLessonId(nextLessonId);
    },
    [sessionId],
  );

  // F-11: the TTS seam for the explain-back prompt (the ~3s read). Best-effort via
  // the Web Speech API; wrapped so an unavailable/throwing synth (iOS Safari quirk)
  // degrades silently — the recording window still opens. The WebRTC-bridge capture
  // is server-side; the client recorder yields '' (the server is the truth-maker).
  const explainBackDeps = useRef<import('./components/registry.js').RenderOptions['explainBackDeps']>({
    speak: (text: string) => {
      try {
        const synth = globalThis.speechSynthesis;
        if (!synth) return;
        synth.cancel();
        synth.speak(new SpeechSynthesisUtterance(text));
      } catch {
        // iOS-Safari / unavailable synth — degrade silently.
      }
    },
    startRecording: () => () => '', // server-side bridge captures the transcript
  }).current;

  // Mirror the phase into a ref for the WS closure, and clear the active probe's
  // held-out reps once we leave the transferring phase (nothing hidden otherwise).
  // `phase` is lifted from the active `LessonSession` spine via `setPhase`.
  useEffect(() => {
    phaseRef.current = phase;
    if (phase !== 'transferring') {
      activeHiddenReps.current = [];
      currentProbeItemId.current = null;
    }
  }, [phase]);

  return (
    <main>
      {/* Analytics opt-in (AC#2/#7): shown once at session start while consent is
          undecided. PostHog is never initialized until the learner clicks Accept, so
          analytics + session replay are OFF by default; declining leaves them off for
          the session. The modal blocks nothing else — the lesson renders behind it. */}
      {analyticsConsent === null && (
        <ConsentModal onAccept={onAcceptAnalytics} onDecline={onDeclineAnalytics} />
      )}
      {/* Key the lesson session by the current `lessonId` so an L1→L2 advance
          unmounts the L1 spine (a `final`/dead-end state) and re-mounts a FRESH spine
          for L2 in `introducing` — the macro transition (AC#2). The session owns the
          XState spine + the mounted workspace; App owns the socket + per-lesson UI
          state and routes lesson events down via the stable `bridgeRef`. */}
      <LessonSession
        key={lessonId}
        lessonId={lessonId}
        bridge={bridgeRef.current}
        mounted={mounted}
        hint={hint}
        answer={answer}
        conn={conn}
        onSubmit={onSubmit}
        explainBackDeps={explainBackDeps}
        onExplainBackEnd={onExplainBackEnd}
        onContinue={onContinue}
        onRequestHint={onRequestHint}
      />

      {/* F-14: the cross-lesson recall callout, in its own App-level side slot —
          BESIDE the keyed `LessonSession`, not inside it — so the in-progress practice
          item (the session's main workspace) survives, AND the callout survives the
          L1→L2 re-instantiation (it is owned by App, which keeps one session socket for
          its lifetime). Dismissing it clears the slot and resumes the practice flow at
          that same item (AC#3). */}
      {recall && (
        <aside className="recall-slot">
          {renderComponent(recall, { onCrossLessonRecallDismiss })}
        </aside>
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

      {/* The route-independent privacy/accessibility affordance (ADR-012). Mounted
          in App's <main> so it survives every route + the L1->L2 re-instantiation;
          lift to a shared layout when the routes converge. */}
      <footer className="app-footer">
        <AboutSessionData />
      </footer>
    </main>
  );
}
