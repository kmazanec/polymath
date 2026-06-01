import { describe, expect, it } from 'vitest';
import { Action } from '@polymath/contract';
import { StubAgentClient } from './stubClient.js';
import type { AgentInput } from './client.js';
import { loadLesson } from '../lessons/loader.js';
import { validateOutboundAction } from './validateAction.js';
import { readLessonIntro } from './introAdvance.js';

const lesson = loadLesson(1);
const SID = '00000000-0000-0000-0000-000000000000';
function input(event: AgentInput['event'], ruleGatePassed = false): AgentInput {
  // For tests, mirror the event's `correct` (when present) into the server-derived
  // `currentSubmitCorrect` the heuristic actually reads — in production the server
  // recomputes it from the submission; here the test states intent via `correct`.
  const currentSubmitCorrect = event.kind === 'submit' ? event.correct : undefined;
  return {
    event,
    lesson,
    learnerState: { bktByKc: {}, hintsUsed: 0, consecutiveCorrect: 1, ruleGatePassed },
    recentHistory: [],
    currentSubmitCorrect,
  };
}

const PROBE = {
  itemId: 'L1-01-and',
  targetExpression: 'A AND B',
  targetRep: 'circuit' as const,
  hiddenReps: ['truth_table' as const],
};

describe('inner-agent flow — transfer probe (F-07)', () => {
  it('on a correct submit with the rule gate passed, fires a transfer probe from an unseen bank item', async () => {
    const inp = input(
      { kind: 'submit', sessionId: SID, itemId: 'l1-and', submission: 'A AND B', correct: true },
      true,
    );
    inp.transferCandidates = [PROBE];
    const action = await new StubAgentClient().propose(inp);
    expect(action.type).toBe('mount');
    if (action.type === 'mount') {
      expect(action.component.kind).toBe('TransferProbe');
      if (action.component.kind === 'TransferProbe') {
        expect(action.component.targetRep).toBe('circuit');
        expect(action.component.hiddenReps).toEqual(['truth_table']);
      }
    }
  });

  it('does NOT declare mastery when the rule gate passed but no transfer item is available (fail closed)', async () => {
    const inp = input(
      { kind: 'submit', sessionId: SID, itemId: 'l1-and', submission: 'A AND B', correct: true },
      true,
    );
    inp.transferCandidates = [];
    const action = await new StubAgentClient().propose(inp);
    // A missing probe is a degraded state, not a pass — never jump to mastered.
    expect(action.type).toBe('no_action');
  });

  it('on a passed transfer, awaits explain-back rather than declaring mastery (config requires it)', async () => {
    const inp = input({ kind: 'transfer_submitted', sessionId: SID, itemId: PROBE.itemId, submission: 'A AND B' });
    inp.transferVerdict = { itemId: PROBE.itemId, correct: true };
    const action = await new StubAgentClient().propose(inp);
    // lesson 1 config requires explain-back (F-11/F-12) — mastery is not declared yet.
    expect(action.type).toBe('no_action');
  });

  it('on a failed transfer, remediates with a simpler item rather than advancing', async () => {
    const inp = input({ kind: 'transfer_submitted', sessionId: SID, itemId: PROBE.itemId, submission: 'A OR B' });
    inp.transferVerdict = { itemId: PROBE.itemId, correct: false };
    const action = await new StubAgentClient().propose(inp);
    expect(action.type).toBe('mount');
    expect(action.type === 'mount' && ['TruthTablePractice', 'CircuitBuilder', 'PseudocodeChallenge'].includes(action.component.kind)).toBe(true);
  });
});

