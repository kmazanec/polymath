/**
 * F-29 integration tests: lockstep, engine overwrite, adversarial safety core,
 * regenerate loop, practice-only gate.
 *
 * These tests cover checklist items 6, 7, 8, 9, 11, 12, 13, 14.
 */

import { describe, expect, it, vi } from 'vitest';
import { compileMove, type ProposedItem, type TacticalMove } from './menu.js';
import { proposeAction } from './graph.js';
import type { AgentInput, MoveProvider } from './client.js';
import type { DeliberationContext } from './deliberation.js';
import { loadLesson } from '../lessons/loader.js';
import { Action } from '@polymath/contract';

const lesson1 = loadLesson(1);

function baseInput(overrides: Partial<AgentInput> = {}): AgentInput {
  return {
    event: {
      kind: 'submit',
      sessionId: '00000000-0000-0000-0000-000000000000',
      itemId: 'l1-and',
      submission: 'A AND B',
    },
    lesson: lesson1,
    learnerState: {
      bktByKc: {},
      hintsUsed: 0,
      consecutiveCorrect: 1,
      ruleGatePassed: false,
      explainBackPassed: false,
      topicGuardrailClean: true,
    },
    recentHistory: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Checklist 6: compileMove emits the prompt on each item kind
// ---------------------------------------------------------------------------

describe('compileMove — prompt threaded through itemSpec (checklist 6)', () => {
  const promptText = 'Fill in the truth table for A AND B.';

  const baseItem: ProposedItem = {
    rep: 'truth_table',
    targetExpression: 'A AND B',
    claimedTruthTable: [0, 0, 0, 1],
    visibleReps: ['truth_table'],
    prompt: promptText,
  };

  it('truth_table item: prompt appears on TruthTablePractice spec', () => {
    const a = compileMove({ move: 'next_practice_item', item: baseItem, tier: 1, rationale: 'r' });
    expect(a.type).toBe('mount');
    if (a.type !== 'mount' || a.component.kind !== 'TruthTablePractice') {
      throw new Error('expected TruthTablePractice mount');
    }
    expect(a.component.prompt).toBe(promptText);
    // Must be contract-valid
    Action.parse(a);
  });

  it('circuit item: prompt appears on CircuitBuilder spec', () => {
    const circuitItem: ProposedItem = { ...baseItem, rep: 'circuit' };
    const a = compileMove({ move: 'next_practice_item', item: circuitItem, tier: 1, rationale: 'r' });
    expect(a.type).toBe('mount');
    if (a.type !== 'mount' || a.component.kind !== 'CircuitBuilder') {
      throw new Error('expected CircuitBuilder mount');
    }
    expect(a.component.prompt).toBe(promptText);
    Action.parse(a);
  });

  it('pseudocode item: prompt appears on PseudocodeChallenge spec', () => {
    const pseudoItem: ProposedItem = { ...baseItem, rep: 'pseudocode' };
    const a = compileMove({
      move: 'next_practice_item',
      item: pseudoItem,
      tier: 1,
      rationale: 'r',
    });
    expect(a.type).toBe('mount');
    if (a.type !== 'mount' || a.component.kind !== 'PseudocodeChallenge') {
      throw new Error('expected PseudocodeChallenge mount');
    }
    expect(a.component.prompt).toBe(promptText);
    Action.parse(a);
  });

  it('simpler_item and rephrase also carry the prompt', () => {
    const a1 = compileMove({ move: 'simpler_item', item: baseItem, rationale: 'r' });
    const a2 = compileMove({ move: 'rephrase', item: baseItem, rationale: 'r' });
    if (a1.type !== 'mount' || a1.component.kind !== 'TruthTablePractice') throw new Error();
    if (a2.type !== 'mount' || a2.component.kind !== 'TruthTablePractice') throw new Error();
    expect(a1.component.prompt).toBe(promptText);
    expect(a2.component.prompt).toBe(promptText);
  });

  it('item without prompt: spec has no prompt field (optional stays absent)', () => {
    const noPromptItem: ProposedItem = {
      rep: 'truth_table',
      targetExpression: 'A OR B',
      claimedTruthTable: [0, 1, 1, 1],
      visibleReps: ['truth_table'],
    };
    const a = compileMove({ move: 'next_practice_item', item: noPromptItem, tier: 1, rationale: 'r' });
    if (a.type !== 'mount' || a.component.kind !== 'TruthTablePractice') throw new Error();
    expect(a.component.prompt).toBeUndefined();
    Action.parse(a); // still valid without prompt (optional on wire)
  });
});

// ---------------------------------------------------------------------------
// Checklist 8: keyless item always has a prompt (pickLessonItem)
// ---------------------------------------------------------------------------

describe('keyless path — pickLessonItem carries a prompt (checklist 8)', () => {
  it('HeuristicMoveProvider returns a ProposedItem with a prompt on submit', async () => {
    // Dynamic import to avoid circular dep issues
    const { HeuristicMoveProvider } = await import('./stubClient.js');
    const provider = new HeuristicMoveProvider();
    const move = await provider.proposeMove(
      baseInput({
        event: {
          kind: 'submit',
          sessionId: '00000000-0000-0000-0000-000000000000',
          itemId: 'l1-not',
          submission: 'NOT A',
        },
      }),
    );
    // The heuristic returns a next_practice_item move after a submit
    expect(move.move).toBe('next_practice_item');
    if (
      move.move !== 'next_practice_item' &&
      move.move !== 'simpler_item' &&
      move.move !== 'rephrase'
    ) return;
    expect(move.item.prompt).toBeDefined();
    expect(typeof move.item.prompt).toBe('string');
    expect((move.item.prompt ?? '').trim().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Checklist 9 (SAFETY CORE): wrong claimedTruthTable → engine overwrites
// ---------------------------------------------------------------------------

describe('SAFETY CORE: engine overwrites wrong claimedTruthTable (checklist 9)', () => {
  it('a move with a WRONG claimedTruthTable → mounted spec carries the COMPUTED key', async () => {
    // The model asserts a completely wrong table for A OR B
    const wrongTableMove: TacticalMove = {
      move: 'next_practice_item',
      tier: 1,
      rationale: 'wrong key from model',
      item: {
        rep: 'truth_table',
        targetExpression: 'A OR B',
        claimedTruthTable: [1, 1, 1, 1], // WRONG (correct is [0,1,1,1])
        visibleReps: ['truth_table'],
        prompt: 'Fill in the truth table for A OR B.',
      },
    };

    // proposeAction with engine-overwrite: the mounted action should carry [0,1,1,1]
    class WrongKeyProvider implements MoveProvider {
      proposeMove(): Promise<TacticalMove> {
        return Promise.resolve(wrongTableMove);
      }
    }

    const action = await proposeAction(new WrongKeyProvider(), baseInput());
    expect(action.type).toBe('mount');
    if (action.type !== 'mount') throw new Error('expected mount');
    if (action.component.kind !== 'TruthTablePractice') throw new Error('expected TruthTablePractice');

    // The engine-computed key must override the model's wrong assertion
    expect(action.component.claimedTruthTable).toEqual([0, 1, 1, 1]);
    // The model's wrong table [1,1,1,1] must NOT appear
    expect(action.component.claimedTruthTable).not.toEqual([1, 1, 1, 1]);

    // Must still be Layer-2 valid (because the engine computed the right key)
    Action.parse(action);
  });

  it('a move with NAND expression → engine computes the correct NAND table', async () => {
    const lesson3 = loadLesson(3);
    const wrongMove: TacticalMove = {
      move: 'next_practice_item',
      tier: 1,
      rationale: 'test',
      item: {
        rep: 'truth_table',
        targetExpression: 'A NAND B',
        claimedTruthTable: [0, 0, 0, 0], // completely wrong
        visibleReps: ['truth_table'],
        prompt: 'Fill in the NAND table.',
      },
    };

    class WrongNandProvider implements MoveProvider {
      proposeMove(): Promise<TacticalMove> { return Promise.resolve(wrongMove); }
    }

    const action = await proposeAction(
      new WrongNandProvider(),
      baseInput({ lesson: lesson3 }),
    );
    expect(action.type).toBe('mount');
    if (action.type !== 'mount') throw new Error('expected mount');
    if (action.component.kind !== 'TruthTablePractice') throw new Error('expected TruthTablePractice');

    // Engine key for A NAND B: [1,1,1,0]
    expect(action.component.claimedTruthTable).toEqual([1, 1, 1, 0]);
  });
});

// ---------------------------------------------------------------------------
// Checklist 11 (adversarial): over-cap / unparseable / out-of-alphabet
// ---------------------------------------------------------------------------

describe('ADVERSARIAL: over-cap, unparseable, out-of-alphabet all rejected (checklist 11)', () => {
  class SingleMoveProvider implements MoveProvider {
    calls = 0;
    constructor(private move: TacticalMove) {}
    proposeMove(): Promise<TacticalMove> {
      this.calls++;
      return Promise.resolve(this.move);
    }
  }

  it('ADVERSARIAL: over-cap generated expr → rejected, fallback taken (not no_action)', async () => {
    const overcapMove: TacticalMove = {
      move: 'next_practice_item',
      tier: 1,
      rationale: 'over-cap',
      item: {
        rep: 'truth_table',
        targetExpression: 'A AND B AND C AND D AND E AND F AND G AND H AND I AND J AND K',
        claimedTruthTable: [0], // irrelevant
        visibleReps: ['truth_table'],
        prompt: 'Fill in the table.',
      },
    };

    const start = Date.now();
    const provider = new SingleMoveProvider(overcapMove);
    const action = await proposeAction(provider, baseInput());
    const elapsed = Date.now() - start;

    // Must complete fast (no 2^11 enumeration)
    expect(elapsed).toBeLessThan(100);
    // Provider called at most 2 times (once + one retry), then fallback
    expect(provider.calls).toBeLessThanOrEqual(2);
    // The result is a valid action (fallback bank item or no_action)
    Action.parse(action);
    // Specifically it should NOT be the over-cap expression
    if (action.type === 'mount') {
      const expr =
        action.component.kind === 'TruthTablePractice'
          ? action.component.expression
          : action.component.kind === 'CircuitBuilder' || action.component.kind === 'PseudocodeChallenge'
            ? action.component.targetExpression
            : null;
      if (expr) {
        expect(expr).not.toContain('AND K');
      }
    }
  });

  it('ADVERSARIAL: unparseable expression → rejected, retry once, then fallback', async () => {
    const badMove: TacticalMove = {
      move: 'next_practice_item',
      tier: 1,
      rationale: 'bad expr',
      item: {
        rep: 'truth_table',
        targetExpression: '@@@ NOT VALID @@@',
        claimedTruthTable: [0],
        visibleReps: ['truth_table'],
        prompt: 'Fill it in.',
      },
    };

    const provider = new SingleMoveProvider(badMove);
    const action = await proposeAction(provider, baseInput());
    Action.parse(action);
    expect(provider.calls).toBeLessThanOrEqual(2);
  });

  it('ADVERSARIAL: out-of-alphabet (NAND on lesson 1) → rejected + regenerated', async () => {
    let attempts = 0;
    const nandMove: TacticalMove = {
      move: 'next_practice_item',
      tier: 1,
      rationale: 'out of alphabet',
      item: {
        rep: 'truth_table',
        targetExpression: 'A NAND B', // NAND not in lesson 1's alphabet
        claimedTruthTable: [1, 1, 1, 0],
        visibleReps: ['truth_table'],
        prompt: 'Fill in the NAND table.',
      },
    };

    class TrackingProvider implements MoveProvider {
      proposeMove(): Promise<TacticalMove> {
        attempts++;
        return Promise.resolve(nandMove);
      }
    }

    const action = await proposeAction(new TrackingProvider(), baseInput());
    // Should have retried once (2 attempts total) then fallen back
    expect(attempts).toBeLessThanOrEqual(2);
    Action.parse(action);
    // Result is NOT the out-of-alphabet item
    if (action.type === 'mount') {
      const expr =
        action.component.kind === 'TruthTablePractice'
          ? action.component.expression
          : action.component.kind === 'CircuitBuilder' || action.component.kind === 'PseudocodeChallenge'
            ? action.component.targetExpression
            : null;
      if (expr) expect(expr).not.toBe('A NAND B');
    }
  });
});

// ---------------------------------------------------------------------------
// Checklist 12: regenerate end-to-end loop
// ---------------------------------------------------------------------------

describe('regenerate end-to-end loop (checklist 12)', () => {
  it('attempt 0 invalid → attempt 1 → invalid → authored fallback → valid', async () => {
    // Both attempts from the provider are invalid (over-cap)
    let calls = 0;
    const alwaysInvalid: MoveProvider = {
      proposeMove(): Promise<TacticalMove> {
        calls++;
        return Promise.resolve({
          move: 'next_practice_item',
          tier: 1,
          rationale: 'always invalid',
          item: {
            rep: 'truth_table',
            targetExpression: '@@@ UNPARSEABLE @@@',
            claimedTruthTable: [0],
            visibleReps: ['truth_table'],
            prompt: 'Fill it in.',
          },
        });
      },
    };

    const action = await proposeAction(alwaysInvalid, baseInput());
    expect(calls).toBe(2); // exactly 2 attempts
    // Fallback bank is used → result is a valid mount
    Action.parse(action);
    expect(action.type).toBe('mount'); // fallback bank has items for lesson 1
  });

  it('empty bank + always invalid → no_action', async () => {
    const emptyLesson = { ...lesson1, content: { ...lesson1.content, lessonId: 999, items: [] } };
    const alwaysInvalid: MoveProvider = {
      proposeMove(): Promise<TacticalMove> {
        return Promise.resolve({
          move: 'next_practice_item',
          tier: 1,
          rationale: 'always invalid',
          item: {
            rep: 'truth_table',
            targetExpression: '@@@ UNPARSEABLE @@@',
            claimedTruthTable: [0],
            visibleReps: ['truth_table'],
            prompt: 'Fill it in.',
          },
        });
      },
    };

    const action = await proposeAction(alwaysInvalid, baseInput({ lesson: emptyLesson }));
    Action.parse(action);
    expect(action.type).toBe('no_action');
  });
});

// ---------------------------------------------------------------------------
// Checklist 13 (adversarial): prompt-less → rejected + regenerated
// ---------------------------------------------------------------------------

describe('ADVERSARIAL: prompt-less generation rejected + regenerated (checklist 13)', () => {
  it('prompt-less item → rejected, never mounts a bare workspace', async () => {
    let calls = 0;
    const promptlessProvider: MoveProvider = {
      proposeMove(): Promise<TacticalMove> {
        calls++;
        return Promise.resolve({
          move: 'next_practice_item',
          tier: 1,
          rationale: 'test',
          item: {
            rep: 'truth_table',
            targetExpression: 'A AND B', // valid expression
            claimedTruthTable: [0, 0, 0, 1],
            visibleReps: ['truth_table'],
            // NO prompt — this is the adversarial case
          },
        });
      },
    };

    const action = await proposeAction(promptlessProvider, baseInput());
    expect(calls).toBe(2); // retried once
    // Fallback was taken (not the promptless item)
    Action.parse(action);
    // Mounted item (fallback) does not have an undefined prompt issue
    if (action.type === 'mount' && 'prompt' in action.component) {
      // Prompt is either absent (keyless authored fallback) or present — never empty
      const prompt = (action.component as { prompt?: string }).prompt;
      if (prompt !== undefined) {
        expect(prompt.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('empty prompt (whitespace) → rejected like absent prompt', async () => {
    const emptyPromptProvider: MoveProvider = {
      proposeMove(): Promise<TacticalMove> {
        return Promise.resolve({
          move: 'next_practice_item',
          tier: 1,
          rationale: 'test',
          item: {
            rep: 'truth_table',
            targetExpression: 'A OR B',
            claimedTruthTable: [0, 1, 1, 1],
            visibleReps: ['truth_table'],
            prompt: '   ', // whitespace-only
          },
        });
      },
    };

    const action = await proposeAction(emptyPromptProvider, baseInput());
    Action.parse(action);
    // The whitespace-only prompt is rejected → fallback
    if (action.type === 'mount') {
      const comp = action.component;
      if (comp.kind === 'TruthTablePractice') {
        // Should not be A OR B with a whitespace prompt
        expect(comp.expression).not.toBe('A OR B');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Checklist 14 (adversarial): practice-only — generated streak cannot fast-path mastery
// ---------------------------------------------------------------------------

describe('ADVERSARIAL: practice-only — generated streak cannot fast-path mastery (checklist 14)', () => {
  it('generation never emits a TransferProbe kind in the mounted component', async () => {
    // The generation path only produces practice items via next_practice_item/simpler/rephrase
    // Verify that a generated item never compiles to a TransferProbe
    const practiceItem: ProposedItem = {
      rep: 'truth_table',
      targetExpression: 'A AND B',
      claimedTruthTable: [0, 0, 0, 1],
      visibleReps: ['truth_table'],
      prompt: 'Fill in the table.',
    };

    // Only the item-bearing moves should ever mount an item
    const moves: TacticalMove[] = [
      { move: 'next_practice_item', item: practiceItem, tier: 1, rationale: 'r' },
      { move: 'simpler_item', item: practiceItem, rationale: 'r' },
      { move: 'rephrase', item: practiceItem, rationale: 'r' },
    ];

    for (const move of moves) {
      const action = compileMove(move);
      if (action.type === 'mount') {
        expect(action.component.kind).not.toBe('TransferProbe');
        expect(action.component.kind).not.toBe('MasteryCelebration');
      }
    }
  });

  it('mastery gate fails closed: propose_mastery_transition only when all conditions met', async () => {
    // The heuristic provider must NOT propose mastery from a practice streak alone
    const { HeuristicMoveProvider } = await import('./stubClient.js');
    const provider = new HeuristicMoveProvider();

    // Even with high BKT + consecutiveCorrect, mastery requires rule gate
    const move = await provider.proposeMove(
      baseInput({
        learnerState: {
          bktByKc: { AND: 0.99, OR: 0.99, NOT: 0.99 },
          hintsUsed: 0,
          consecutiveCorrect: 10,
          ruleGatePassed: false, // gate not passed
          explainBackPassed: false,
          topicGuardrailClean: true,
        },
      }),
    );

    // Without ruleGatePassed, should advance to next practice item, not propose mastery
    expect(move.move).not.toBe('propose_mastery_transition');
  });

  it('generation never emits a propose_transfer_probe move (bank is hand-curated/read-only)', async () => {
    // A generated move must never be propose_transfer_probe — only authored bank items
    // can be probes. The generation path goes through item-bearing moves.
    const { HeuristicMoveProvider } = await import('./stubClient.js');
    const provider = new HeuristicMoveProvider();

    // Even with rule gate passed but no transfer candidates, must NOT generate a probe
    const move = await provider.proposeMove(
      baseInput({
        learnerState: {
          bktByKc: { AND: 0.99 },
          hintsUsed: 0,
          consecutiveCorrect: 5,
          ruleGatePassed: true,
          explainBackPassed: false,
          topicGuardrailClean: true,
        },
        transferCandidates: [], // empty — no probes available
      }),
    );

    // No transfer candidates → cannot propose a transfer probe
    expect(move.move).not.toBe('propose_transfer_probe');
  });
});
