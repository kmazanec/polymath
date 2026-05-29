import { describe, expect, it } from 'vitest';
import {
  Action,
  ClientEvent,
  ComponentSpec,
  COMPONENT_KINDS,
  type ComponentKind,
  LessonContent,
  MasteryConfig,
  PhaseName,
  Rep,
  ServerMessage,
  SessionSummarySchema,
  type SessionSummary,
  noAction,
} from './index.js';

// One valid instance per ComponentSpec variant.
const componentSamples: Record<ComponentKind, ComponentSpec> = {
  LessonIntro: { kind: 'LessonIntro', lessonId: 1, title: 't', body: 'b' },
  IntroExplanation: {
    kind: 'IntroExplanation',
    topic: 'AND',
    body: 'b',
    visibleReps: ['truth_table'],
  },
  TruthTablePractice: {
    kind: 'TruthTablePractice',
    expression: 'A AND B',
    claimedTruthTable: [0, 0, 0, 1],
    visibleReps: ['truth_table'],
  },
  CircuitBuilder: {
    kind: 'CircuitBuilder',
    targetExpression: 'A AND B',
    claimedTruthTable: [0, 0, 0, 1],
    allowedGates: ['AND', 'OR', 'NOT'],
    visibleReps: ['circuit'],
  },
  PseudocodeChallenge: {
    kind: 'PseudocodeChallenge',
    targetExpression: 'NOT A',
    claimedTruthTable: [1, 0],
    visibleReps: ['pseudocode'],
  },
  WorkedExample: {
    kind: 'WorkedExample',
    expression: 'A OR B',
    steps: [{ label: 's1', detail: 'd1' }],
    visibleReps: ['truth_table', 'circuit'],
  },
  HintCard: { kind: 'HintCard', level: 1, body: 'b' },
  TransferProbe: {
    kind: 'TransferProbe',
    expression: 'A AND B',
    hiddenReps: ['circuit'],
    targetRep: 'pseudocode',
    itemId: 'i1',
  },
  ExplainBackPrompt: {
    kind: 'ExplainBackPrompt',
    targetItemId: 'i1',
    promptBody: 'explain',
    maxDurationSec: 15,
  },
  ConfidenceCheck: { kind: 'ConfidenceCheck', targetItemId: 'i1', scale: 3 },
  MasteryCelebration: {
    kind: 'MasteryCelebration',
    conceptsMastered: ['AND'],
    nextLessonId: 2,
  },
  AgentAnswer: {
    kind: 'AgentAnswer',
    question: 'q',
    answer: 'a',
    topicClassification: 'on_topic',
  },
  CrossLessonRecall: {
    kind: 'CrossLessonRecall',
    kc: 'and_intro',
    currentItemId: 'L2-03',
    priorBktAtRegression: 0.72,
    reminderBody: 'Remember: AND is true only when both inputs are true.',
  },
};

describe('ComponentSpec', () => {
  it('COMPONENT_KINDS lists exactly the union members', () => {
    // If a variant is added to the union without updating COMPONENT_KINDS (or
    // vice versa), this object literal stops type-checking — compile-time guard.
    expect(new Set(COMPONENT_KINDS)).toEqual(new Set(Object.keys(componentSamples)));
    expect(COMPONENT_KINDS.length).toBe(13);
  });

  it('round-trips every variant through Zod', () => {
    for (const kind of COMPONENT_KINDS) {
      const sample = componentSamples[kind];
      const parsed = ComponentSpec.parse(sample);
      expect(parsed).toEqual(sample);
    }
  });

  it('rejects an unknown kind', () => {
    expect(() => ComponentSpec.parse({ kind: 'Nope' })).toThrow();
  });

  it('rejects a missing required field', () => {
    expect(() => ComponentSpec.parse({ kind: 'LessonIntro', lessonId: 1 })).toThrow();
  });
});

const actionSamples: Action[] = [
  {
    type: 'mount',
    component: componentSamples.LessonIntro,
    rationale: 'r',
  },
  { type: 'transition', to: 'practicing', rationale: 'r' },
  {
    type: 'answer_question',
    question: 'q',
    answer: 'a',
    topicClassification: 'off_topic',
    rationale: 'r',
  },
  { type: 'no_action', reason: 'wait_for_learner', rationale: 'r' },
];