describe('inner-agent flow (heuristic, key-free)', () => {
  it('on submit, the key-free StubAgentClient mounts the next practice item', async () => {
    const action = await new StubAgentClient().propose(
      input({ kind: 'submit', sessionId: SID, itemId: 'l1-and', submission: 'A AND B' }),
    );
    expect(action.type).toBe('mount');
    expect(() => Action.parse(action)).not.toThrow();
  });

  it('on session_start, it mounts the first lesson item (loop kickoff)', async () => {
    const action = await new StubAgentClient().propose(
      input({ kind: 'session_start', sessionId: SID, lessonId: 1 }),
    );
    expect(action.type).toBe('mount');
    if (action.type === 'mount' && action.component.kind === 'TruthTablePractice') {
      expect(action.component.expression).toBe('B AND A'); // lesson 1, item 0 (l1-and)
    }
  });

  it('advances when the submit names the item only by its canonical expression', async () => {
    // The web client knows the expression (the rep ComponentSpec carries no itemId),
    // so a submit may name the item by `submission` rather than a matching `itemId`.
    const action = await new StubAgentClient().propose(
      input({ kind: 'submit', sessionId: SID, itemId: 'B AND A', submission: 'B AND A' }),
    );
    expect(action.type).toBe('mount');
    if (action.type === 'mount' && action.component.kind === 'TruthTablePractice') {
      expect(action.component.expression).toBe('A OR B'); // advanced past B AND A (item 0)
    }
  });

  it('a wrong submit re-presents the same item (rephrase), not the next one (criterion 3)', async () => {
    const action = await new StubAgentClient().propose(
      input({ kind: 'submit', sessionId: SID, itemId: 'l1-and', submission: 'B AND A', correct: false }),
    );
    expect(action.type).toBe('mount');
    if (action.type === 'mount' && action.component.kind === 'TruthTablePractice') {
      expect(action.component.expression).toBe('B AND A'); // same item, not advanced
    }
  });

  it('a wrong submit does not advance even when the web names the item by EXPRESSION, not itemId (criterion 3 regression)', async () => {
    // The web sets `itemId` to the mounted item's expression (the ComponentSpec
    // carries no itemId) and `submission` to the learner's (wrong) answer. The item
    // must be identified by itemId, never by the wrong submission, or it advances.
    const action = await new StubAgentClient().propose(
      input({ kind: 'submit', sessionId: SID, itemId: 'B AND A', submission: 'A OR B', correct: false }),
    );
    expect(action.type).toBe('mount');
    if (action.type === 'mount' && action.component.kind === 'TruthTablePractice') {
      expect(action.component.expression).toBe('B AND A'); // re-presents the item, not the answer's item
    }
  });

  it('a second wrong submit on the same item drops to a simpler item (criterion 3)', async () => {
    const inp = input({ kind: 'submit', sessionId: SID, itemId: 'l1-or', submission: 'wrong', correct: false });
    inp.priorMissesByItem = { 'l1-or': 1 }; // a prior miss on this item (server-derived)
    const action = await new StubAgentClient().propose(inp);
    expect(action.type).toBe('mount');
    if (action.type === 'mount' && action.component.kind === 'TruthTablePractice') {
      // The simpler item is the lowest-tier item that differs from A OR B.
      expect(action.component.expression).not.toBe('A OR B');
    }
  });

  it('at the end of the item list, remounts below-threshold KC practice instead of dead-ending', async () => {
    const inp = input({
      kind: 'submit',
      sessionId: SID,
      itemId: 'A AND NOT B',
      submission: 'A AND NOT B',
      correct: true,
      repSubmission: { rep: 'truth_table', cells: [0, 0, 1, 0] },
    });
    inp.learnerState.bktByKc = { AND: 0.97, OR: 0.8, NOT: 0.8 };

    const action = await new StubAgentClient().propose(inp);

    expect(action.type).toBe('mount');
    if (action.type === 'mount' && action.component.kind === 'TruthTablePractice') {
      expect(action.component.expression).toBe('A OR B');
    }
  });

  it('repair practice does not re-teach a KC that already has a submit in recent history', async () => {
    const inp = input({
      kind: 'submit',
      sessionId: SID,
      itemId: 'A OR B',
      submission: 'A OR B',
      correct: true,
      repSubmission: { rep: 'truth_table', cells: [0, 1, 1, 1] },
    });
    inp.recentHistory = [
      { eventKind: 'submit', actionType: 'mount', rationale: '', itemId: 'NOT A' },
    ];

    const action = await new StubAgentClient().propose(inp);

    expect(action.type).toBe('mount');
    if (action.type === 'mount' && action.component.kind === 'TruthTablePractice') {
      expect(action.component.expression).toBe('NOT A');
    }
  });

  it('on a ready learner with a held-out item, it fires a transfer probe (not mastery)', async () => {
    const inp = input({ kind: 'submit', sessionId: SID, itemId: 'l1-not', submission: 'NOT A' }, true);
    inp.transferCandidates = [PROBE];
    const action = await new StubAgentClient().propose(inp);
    expect(action.type).toBe('mount');
    expect(action.type === 'mount' && action.component.kind).toBe('TransferProbe');
  });

  it('answers an on-topic question and deflects an off-topic one', async () => {
    const onTopic = await new StubAgentClient().propose(
      input({ kind: 'learner_question', sessionId: SID, question: 'what does the AND gate do?' }),
    );
    expect(onTopic.type === 'answer_question' && onTopic.topicClassification).toBe('on_topic');
    const offTopic = await new StubAgentClient().propose(
      input({ kind: 'learner_question', sessionId: SID, question: 'help me write my essay' }),
    );
    expect(offTopic.type === 'answer_question' && offTopic.topicClassification).toBe('off_topic');
  });

  it('emits a schema-valid no_action for a non-actionable event', async () => {
    const action = await new StubAgentClient().propose(
      input({ kind: 'session_end', sessionId: SID }),
    );
    expect(action.type).toBe('no_action');
    expect(() => Action.parse(action)).not.toThrow();
  });
});

