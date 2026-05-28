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
};

describe('ComponentSpec', () => {
  it('COMPONENT_KINDS lists exactly the union members', () => {
    // If a variant is added to the union without updating COMPONENT_KINDS (or
    // vice versa), this object literal stops type-checking — compile-time guard.
    expect(new Set(COMPONENT_KINDS)).toEqual(new Set(Object.keys(componentSamples)));
    expect(COMPONENT_KINDS.length).toBe(12);
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
    {
      kind: 'explain_back_recording_ended',
      sessionId: SID,
      targetItemId: 'i',
      transcript: 't',
      durationMs: 5000,
    },
    { kind: 'learner_question', sessionId: SID, question: 'q' },
    { kind: 'session_end', sessionId: SID },
  ];

  it('round-trips every client event', () => {
    for (const ev of clientEvents) {
      expect(ClientEvent.parse(ev)).toEqual(ev);
    }
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
    };
    expect(MasteryConfig.parse(cfg)).toEqual(cfg);
  });

  it('rejects a BKT threshold outside [0,1]', () => {
    expect(() =>
      MasteryConfig.parse({ bktMasteryThreshold: 1.5 }),
    ).toThrow();
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