describe('Action', () => {
  it('round-trips every variant through Zod', () => {
    for (const sample of actionSamples) {
      expect(Action.parse(sample)).toEqual(sample);
    }
  });

  it('covers all four action types', () => {
    expect(new Set(actionSamples.map((a) => a.type))).toEqual(
      new Set(['mount', 'transition', 'answer_question', 'no_action']),
    );
  });

  it('validates a mounted component recursively', () => {
    expect(() =>
      Action.parse({ type: 'mount', component: { kind: 'bad' }, rationale: 'r' }),
    ).toThrow();
  });

  it('noAction() produces a schema-valid Action', () => {
    expect(Action.parse(noAction('thinking', 'r'))).toEqual({
      type: 'no_action',
      reason: 'thinking',
      rationale: 'r',
    });
  });
});

describe('wire protocol', () => {
  const SID = '00000000-0000-4000-8000-000000000000'; // a valid UUID
  const clientEvents: ClientEvent[] = [
    { kind: 'session_start', sessionId: SID, lessonId: 1 },
    { kind: 'submit', sessionId: SID, itemId: 'i', submission: 'A AND B' },
    { kind: 'request_hint', sessionId: SID, itemId: 'i' },
    { kind: 'transfer_submitted', sessionId: SID, itemId: 'i', submission: 'A' },
    // With the append-only optional responseTimeMs (F-21 metric-4 dependency check
    // reads it; mirrors submit.responseTimeMs). Round-trips with the field present.
    { kind: 'transfer_submitted', sessionId: SID, itemId: 'i', submission: 'A', responseTimeMs: 4200 },
    {
      kind: 'explain_back_recording_ended',
      sessionId: SID,
      targetItemId: 'i',
      transcript: 't',
      durationMs: 5000,
    },
    { kind: 'learner_question', sessionId: SID, question: 'q' },
    { kind: 'session_end', sessionId: SID },
    { kind: 'ui_mount', sessionId: SID, componentKind: 'TruthTablePractice', phase: 'practicing' },
    { kind: 'intelligibility_response', sessionId: SID, mountedKind: 'HintCard', answer: 'yes' },
  ];

  it('round-trips every client event', () => {
    for (const ev of clientEvents) {
      expect(ClientEvent.parse(ev)).toEqual(ev);
    }
  });

  it('transfer_submitted carries an optional responseTimeMs (F-21 metric-4 data source)', () => {
    // The dependency-check counter-metric folds transfer time-to-correct against
    // practice time-to-correct; it reads payload.event.responseTimeMs on
    // transfer_submitted rows. The field is append-only OPTIONAL: absent for older
    // clients/replays (still parses), present from the live web client.
    const withTime = ClientEvent.parse({
      kind: 'transfer_submitted', sessionId: SID, itemId: 'i', submission: 'A', responseTimeMs: 4200,
    });
    expect(withTime).toMatchObject({ kind: 'transfer_submitted', responseTimeMs: 4200 });
    const withoutTime = ClientEvent.parse({
      kind: 'transfer_submitted', sessionId: SID, itemId: 'i', submission: 'A',
    });
    expect(withoutTime).not.toHaveProperty('responseTimeMs');
    // Same bound as submit.responseTimeMs — a bad client clock can't poison the median.
    expect(() =>
      ClientEvent.parse({
        kind: 'transfer_submitted', sessionId: SID, itemId: 'i', submission: 'A', responseTimeMs: 86_400_001,
      }),
    ).toThrow();
  });

  it('round-trips every server message', () => {
    const messages: ServerMessage[] = [
      { kind: 'action', sessionId: SID, action: noAction('thinking', 'r') },
      { kind: 'ack', sessionId: SID, event: 'submit' },
      { kind: 'error', sessionId: SID, message: 'boom' },
      { kind: 'error', message: 'no session' },
    ];
    for (const m of messages) {
      expect(ServerMessage.parse(m)).toEqual(m);
    }
  });

  it('accepts a submit with each repSubmission branch (append-only extension)', () => {
    const variants: ClientEvent[] = [
      {
        kind: 'submit',
        sessionId: SID,
        itemId: 'i',
        submission: 'A AND B',
        repSubmission: { rep: 'truth_table', cells: [0, 0, 0, 1] },
      },
      {
        kind: 'submit',
        sessionId: SID,
        itemId: 'i',
        submission: 'A AND B',
        repSubmission: { rep: 'circuit', expression: 'A AND B', nodes: [], edges: [] },
      },
      {
        kind: 'submit',
        sessionId: SID,
        itemId: 'i',
        submission: 'A AND B',
        repSubmission: { rep: 'pseudocode', expression: 'A AND B', source: 'a and b' },
      },
    ];
    for (const ev of variants) {
      expect(ClientEvent.parse(ev)).toEqual(ev);
    }
  });

  it('still accepts a submit with no repSubmission (the field is optional)', () => {
    const ev: ClientEvent = { kind: 'submit', sessionId: SID, itemId: 'i', submission: 'A' };
    expect(ClientEvent.parse(ev)).toEqual(ev);
  });

  it('rejects an unknown repSubmission rep', () => {
    expect(() =>
      ClientEvent.parse({
        kind: 'submit',
        sessionId: SID,
        itemId: 'i',
        submission: 'A',
        repSubmission: { rep: 'nope', cells: [] },
      }),
    ).toThrow();
  });

  it('rejects an oversized repSubmission (lesson-scale bounds at the wire boundary)', () => {
    // A truth-table submission with > 1024 cells is an abusive/buggy frame.
    expect(() =>
      ClientEvent.parse({
        kind: 'submit',
        sessionId: SID,
        itemId: 'i',
        submission: 'A',
        repSubmission: { rep: 'truth_table', cells: new Array(2000).fill(0) },
      }),
    ).toThrow();
    // A circuit submission with thousands of nodes is rejected too.
    expect(() =>
      ClientEvent.parse({
        kind: 'submit',
        sessionId: SID,
        itemId: 'i',
        submission: 'A',
        repSubmission: {
          rep: 'circuit',
          expression: 'A',
          nodes: new Array(1000).fill({ id: 'x' }),
          edges: [],
        },
      }),
    ).toThrow();
  });

  it('rejects an unknown client event kind', () => {
    expect(() => ClientEvent.parse({ kind: 'nope', sessionId: SID })).toThrow();
  });

  it('rejects a non-UUID sessionId at the contract boundary', () => {
    // Defends against the DB-error-on-bad-sessionId crash path: a malformed id
    // never reaches the uuid-typed columns.
    expect(() =>
      ClientEvent.parse({ kind: 'submit', sessionId: 'not-a-uuid', itemId: 'i', submission: 'A' }),
    ).toThrow();
  });
});