describe('Lesson 3 — NAND-only circuit workspace', () => {
  const l3 = loadLesson(3);
  const SID3 = '00000000-0000-0000-0000-000000000003';
  function l3Input(event: AgentInput['event']): AgentInput {
    const currentSubmitCorrect = event.kind === 'submit' ? event.correct : undefined;
    return {
      event,
      lesson: l3,
      learnerState: { bktByKc: {}, hintsUsed: 0, consecutiveCorrect: 1, ruleGatePassed: false },
      recentHistory: [],
      currentSubmitCorrect,
    };
  }

  it('mounts the next circuit item with allowedGates restricted to NAND (AC#3)', async () => {
    const firstItem = l3.content.items[0]!;
    const action = await new StubAgentClient().propose(
      l3Input({
        kind: 'submit',
        sessionId: SID3,
        itemId: firstItem.itemId,
        submission: firstItem.targetExpression,
        correct: true,
        repSubmission: {
          rep: 'circuit',
          expression: firstItem.targetExpression,
          nodes: [],
          edges: [],
        },
      }),
    );
    expect(action.type).toBe('mount');
    if (action.type === 'mount' && action.component.kind === 'CircuitBuilder') {
      expect(action.component.allowedGates).toEqual(['NAND']);
    } else {
      throw new Error(`expected a CircuitBuilder mount, got ${action.type}`);
    }
    expect(() => Action.parse(action)).not.toThrow();
  });

  it('a truth-table submit on L3 is NOT given a NAND palette (allowedGates is circuit-only)', async () => {
    const firstItem = l3.content.items[0]!;
    const action = await new StubAgentClient().propose(
      l3Input({
        kind: 'submit',
        sessionId: SID3,
        itemId: firstItem.itemId,
        submission: firstItem.targetExpression,
        correct: true,
      }),
    );
    expect(action.type).toBe('mount');
    // A truth-table rep mount carries no allowedGates field at all.
    expect(action.type === 'mount' && action.component.kind).toBe('TruthTablePractice');
  });
});

describe('validateOutboundAction (acceptance criterion 5)', () => {
  it('passes a valid action through unchanged', () => {
    const valid = { type: 'no_action', reason: 'thinking', rationale: 'r' } as const;
    const { action, downgraded } = validateOutboundAction(valid);
    expect(downgraded).toBe(false);
    expect(action).toEqual(valid);
  });

  it('downgrades a malformed action to no_action', () => {
    const { action, downgraded } = validateOutboundAction({
      type: 'mount',
      component: { kind: 'NotAReal Component' },
      rationale: 'r',
    });
    expect(downgraded).toBe(true);
    expect(action.type).toBe('no_action');
    expect(() => Action.parse(action)).not.toThrow();
  });

  it('downgrades a completely non-action object', () => {
    const { action, downgraded } = validateOutboundAction({ foo: 'bar' });
    expect(downgraded).toBe(true);
    expect(action.type).toBe('no_action');
  });
});

