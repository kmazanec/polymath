import { type ReactElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMachine } from '@xstate/react';
import { lessonMachine, type LessonEvent } from '@polymath/statechart';
import type { PhaseName } from '@polymath/contract';
import type { ComponentSpec, Rep, ServerMessage } from '@polymath/contract';
import { AgentSocket } from './ws/client.js';
import { adaptAction } from './ws/actionAdapter.js';
import { AnimateOrNot } from './motion/AnimateOrNot.js';
import { renderComponent, type RepSubmitPayload } from './components/registry.js';
import type {
  PlaygroundSubmitPayload,
  PlaygroundRequestScaffoldPayload,
} from './components/PlaygroundCanvas.js';
import { TranscriptLog } from './components/TranscriptLog.js';
import { transferRepRefusal } from './copy/refusals.js';
import { introForLesson } from './lessonIntroContent.js';
import { AskTutorButton, type VoiceActivity } from './voice/AskTutorButton.js';
import { AboutSessionData } from './components/AboutSessionData.js';
import { ConsentModal } from './observability/ConsentModal.js';
import { initPostHog, capture, groupBySession } from './observability/posthog.js';
import {
  IntelligibilityCheck,
  shouldSampleIntelligibility,
  type IntelligibilityAnswer,
} from './components/IntelligibilityCheck.js';
import { HandoffButton } from './components/HandoffButton.js';
import {
  type SurfaceState,
  type Turn,
  applyMount,
  appendVerdict,
  appendSpokenTurn,
} from './surfaceState.js';
import { FlowSkeleton } from './components/FlowSkeleton.js';

type ConnState = 'connecting' | 'open' | 'closed';
type AnalyticsConsent = boolean | null;

const ANALYTICS_CONSENT_STORAGE_KEY = 'polymath.analyticsConsent.v1';

function readStoredAnalyticsConsent(): AnalyticsConsent {
  try {
    const raw = window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY);
    if (raw === 'accepted') return true;
    if (raw === 'declined') return false;
  } catch {
    // Storage can be unavailable in private browsing or blocked contexts.
  }
  return null;
}

function writeStoredAnalyticsConsent(consent: boolean): void {
  try {
    window.localStorage.setItem(
      ANALYTICS_CONSENT_STORAGE_KEY,
      consent ? 'accepted' : 'declined',
    );
  } catch {
    // Keep the in-memory choice for this session even if persistence is unavailable.
  }
}

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
  if (raw === '2') return 2;
  if (raw === '3') return 3;
  return 1;
}

function startRepFromUrl(): Rep | null {
  const raw = new URLSearchParams(window.location.search).get('rep');
  if (raw === 'truth_table' || raw === 'circuit' || raw === 'pseudocode') return raw;
  return null;
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
  const promptKey = 'prompt' in spec && spec.prompt ? `:${spec.prompt}` : '';
  switch (spec.kind) {
    case 'TruthTablePractice':
      return `tt:${spec.expression}${promptKey}`;
    case 'CircuitBuilder':
      return `circuit:${spec.targetExpression}${promptKey}`;
    case 'PseudocodeChallenge':
      return `pseudo:${spec.targetExpression}${promptKey}`;
    case 'TransferProbe':
      return `probe:${spec.itemId}${promptKey}`;
    case 'ExplainBackPrompt':
      return `explain:${spec.targetItemId}:${spec.promptBody}`;
    default:
      return spec.kind;
  }
}

/**
 * Whether the pinned live workspace should carry the "Active now" marker.
 * Full-screen overlay specs (celebration, explain-back, playground) OWN the
 * surface — there is no scrolling history beside them to distinguish from, so
 * a marker would be noise. Every other spec (practice items, probes, intros,
 * worked examples) is a turn in the thread and benefits from being labelled as
 * the live focus once there's history above it.
 */
function showsActiveMarker(spec: ComponentSpec): boolean {
  switch (spec.kind) {
    case 'MasteryCelebration':
    case 'ExplainBackPrompt':
    case 'PlaygroundCanvas':
      return false;
    default:
      return true;
  }
}

/**
 * F-27 (D7): Widen the phase collapse from 3 narrow → full PhaseName, so the
 * reserved left-rail slot (F-31) and the orientation banner can show all 7
 * phases.  The spine's state ids ARE the PhaseNames.
 */
function currentPhase(value: unknown): PhaseName {
  const VALID: ReadonlySet<string> = new Set([
    'introducing', 'practicing', 'transferring',
    'hint', 'assessed', 'mastered', 'remediating',
  ]);
  if (typeof value === 'string' && VALID.has(value)) return value as PhaseName;
  return 'introducing';
}

