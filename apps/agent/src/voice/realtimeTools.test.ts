import { describe, expect, it } from 'vitest';
import { F26_MENU } from '../agent/menu.js';
import { REALTIME_TOOLS, toolCallToTacticalMove } from './realtimeTools.js';

// ---------------------------------------------------------------------------
// Lockstep guard: every F26_MENU value must appear in the `move` enum of the
// hand-written JSON schema. A menu addition that isn't mirrored here fails
// before reaching production (per CLAUDE.md menu-lockstep invariant).
// ---------------------------------------------------------------------------

describe('REALTIME_TOOLS schema — menu lockstep', () => {
  it('has exactly one tool named propose_tactical_move', () => {
    expect(REALTIME_TOOLS).toHaveLength(1);
    expect(REALTIME_TOOLS[0]!.name).toBe('propose_tactical_move');
    expect(REALTIME_TOOLS[0]!.type).toBe('function');
  });

  it('every F26_MENU value is present in the schema move enum', () => {
    const params = REALTIME_TOOLS[0]!.parameters as Record<string, unknown>;
    const props = params['properties'] as Record<string, unknown>;
    const moveSchema = props['move'] as { enum?: unknown[] };
    const schemaEnum = moveSchema.enum ?? [];
    for (const menuValue of F26_MENU) {
      expect(schemaEnum, `F26_MENU value "${menuValue}" is missing from the realtime tool schema move enum`).toContain(menuValue);
    }
  });

  it('the schema move enum contains no values absent from F26_MENU (no stale entries)', () => {
    const params = REALTIME_TOOLS[0]!.parameters as Record<string, unknown>;
    const props = params['properties'] as Record<string, unknown>;
    const moveSchema = props['move'] as { enum?: unknown[] };
    const schemaEnum = (moveSchema.enum ?? []) as string[];
    const menuSet = new Set<string>(F26_MENU);
    for (const v of schemaEnum) {
      expect(menuSet, `schema move enum has "${v}" which is NOT in F26_MENU`).toContain(v);
    }
  });
});

// ---------------------------------------------------------------------------
// toolCallToTacticalMove — round-trip parsing
// ---------------------------------------------------------------------------

describe('toolCallToTacticalMove', () => {
  it('round-trips answer_question (on_topic) into the correct TacticalMove', () => {
    const args = {
      move: 'answer_question',
      rationale: 'learner asked about AND gate',
      question: 'What does AND do?',
      answer: 'AND outputs 1 only when both inputs are 1.',
      topicClassification: 'on_topic',
      // nullable fields absent
      item: null,
      tier: null,
      altRep: null,
      workedExpression: null,
      workedSteps: null,
      workedVisibleReps: null,
      noActionReason: null,
      hintLevel: null,
      hintBody: null,
      probeExpression: null,
      probeTargetRep: null,
      probeHiddenReps: null,
      probeItemId: null,
      scaffold: null,
    };
    const move = toolCallToTacticalMove(args);
    expect(move.move).toBe('answer_question');
    if (move.move === 'answer_question') {
      expect(move.question).toBe('What does AND do?');
      expect(move.topicClassification).toBe('on_topic');
      expect(move.rationale).toBe('learner asked about AND gate');
    }
  });

  it('round-trips next_practice_item into the correct TacticalMove', () => {
    const args = {
      move: 'next_practice_item',
      rationale: 'move to harder item',
      tier: 2,
      item: {
        rep: 'truth_table',
        targetExpression: 'A AND B',
        claimedTruthTable: [0, 0, 0, 1],
        visibleReps: ['truth_table'],
        prompt: null,
      },
      altRep: null,
      workedExpression: null,
      workedSteps: null,
      workedVisibleReps: null,
      question: null,
      answer: null,
      topicClassification: null,
      noActionReason: null,
      hintLevel: null,
      hintBody: null,
      probeExpression: null,
      probeTargetRep: null,
      probeHiddenReps: null,
      probeItemId: null,
      scaffold: null,
    };
    const move = toolCallToTacticalMove(args);
    expect(move.move).toBe('next_practice_item');
    if (move.move === 'next_practice_item') {
      expect(move.item.targetExpression).toBe('A AND B');
      expect(move.item.claimedTruthTable).toEqual([0, 0, 0, 1]);
      expect(move.tier).toBe(2);
    }
  });

  it('round-trips propose_hint into the correct TacticalMove', () => {
    const args = {
      move: 'propose_hint',
      rationale: 'learner stuck on first row',
      hintLevel: 1,
      hintBody: 'Think about what happens when both inputs are 0.',
      item: null,
      tier: null,
      altRep: null,
      workedExpression: null,
      workedSteps: null,
      workedVisibleReps: null,
      question: null,
      answer: null,
      topicClassification: null,
      noActionReason: null,
      probeExpression: null,
      probeTargetRep: null,
      probeHiddenReps: null,
      probeItemId: null,
      scaffold: null,
    };
    const move = toolCallToTacticalMove(args);
    expect(move.move).toBe('propose_hint');
    if (move.move === 'propose_hint') {
      expect(move.level).toBe(1);
      expect(move.body).toContain('Think about');
    }
  });

  it('a malformed args object (missing move) degrades to no_action safely', () => {
    const move = toolCallToTacticalMove({ rationale: 'oops' });
    expect(move.move).toBe('no_action');
    if (move.move === 'no_action') {
      expect(move.reason).toBe('agent_unsure');
    }
  });

  it('a completely invalid args object degrades to no_action safely', () => {
    const move = toolCallToTacticalMove(null);
    expect(move.move).toBe('no_action');
  });

  it('a structurally valid but move-missing-required-field (next_practice_item with item:null) degrades to no_action', () => {
    const args = {
      move: 'next_practice_item',
      rationale: 'bad proposal',
      item: null, // required for this move
      tier: null,
      altRep: null,
      workedExpression: null,
      workedSteps: null,
      workedVisibleReps: null,
      question: null,
      answer: null,
      topicClassification: null,
      noActionReason: null,
      hintLevel: null,
      hintBody: null,
      probeExpression: null,
      probeTargetRep: null,
      probeHiddenReps: null,
      probeItemId: null,
      scaffold: null,
    };
    const move = toolCallToTacticalMove(args);
    // toTacticalMove throws for next_practice_item with no item; must be caught + degraded.
    expect(move.move).toBe('no_action');
    if (move.move === 'no_action') {
      expect(move.reason).toBe('agent_unsure');
    }
  });
});