// ── F-27 (I7): intro_advance handler ────────────────────────────────────────

describe('inner-agent: intro_advance (F-27 AC#4, menu-lockstep)', () => {
  const SID_IA = '11111111-1111-1111-1111-111111111111';

  function introAdvanceInput(priorMountCount: number): AgentInput {
    return {
      event: { kind: 'intro_advance', sessionId: SID_IA },
      lesson,
      learnerState: { bktByKc: {}, hintsUsed: 0, consecutiveCorrect: 0, ruleGatePassed: false },
      recentHistory: Array.from({ length: priorMountCount }, () => ({
        eventKind: 'session_start' as const,
        actionType: 'mount' as const,
        sessionId: SID_IA,
      })),
      currentSubmitCorrect: undefined,
    };
  }

  // Lesson 1 (Option-B arc): the OPENING walk teaches ONLY [AND, then the truth-table
  // card] — so the learner meets AND, then learns what a truth table IS and sees AND
  // written as one, then the worked example traces it, then they fill AND's table.
  // OR and NOT are taught JUST-IN-TIME before their own items (not in the opening
  // walk). The iron rule under test: the learner is never asked to fill a truth table
  // before the truth-table representation has been taught.
  const intro1 = readLessonIntro(1);
  const openingTopics = intro1?.openingExplanations ?? [];

  it('the opening walk is exactly [AND, Truth tables] — operators-then-table, not all four', () => {
    expect(openingTopics).toEqual(['AND', 'Truth tables']);
  });

  it('opening walk teaches AND first, then the truth-table card — in order', async () => {
    const and = await new StubAgentClient().propose(introAdvanceInput(0));
    expect(and.type).toBe('mount');
    if (and.type === 'mount' && and.component.kind === 'IntroExplanation') {
      expect(and.component.topic).toBe('AND');
    }
    const table = await new StubAgentClient().propose(introAdvanceInput(1));
    expect(table.type).toBe('mount');
    if (table.type === 'mount' && table.component.kind === 'IntroExplanation') {
      expect(table.component.topic.toLowerCase()).toContain('truth table');
    }
  });

  it('the truth-table card is taught BEFORE the worked example and the first fill-in', async () => {
    // After the 2 opening cards (AND, Truth tables) → the worked example (AND as a table).
    const we = await new StubAgentClient().propose(introAdvanceInput(openingTopics.length));
    expect(we.type).toBe('mount');
    if (we.type === 'mount') {
      expect(we.component.kind).toBe('WorkedExample');
    }
  });

  it('only AFTER the worked example does the first practice item (a truth-table fill-in) appear', async () => {
    const action = await new StubAgentClient().propose(
      introAdvanceInput(openingTopics.length + 1),
    );
    if (action.type === 'mount') {
      expect(['TruthTablePractice', 'CircuitBuilder', 'PseudocodeChallenge'])
        .toContain(action.component.kind);
    } else {
      expect(action.type).toBe('no_action');
    }
  });

  it('OR and NOT are NOT front-loaded in the opening walk (taught just-in-time later)', () => {
    expect(openingTopics).not.toContain('OR');
    expect(openingTopics).not.toContain('NOT');
    // but they remain authored so the just-in-time lookup can find them by KC
    const topics = (intro1?.explanations ?? []).map((e) => e.topic);
    expect(topics).toContain('OR');
    expect(topics).toContain('NOT');
  });

  it('after practice has started, intro_advance is a no-op', async () => {
    const inp: AgentInput = {
      event: { kind: 'intro_advance', sessionId: SID_IA },
      lesson,
      learnerState: { bktByKc: {}, hintsUsed: 0, consecutiveCorrect: 1, ruleGatePassed: false },
      recentHistory: [
        { eventKind: 'submit', actionType: 'mount', sessionId: SID_IA },
      ],
      currentSubmitCorrect: undefined,
    };
    const action = await new StubAgentClient().propose(inp);
    expect(action.type).toBe('no_action');
  });
});