/**
 * F-27 (AC#5): learner-facing orientation banner text per phase.
 * During `transferring` it makes clear hints are withheld.
 */
function orientationText(phase: PhaseName): string {
  switch (phase) {
    case 'introducing': return 'Learning new concepts';
    case 'practicing':  return 'Practicing — hints are available';
    case 'hint':        return 'Receiving a hint';
    case 'transferring': return 'Assessment — no hints in this section';
    case 'assessed':    return 'Assessment complete';
    case 'mastered':    return 'Lesson mastered!';
    case 'remediating': return 'Extra practice';
  }
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
  setPhase: (phase: PhaseName) => void;
}

/** One lesson's worth of UI: the XState spine + the mounted workspace.
 *  F-27: receives the transcript `turns` + `appendTurn` seam for F-30.
 *  F-31: receives the lifted `phase` prop so FlowSkeleton can render in the
 *  reserved left-rail slot without needing its own useMachine call. */
/** An in-progress spoken turn — held OUTSIDE the append-only transcript array
 *  so interim ASR partials never mutate durable history. The latest partial for
 *  a speaker replaces any prior one; `null` means no turn is in flight. */
type InterimTurn = { speaker: 'learner' | 'agent'; text: string } | null;

function LessonSession({
  lessonId,
  bridge,
  surface,
  interim,
  conn,
  awaitingAgent,
  onSubmit,
  explainBackDeps,
  onExplainBackEnd,
  onContinue,
  onRequestHint,
  onTryPlayground,
  onAdvanceIntro,
}: {
  lessonId: number;
  bridge: LessonBridge;
  surface: SurfaceState;
  /** Ephemeral in-progress spoken turn for the streaming transcript bubble.
   *  Kept separate from the durable transcript array (ADR-018). */
  interim: InterimTurn;
  conn: ConnState;
  awaitingAgent: boolean;
  onSubmit: (payload: RepSubmitPayload) => void;
  explainBackDeps: import('./components/registry.js').RenderOptions['explainBackDeps'];
  onExplainBackEnd: (payload: { targetItemId: string; transcript: string; durationMs: number }) => void;
  onContinue: (nextLessonId: number) => void;
  onRequestHint: () => void;
  onTryPlayground: () => void;
  /** F-27: sends `intro_advance` to deterministically advance the opening sequence. */
  onAdvanceIntro: () => void;
}): ReactElement {
  const [snapshot, send] = useMachine(lessonMachine, { input: { lessonId } });
  const phase = currentPhase(snapshot.value);

  useEffect(() => {
    bridge.send = send;
    return () => {
      if (bridge.send === send) bridge.send = null;
    };
  }, [bridge, send]);
  useEffect(() => {
    bridge.setPhase(phase);
  }, [bridge, phase]);

  const mounted = surface.mounted;
  const mountSeq = surface.mountSeq;
  const transcript = surface.transcript;

  // B3: auto-scroll the thread to the live workspace when a new card mounts.
  // On iPad the learner otherwise lands at the TOP (oldest card) and has to
  // manually scroll past all history to reach the live item + Submit/Continue.
  // Keyed on the re-anchor signal (mountSeq) + transcript length so it fires on
  // EACH new item (and after side turns grow the log), not on every re-render —
  // so it never fights the user mid-scroll on an idle re-render. Respects
  // prefers-reduced-motion (instant jump instead of a smooth animation).
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const prefersReduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior: ScrollBehavior = prefersReduced ? 'auto' : 'smooth';
    // Prefer bringing the live workspace into view; fall back to scrolling the
    // container to its foot (the workspace is anchored there). Both APIs are
    // feature-detected so a non-DOM env (jsdom) degrades to a no-op.
    const ws = workspaceRef.current;
    if (ws && typeof ws.scrollIntoView === 'function') {
      ws.scrollIntoView({ behavior, block: 'end' });
    } else if (typeof scroller.scrollTo === 'function') {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior });
    } else {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [mountSeq, transcript.length]);

  return (
    <div className="thread">
      {/* F-31 FlowSkeleton — slim glanceable progress stepper across the top.
          aria-hidden is removed (the skeleton IS orientation content). */}
      <div className="thread__stepper">
        <FlowSkeleton phase={phase} />
      </div>

      {/* THE CONVERSATION — one single-threaded vertical stream. Past turns scroll
          up; the live workspace is anchored at the foot, just above the composer. */}
      <div className="thread__scroll" ref={scrollRef}>
        <div className="thread__inner">
          {/* F-27 (AC#5): orientation banner — what mode the learner is in. Pinned to the
              top of the thread; the test queries it by data-testid/data-phase. */}
          <div className="orientation-banner" data-phase={phase} data-testid="orientation-banner">
            <span className="orientation-banner__pip" aria-hidden="true" />
            <span className="orientation-banner__text">{orientationText(phase)}</span>
          </div>

          {/* TRANSCRIPT — append-only ordered log, ABOVE the live item in one thread. */}
          <TranscriptLog turns={transcript} />

          {/* STREAMING INTERIM BUBBLE — one in-progress spoken turn, rendered OUTSIDE
              the transcript array so the append-only log is never mutated mid-stream.
              Replaced on each ASR partial; committed (and cleared) on `final:true`.
              aria-live="polite" announces the latest text without interrupting the
              learner (ADR-018). */}
          {interim && (
            <div
              className={`transcript-turn transcript-turn--spoken transcript-spoken--${interim.speaker} transcript-turn--partial`}
              aria-live="polite"
              aria-label={`${interim.speaker === 'learner' ? 'You are saying' : 'Tutor is saying'}: ${interim.text}`}
            >
              <span className="spoken-speaker">{interim.speaker === 'learner' ? 'You' : 'Tutor'}</span>
              <span className="spoken-text">{interim.text}</span>
            </div>
          )}

          {/* "ACTIVE NOW" marker — only once there's history scrolled above, so the
              pinned card at the foot reads as the LIVE focus (the thing to act on),
              not a repeat of a card already in the log. Hidden for full-screen
              overlay specs that own the surface and for the very first card (no
              history yet). */}
          {transcript.length > 0 && showsActiveMarker(mounted) && (
            <div className="thread__active-marker" aria-hidden="true">
              <span className="thread__active-marker-pip" />
              <span className="thread__active-marker-label">Active now</span>
            </div>
          )}

          {/* THE LIVE TURN — the current concept / practice item / probe, anchored at
              the foot of the conversation where the learner acts. */}
          <div className="thread__live" data-testid="workspace" ref={workspaceRef}>
            <AnimateOrNot phase={phase}>
              <div key={`${mountKey(mounted)}:${mountSeq.toString()}`}>
                {renderComponent(mounted, {
                  onSubmit,
                  pendingResponse: awaitingAgent,
                  explainBackDeps,
                  onExplainBackEnd,
                  onContinue,
                  // F-27 AC#4: onAdvanceIntro is now driven by the composer's ONE
                  // primary button, not an in-card control — so it is NOT passed to
                  // intro/worked-example specs here (no in-card "Got it — continue").
                  ...(mounted.kind === 'MasteryCelebration' && mounted.nextLessonId === undefined
                    ? { onTryPlayground }
                    : {}),
                })}
              </div>
            </AnimateOrNot>
          </div>
          {awaitingAgent && (
            <div className="thread__thinking" role="status" aria-live="polite">
              <span className="thread__thinking-dot" aria-hidden="true" />
              Tutor is thinking
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Item-bearing / intro specs that the composer's ONE button advances with
 *  `onAdvanceIntro` (a "Continue" affordance) when there's no pending question. */
function isAdvanceable(spec: ComponentSpec): boolean {
  return (
    spec.kind === 'IntroExplanation' ||
    spec.kind === 'WorkedExample' ||
    spec.kind === 'LessonIntro'
  );
}

export function App(): ReactElement {
  const [lessonId, setLessonId] = useState(lessonFromUrl);
  const startRep = useRef<Rep | null>(startRepFromUrl());
  const [phase, setPhase] = useState<PhaseName>('introducing');
  const bridgeRef = useRef<LessonBridge>({ send: null, setPhase });
  const [conn, setConn] = useState<ConnState>('connecting');
  const [sessionId, setSessionId] = useState<string | null>(null);

  /**
   * F-27: Replace the separate `mounted` / `hint` / `answer` / `recall` slots
   * with a unified `SurfaceState` (anchored workspace + append-only transcript).
   * The `applyMount` policy function routes each incoming spec to either a
   * workspace re-anchor or a side transcript turn.
   */
  const [surface, setSurface] = useState<SurfaceState>({
    mounted: introForLesson(lessonId),
    mountSeq: 0,
    transcript: [],
  });

  /** ADR-013 stretch: the playground canvas. */
  const [playground, setPlayground] = useState<ComponentSpec | null>(null);

  // Keep the legacy `answer` slot alive for the playground scaffold path only —
  // the transcript model renders answers for the lesson session, but the
  // playground replaces LessonSession and needs a separate answer slot.
  const [playgroundAnswer, setPlaygroundAnswer] = useState<ComponentSpec | null>(null);

  /** The intelligibility sampling prompt. */
  const [intelligibilityFor, setIntelligibilityFor] = useState<string | null>(null);

  /**
   * Ephemeral in-progress spoken turn for the streaming transcript bubble
   * (ADR-018). Held OUTSIDE the append-only transcript array: each partial
   * replaces this state; `final:true` commits to the transcript and clears this.
   * Never null-checks to gate the display — null simply hides the bubble.
   */
  const [interim, setInterim] = useState<InterimTurn>(null);

  /**
   * Conversational activity state, driven by transcript_stream events (ADR-018).
   * Defaults to 'listening' when connected and idle. Drives data-voice-activity
   * on AskTutorButton for CSS affordances. Only meaningful while voice is active —
   * the prop is optional on AskTutorButton so it's harmless when voice is off.
   */
  const [voiceActivity, setVoiceActivity] = useState<VoiceActivity>('listening');

  /** The id of the item currently mounted (for submit naming). */
  const currentItemId = useRef<string>('l1-and');
  const itemMountedAt = useRef<number>(Date.now());
  const socketRef = useRef<AgentSocket | null>(null);
  const [awaitingAgent, setAwaitingAgent] = useState(false);
  const [question, setQuestion] = useState('');
  const currentProbeItemId = useRef<string | null>(null);
  const activeHiddenReps = useRef<Rep[]>([]);
  const phaseRef = useRef<string>('introducing');

  const [analyticsConsent, setAnalyticsConsent] = useState<AnalyticsConsent>(
    readStoredAnalyticsConsent,
  );

  const onAcceptAnalytics = useCallback((): void => {
    writeStoredAnalyticsConsent(true);
    setAnalyticsConsent(true);
  }, []);

  const onDeclineAnalytics = useCallback((): void => {
    writeStoredAnalyticsConsent(false);
    setAnalyticsConsent(false);
  }, []);

  useEffect(() => {
    if (analyticsConsent !== true) return;
    void initPostHog({
      key: import.meta.env.VITE_POSTHOG_KEY ?? '',
      host: import.meta.env.VITE_POSTHOG_HOST ?? '',
      consent: true,
    });
  }, [analyticsConsent]);

  useEffect(() => {
    let cancelled = false;
    const lessonQuery = lessonId > 1 ? `?lesson=${String(lessonId)}` : '';
    const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/agent${lessonQuery}`;

    void fetch('/api/session', { method: 'POST' })
      .then((r) => r.json())
      .then((body: { sessionId: string }) => {
        if (cancelled) return;
        setSessionId(body.sessionId);
        const socket = new AgentSocket(wsUrl, {
          onOpen: () => {
            setConn('open');
            socket.send({
              kind: 'session_start',
              sessionId: body.sessionId,
              lessonId,
              ...(startRep.current ? { startRep: startRep.current } : {}),
            });
          },
          onClose: () => {
            setAwaitingAgent(false);
            setConn('closed');
          },
          onMessage: (msg: ServerMessage) => {
            // ADR-013: mount playground ONLY on the server's earned-it ack.
            if (
              msg.kind === 'action' ||
              msg.kind === 'error' ||
              (msg.kind === 'ack' && msg.event !== 'ui_mount' && msg.event !== 'intelligibility_response')
            ) {
              setAwaitingAgent(false);
            }
            // ADR-018: transcript_stream carries NO authority — it is a live display
            // stream only. Interim partials replace the single in-progress bubble;
            // a `final:true` chunk commits to the durable transcript and clears the
            // bubble. This branch is purely additive — the F-30 typed-answer path
            // (r.answer.spoken → appendSpokenTurn) is unchanged and runs below.
            if (msg.kind === 'transcript_stream') {
              if (!msg.final) {
                // Partial: replace (never append) the single in-progress bubble.
                setInterim({ speaker: msg.speaker, text: msg.text });
              } else {
                // Final: commit to durable transcript, clear the in-progress bubble.
                setSurface((prev) => appendSpokenTurn(prev, msg.speaker, msg.text));
                setInterim(null);
              }
              // Update voice activity based on transcript_stream events (ADR-018).
              //
              // Rules:
              //   learner final           → thinking  (waiting for agent to reply)
              //   agent chunk (any)       → agent-speaking  (includes final-only short replies)
              //   agent final             → listening  (turn complete; reset for next learner input)
              //
              // The agent-speaking state is set for EVERY agent chunk — interim or final — so a
              // short reply that arrives as a single final:true frame (no preceding interim) still
              // shows agent-speaking before falling through to listening. On a final agent chunk
              // both branches run in order: agent-speaking is set first, then listening is set
              // immediately after. React batches these two setState calls within the same event
              // handler, so the UI sees the listening state by the time it paints. This is
              // intentional: for a brief final-only reply, the indicator correctly shows the
              // full transition listening→thinking→agent-speaking→listening across turns rather
              // than silently skipping agent-speaking (which would leave the indicator on
              // thinking, misrepresenting what happened).
              if (msg.speaker === 'learner' && msg.final) {
                setVoiceActivity('thinking');
              } else if (msg.speaker === 'agent') {
                // Show agent-speaking for every agent chunk — interim OR final (ADR-018).
                // This ensures final-only short replies still briefly register as agent-speaking.
                setVoiceActivity('agent-speaking');
                if (msg.final) {
                  // Turn complete: reset to listening so the learner knows it's their move.
                  setVoiceActivity('listening');
                }
              }
              return;
            }

            if (msg.kind === 'ack' && msg.event === 'enter_playground') {
              setPlayground({
                kind: 'PlaygroundCanvas',
                visibleReps: ['truth_table', 'circuit', 'pseudocode'],
              });
              return;
            }
            if (msg.kind === 'error') {
              setPlayground(null);
              return;
            }
            if (msg.kind !== 'action') return;
            const r = adaptAction(msg.action, {
              phase: phaseRef.current,
              hiddenReps: activeHiddenReps.current,
            });
            if (r.refused) return;
            if (r.lessonEvents) for (const e of r.lessonEvents) bridgeRef.current.send?.(e);
            if (r.mount) {
              setSurface((prev) => {
                const next = applyMount(prev, r.mount!);
                // Track probe state when a TransferProbe re-anchors.
                if (r.mount!.kind === 'TransferProbe') {
                  currentProbeItemId.current = r.mount!.itemId;
                  activeHiddenReps.current = r.mount!.hiddenReps;
                }
                return next;
              });
              // A new workspace mount clears the playground.
              if (r.mount.kind !== 'HintCard' &&
                  r.mount.kind !== 'AgentAnswer' &&
                  r.mount.kind !== 'CrossLessonRecall') {
                setPlayground(null);
              }
              // Intelligibility sampling (non-probe mounts only).
              if (r.mount.kind !== 'TransferProbe' &&
                  r.mount.kind !== 'HintCard' &&
                  r.mount.kind !== 'AgentAnswer' &&
                  r.mount.kind !== 'CrossLessonRecall' &&
                  shouldSampleIntelligibility()) {
                setIntelligibilityFor(r.mount.kind);
              } else if (r.mount.kind !== 'HintCard' &&
                         r.mount.kind !== 'AgentAnswer' &&
                         r.mount.kind !== 'CrossLessonRecall') {
                setIntelligibilityFor(null);
              }
            }
            if (r.answer) {
              const answerSpec: ComponentSpec = {
                kind: 'AgentAnswer',
                question: r.answer.question,
                answer: r.answer.answer,
                topicClassification: r.answer.topicClassification,
              };
              // For lesson sessions, route through applyMount (transcript side turn).
              if (!playground) {
                setSurface((prev) => {
                  // F-30 (D9): when the answer is a spoken turn, prepend a learner
                  // spokenTurn bubble (the learner's question) before the agent reply,
                  // so the transcript shows learner→agent interleaved in order.
                  const withLearner = r.answer!.spoken
                    ? appendSpokenTurn(prev, 'learner', r.answer!.question)
                    : prev;
                  return applyMount(withLearner, answerSpec);
                });
              } else {
                // For the playground, update the separate playground answer slot.
                setPlaygroundAnswer(answerSpec);
              }
            }
          },
        });
        socket.connect();
        socketRef.current = socket;
      })
      .catch(() => {
        setAwaitingAgent(false);
        setConn('closed');
      });

    return () => {
      cancelled = true;
      socketRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track current item id + mount time for submit reporting.
  useEffect(() => {
    const mounted = surface.mounted;
    if (mounted.kind === 'TruthTablePractice') currentItemId.current = mounted.expression;
    else if (mounted.kind === 'CircuitBuilder' || mounted.kind === 'PseudocodeChallenge') {
      currentItemId.current = mounted.targetExpression;
    }
    itemMountedAt.current = Date.now();
  }, [surface.mounted]);

  useEffect(() => {
    if (analyticsConsent === true && sessionId) groupBySession(sessionId);
  }, [analyticsConsent, sessionId]);

  // UI-mount telemetry.
  const lastBeaconedMount = useRef<string>('');
  useEffect(() => {
    if (!sessionId) return;
    const key = mountKey(surface.mounted);
    if (key === lastBeaconedMount.current) return;
    lastBeaconedMount.current = key;
    socketRef.current?.send({
      kind: 'ui_mount',
      sessionId,
      componentKind: surface.mounted.kind,
      phase: phaseRef.current,
    });
    capture('mount', { componentKind: surface.mounted.kind, phase: phaseRef.current });
    if (surface.mounted.kind === 'MasteryCelebration') capture('mastery_declared', { lessonId });
  }, [surface.mounted, sessionId, lessonId]);

  // Transfer-probe entry/exit analytics.
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
      if (!sessionId || awaitingAgent) return;
      const mounted = surface.mounted;

      // F-27 AC#3: append a verdict turn BEFORE sending the WS frame.
      // The verdict is from the client's <5ms correctness compute (existing behaviour).
      const expression =
        mounted.kind === 'TruthTablePractice'
          ? mounted.expression
          : mounted.kind === 'CircuitBuilder' || mounted.kind === 'PseudocodeChallenge'
          ? mounted.targetExpression
          : mounted.kind === 'TransferProbe'
          ? mounted.expression
          : '';
      setSurface((prev) => appendVerdict(prev, payload.correct, expression));

      if (mounted.kind === 'TransferProbe' && currentProbeItemId.current) {
        setAwaitingAgent(true);
        socketRef.current?.send({
          kind: 'transfer_submitted',
          sessionId,
          itemId: currentProbeItemId.current,
          submission: payload.submission,
          responseTimeMs: Date.now() - itemMountedAt.current,
        });
        return;
      }
      setAwaitingAgent(true);
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
    [awaitingAgent, sessionId, surface.mounted],
  );

  const onAskQuestion = useCallback((): void => {
    const q = question.trim();
    if (!sessionId || awaitingAgent || q.length === 0) return;
    // Echo the learner's typed question into the transcript IMMEDIATELY as a
    // learner spoken-turn bubble — the same "You: …" chat bubble the voice path
    // produces — so the conversation reads as you → tutor → you, and the agent's
    // reply (which lands as an AgentAnswer turn below) has visible context.
    // Voice turns are echoed by the server's spoken-turn path instead, so the
    // answer-side learner-bubble prepend (App's action handler) is gated on
    // `spoken` to avoid double-echoing — a typed question is echoed here, once.
    if (phaseRef.current === 'transferring' && activeHiddenReps.current.length > 0) {
      const asked = wantsHiddenRep(q, activeHiddenReps.current);
      if (asked) {
        const refusalSpec: ComponentSpec = {
          kind: 'AgentAnswer',
          question: q,
          answer: transferRepRefusal(asked),
          topicClassification: 'on_topic',
        };
        setSurface((prev) => applyMount(appendSpokenTurn(prev, 'learner', q), refusalSpec));
        setQuestion('');
        return;
      }
    }
    setAwaitingAgent(true);
    setSurface((prev) => appendSpokenTurn(prev, 'learner', q));
    socketRef.current?.send({ kind: 'learner_question', sessionId, question: q });
    setQuestion('');
  }, [awaitingAgent, question, sessionId]);

  // F-27 AC#4: send `intro_advance` (not `session_start`) to deterministically
  // advance the opening sequence.  Both providers branch on this event kind
  // (menu-lockstep per the build plan).
  const onAdvanceIntro = useCallback((): void => {
    if (!sessionId || awaitingAgent) return;
    setAwaitingAgent(true);
    socketRef.current?.send({ kind: 'intro_advance', sessionId });
  }, [awaitingAgent, sessionId]);

  const onRequestHint = useCallback((): void => {
    if (!sessionId || awaitingAgent) return;
    setAwaitingAgent(true);
    socketRef.current?.send({
      kind: 'request_hint',
      sessionId,
      itemId: currentItemId.current,
    });
    capture('hint_request', { itemId: currentItemId.current });
  }, [awaitingAgent, sessionId]);

  const onIntelligibilityAnswer = useCallback(
    (answer: IntelligibilityAnswer): void => {
      const mountedKind = intelligibilityFor;
      setIntelligibilityFor(null);
      if (!sessionId || !mountedKind) return;
      socketRef.current?.send({ kind: 'intelligibility_response', sessionId, mountedKind, answer });
    },
    [sessionId, intelligibilityFor],
  );

  const onExplainBackEnd = useCallback(
    (payload: { targetItemId: string; transcript: string; durationMs: number }): void => {
      if (!sessionId || awaitingAgent) return;
      setAwaitingAgent(true);
      socketRef.current?.send({
        kind: 'explain_back_recording_ended',
        sessionId,
        targetItemId: payload.targetItemId,
        transcript: payload.transcript,
        durationMs: payload.durationMs,
      });
    },
    [awaitingAgent, sessionId],
  );

  const onContinue = useCallback(
    (nextLessonId: number): void => {
      if (!sessionId || awaitingAgent) return;
      setAwaitingAgent(true);
      socketRef.current?.send({ kind: 'advance_lesson', sessionId, toLessonId: nextLessonId });
      capture('lesson_transition', { toLessonId: nextLessonId });
      // Reset the surface to the intro of the lesson we're advancing TO — not a
      // hardcoded L2 intro, which flashed the wrong lesson's intro (and logged it
      // into the fresh transcript) on L2→L3 / L3→L4 until the server's first mount
      // arrived. introForLesson() maps each lessonId to its own intro. (MR !11 review.)
      setSurface({ mounted: introForLesson(nextLessonId), mountSeq: 0, transcript: [] });
      setLessonId(nextLessonId);
    },
    [awaitingAgent, sessionId],
  );

  const onTryPlayground = useCallback((): void => {
    if (!sessionId || awaitingAgent) return;
    setAwaitingAgent(true);
    socketRef.current?.send({ kind: 'enter_playground', sessionId });
  }, [awaitingAgent, sessionId]);

  const onPlaygroundSubmit = useCallback(
    (payload: PlaygroundSubmitPayload): void => {
      if (!sessionId || awaitingAgent) return;
      setAwaitingAgent(true);
      socketRef.current?.send({
        kind: 'playground_submit',
        sessionId,
        targetExpression: payload.targetExpression,
        submissions: payload.submissions,
      });
    },
    [awaitingAgent, sessionId],
  );

  const onPlaygroundRequestScaffold = useCallback(
    (payload: PlaygroundRequestScaffoldPayload): void => {
      if (!sessionId || awaitingAgent) return;
      setAwaitingAgent(true);
      socketRef.current?.send({
        kind: 'playground_request_scaffold',
        sessionId,
        targetExpression: payload.targetExpression,
        ...(payload.learnerQuestion ? { learnerQuestion: payload.learnerQuestion } : {}),
      });
    },
    [awaitingAgent, sessionId],
  );

  const onExitPlayground = useCallback((): void => {
    if (!sessionId || awaitingAgent) return;
    setAwaitingAgent(true);
    socketRef.current?.send({ kind: 'exit_playground', sessionId });
  }, [awaitingAgent, sessionId]);

  // F-27: appendTurn seam — exported for F-30 spoken turns (F-30 calls this to
  // append a spokenTurn without needing to re-architect App again).
  const appendTurn = useCallback((turn: Turn): void => {
    setSurface((prev) => ({ ...prev, transcript: [...prev.transcript, turn] }));
  }, []);
  // (appendTurn is exposed on the window in dev for F-30 integration; in
  // production it's only wired by the VoiceBridge.)
  void appendTurn; // prevent unused warning — F-30 wires this

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
    startRecording: () => () => '',
  }).current;

  useEffect(() => {
    phaseRef.current = phase;
    if (phase !== 'transferring') {
      activeHiddenReps.current = [];
      currentProbeItemId.current = null;
    }
  }, [phase]);

  // ── The ONE primary composer action ──────────────────────────────────────
  // A single button that becomes Continue / Send by context (complaint #2):
  //  - text in the box        → "Send"     (dispatches onAskQuestion)
  //  - else an advanceable     → "Continue" (dispatches onAdvanceIntro)
  //    intro/worked/lesson card
  //  - else                    → "Send" (inert until the learner types)
  const hasQuestion = question.trim().length > 0;
  const canAdvance = !hasQuestion && !playground && isAdvanceable(surface.mounted);
  const primaryLabel = hasQuestion ? 'Send' : canAdvance ? 'Continue' : 'Send';
  const primaryDisabled = conn !== 'open' || awaitingAgent || (!hasQuestion && !canAdvance);
  const onPrimary = useCallback((): void => {
    if (awaitingAgent) return;
    if (question.trim().length > 0) {
      onAskQuestion();
      return;
    }
    if (!playground && isAdvanceable(surface.mounted)) {
      onAdvanceIntro();
    }
  }, [awaitingAgent, question, playground, surface.mounted, onAskQuestion, onAdvanceIntro]);

  // The Hint affordance is a CLEARLY-SECONDARY control during practice only, and is
  // disabled during a transfer probe (probe-integrity boundary — preserved).
  const hintVisible = !playground && (phase === 'practicing' || phase === 'transferring');

  return (
    <main className="lesson-shell">
      <h1 className="visually-hidden">Polymath — Boolean logic lesson</h1>
      <header className="app-shell-top">
        <a className="app-logo" href="/" aria-label="Polymath home">
          <span className="app-logo__mark" aria-hidden="true">◑</span> Polymath
        </a>
        <div className="app-shell-progress">
          {/* Legacy phase-chip retained for existing tests that query data-phase */}
          <span className="phase-chip" data-phase={phase}>{phase}</span>
          <OverflowMenu sessionId={sessionId} />
        </div>
      </header>

      {analyticsConsent === null && (
        <ConsentModal onAccept={onAcceptAnalytics} onDecline={onDeclineAnalytics} />
      )}

      {playground ? (
        <div className="thread" key="playground">
          <div className="thread__scroll">
            <div className="thread__inner">
              <div className="thread__live">
                {renderComponent(playground, {
                  onPlaygroundSubmit,
                  onPlaygroundRequestScaffold,
                  onExitPlayground,
                  playgroundScaffold: playgroundAnswer?.kind === 'AgentAnswer' ? playgroundAnswer.answer : null,
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <LessonSession
          key={lessonId}
          lessonId={lessonId}
          bridge={bridgeRef.current}
          surface={surface}
          interim={interim}
          conn={conn}
          awaitingAgent={awaitingAgent}
          onSubmit={onSubmit}
          explainBackDeps={explainBackDeps}
          onExplainBackEnd={onExplainBackEnd}
          onContinue={onContinue}
          onRequestHint={onRequestHint}
          onTryPlayground={onTryPlayground}
          onAdvanceIntro={onAdvanceIntro}
        />
      )}

      {/* ── THE COMMAND BAR — one pinned composer, OUTSIDE the content ────────
          A mic icon lives INSIDE the input; ONE primary button (Continue/Send);
          the Hint is a quiet secondary chip shown only during practice. */}
      <div className="composer">
        {intelligibilityFor && (
          <IntelligibilityCheck mountedKind={intelligibilityFor} onAnswer={onIntelligibilityAnswer} />
        )}

        <form
          className="composer__bar"
          onSubmit={(e) => {
            e.preventDefault();
            onPrimary();
          }}
        >
          {hintVisible && (
            <button
              type="button"
              className="hint-button composer__hint"
              onClick={onRequestHint}
              disabled={conn !== 'open' || awaitingAgent || phase === 'transferring'}
              aria-label="Request a hint"
              data-phase={phase}
            >
              <span aria-hidden="true">💡</span> Hint
            </button>
          )}

          <div className="ask-agent">
            <label className="visually-hidden" htmlFor="ask-agent-input">Ask the tutor a question</label>
            {sessionId && <AskTutorButton sessionId={sessionId} activity={voiceActivity} />}
            <input
              id="ask-agent-input"
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={conn !== 'open' || awaitingAgent}
              placeholder={awaitingAgent ? 'Waiting for the tutor…' : 'Ask the tutor anything…'}
            />
          </div>

          <button
            type="submit"
            className="btn btn--primary composer__primary"
            disabled={primaryDisabled}
          >
            {primaryLabel}
            <span className="btn__arrow" aria-hidden="true">→</span>
          </button>
        </form>
      </div>

      <p className="app-conn-status" aria-live="polite" data-conn={conn} data-phase={phase}>
        Connection: {conn}
      </p>
    </main>
  );
}

/**
 * The quiet overflow ("⋯") menu — collapses the formerly-scattered secondary
 * affordances (hand off to a tutor, about this session's data) into ONE
 * unobtrusive control (complaint #2). A real <details>/<summary> disclosure:
 * keyboard-operable, no JS state, native Esc-free toggle. The AboutSessionData
 * modal trigger and the HandoffButton link live inside.
 */
function OverflowMenu({ sessionId }: { sessionId: string | null }): ReactElement {
  return (
    <details className="overflow">
      <summary className="overflow__trigger" aria-label="More options">
        <span aria-hidden="true">⋯</span>
      </summary>
      <div className="overflow__panel" role="menu">
        <HandoffButton sessionId={sessionId} />
        <AboutSessionData />
      </div>
    </details>
  );
}