describe('shared enums', () => {
  it('Rep has exactly three representations', () => {
    expect(Rep.options).toEqual(['truth_table', 'circuit', 'pseudocode']);
  });

  it('PhaseName has the locked phase set', () => {
    expect(PhaseName.options).toEqual([
      'introducing',
      'practicing',
      'hint',
      'transferring',
      'assessed',
      'mastered',
      'remediating',
    ]);
  });
});

describe('lesson config schemas', () => {
  it('accepts a full mastery config', () => {
    const cfg: MasteryConfig = {
      consecutiveCorrectAtHardestTier: 3,
      hintsUsedInLastN_items: 0,
      responseTimeFloorMs: 2000,
      responseTimeCeilingMs: 60000,
      responseTimeMedianBandMs: [2000, 60000],
      bktMasteryThreshold: 0.95,
      bktPrior_L0: 0.3,
      bktTransition_T: 0.2,
      bktGuess_G: 0.15,
      bktSlip_S: 0.1,
      hintRatioMax: 0.2,
      retryRatioMax: 0.3,
      requireHandCuratedTransfer: true,
      requireDifferentRepresentation: true,
      requireExplainBackPass: true,
      topicGuardrailBudget: 3,
    };
    expect(MasteryConfig.parse(cfg)).toEqual(cfg);
  });

  it('rejects a BKT threshold outside [0,1]', () => {
    expect(() =>
      MasteryConfig.parse({ bktMasteryThreshold: 1.5 }),
    ).toThrow();
  });

  it('F-12: defaults topicGuardrailBudget to 3 when a (pre-F-12) config omits it', () => {
    // A lesson config authored before F-12 carries no topic-guardrail key. The key
    // is OPTIONAL-with-default so the agent still boots (a required key would throw
    // at loadLesson — a crash, not a fail-closed block).
    const legacy = {
      consecutiveCorrectAtHardestTier: 3,
      hintsUsedInLastN_items: 0,
      responseTimeFloorMs: 2000,
      responseTimeCeilingMs: 60000,
      responseTimeMedianBandMs: [2000, 60000] as [number, number],
      bktMasteryThreshold: 0.95,
      bktPrior_L0: 0.3,
      bktTransition_T: 0.2,
      bktGuess_G: 0.15,
      bktSlip_S: 0.1,
      hintRatioMax: 0.2,
      retryRatioMax: 0.3,
      requireHandCuratedTransfer: true,
      requireDifferentRepresentation: true,
      requireExplainBackPass: true,
    };
    const parsed = MasteryConfig.parse(legacy);
    expect(parsed.topicGuardrailBudget).toBe(3);
    expect(parsed.explainBackJudgeAgreementThreshold).toBeUndefined();
  });

  it('F-11/F-12: accepts an explicit topicGuardrailBudget + explainBackJudgeAgreementThreshold', () => {
    const parsed = MasteryConfig.parse({
      consecutiveCorrectAtHardestTier: 3,
      hintsUsedInLastN_items: 0,
      responseTimeFloorMs: 2000,
      responseTimeCeilingMs: 60000,
      responseTimeMedianBandMs: [2000, 60000],
      bktMasteryThreshold: 0.95,
      bktPrior_L0: 0.3,
      bktTransition_T: 0.2,
      bktGuess_G: 0.15,
      bktSlip_S: 0.1,
      hintRatioMax: 0.2,
      retryRatioMax: 0.3,
      requireHandCuratedTransfer: true,
      requireDifferentRepresentation: true,
      requireExplainBackPass: true,
      topicGuardrailBudget: 5,
      explainBackJudgeAgreementThreshold: 0.9,
    });
    expect(parsed.topicGuardrailBudget).toBe(5);
    expect(parsed.explainBackJudgeAgreementThreshold).toBe(0.9);
  });

  it('F-11: rejects an explainBackJudgeAgreementThreshold outside [0,1]', () => {
    expect(() => MasteryConfig.parse({ explainBackJudgeAgreementThreshold: 1.5 })).toThrow();
  });

  it('accepts a lesson content document', () => {
    const content: LessonContent = {
      lessonId: 1,
      title: 'Basic operators',
      knowledgeComponents: ['AND', 'OR', 'NOT'],
      items: [
        {
          itemId: 'l1-and',
          kc: 'AND',
          difficultyTier: 1,
          targetExpression: 'A AND B',
          variables: ['A', 'B'],
          truthTable: [0, 0, 0, 1],
        },
      ],
    };
    expect(LessonContent.parse(content)).toEqual(content);
  });
});

describe('session summary', () => {
  const valid: SessionSummary = {
    preTestScore: null,
    postTestScore: 0.8,
    growthMultiplier: 1.2,
    timeOnTaskMs: 600000,
    transferSuccessRate: 0.75,
    masteryStatus: 'mastered',
    explainBackVerdict: { passed: true, reasons: [] },
    kcsMastered: ['AND', 'OR'],
    kcsStuck: [],
    source: 'experiment',
  };

  it('round-trips a valid session summary', () => {
    expect(SessionSummarySchema.parse(valid)).toEqual(valid);
  });

  it('is strict: rejects an unexpected extra key', () => {
    expect(() => SessionSummarySchema.parse({ ...valid, surprise: 1 })).toThrow();
  });

  it('rejects an unknown mastery status', () => {
    expect(() => SessionSummarySchema.parse({ ...valid, masteryStatus: 'nope' })).toThrow();
  });
});
