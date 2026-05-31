/**
 * F-29 / F-32 generation golden cases (deterministic, offline — no LLM key needed).
 *
 * These are the "generation validity" cases for the golden set. Each case is a
 * scenario where the engine validates (or rejects) a generated item:
 *  - in-rails + valid prompt → passes, engine key correct
 *  - wrong claimedTruthTable → engine OVERWRITES (not rejected) → passes
 *  - over-var-cap → rejected/never enumerated (fast)
 *  - unparseable → rejected
 *  - prompt-less → rejected
 *  - out-of-alphabet → rejected
 *
 * All cases are deterministic (no LLM, no network). The suite gates MRs.
 *
 * F-32 will fold these into its golden set format (evals/golden/generation.json)
 * when it builds the eval harness. Until then, these run as a standalone test
 * that proves the generation validity pipeline is correct at 100%.
 */

import { describe, expect, it } from 'vitest';
import { checkGeneratedItem } from './rails.js';
import { computeItemKey } from './key.js';
import { proposeAction } from './graph.js';
import type { AgentInput, MoveProvider } from './client.js';
import type { TacticalMove } from './menu.js';
import { loadLesson } from '../lessons/loader.js';
import { Action } from '@polymath/contract';

const lesson1 = loadLesson(1);
const lesson3 = loadLesson(3);

function makeInput(lessonId: number): AgentInput {
  const lesson = loadLesson(lessonId);
  return {
    event: {
      kind: 'submit',
      sessionId: '00000000-0000-0000-0000-000000000000',
      itemId: 'l1-and',
      submission: 'A AND B',
    },
    lesson,
    learnerState: {
      bktByKc: {},
      hintsUsed: 0,
      consecutiveCorrect: 1,
      ruleGatePassed: false,
      explainBackPassed: false,
      topicGuardrailClean: true,
    },
    recentHistory: [],
  };
}

describe('F-29 generation golden cases (offline, 100% deterministic)', () => {

  // ---------------------------------------------------------------------------
  // Case 1: in-rails expression with prompt → passes, engine computes correct key
  // ---------------------------------------------------------------------------
  it('GOLDEN: in-rails A AND B with prompt → passes, engine key [0,0,0,1]', () => {
    const result = checkGeneratedItem(
      { expression: 'A AND B', prompt: 'Fill in the truth table for A AND B.' },
      makeInput(1),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.table).toEqual([0, 0, 0, 1]);
  });

  it('GOLDEN: in-rails (A OR B) AND NOT A with prompt → passes', () => {
    const result = checkGeneratedItem(
      { expression: '(A OR B) AND NOT A', prompt: 'Fill in the truth table for (A OR B) AND NOT A.' },
      makeInput(1),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.table).toEqual([0, 1, 0, 0]);
  });

  it('GOLDEN: lesson 3 NAND expression → passes (NAND in alphabet)', () => {
    const result = checkGeneratedItem(
      { expression: 'A NAND B', prompt: 'Fill in the NAND truth table.' },
      makeInput(3),
    );
    expect(result.ok).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Case 2: wrong claimedTruthTable → engine OVERWRITES (not a rejection)
  // ---------------------------------------------------------------------------
  it('GOLDEN: wrong claimedTruthTable → engine overwrites with correct key', async () => {
    // The adversarial test: model asserts wrong key, engine corrects it
    class WrongKeyProvider implements MoveProvider {
      proposeMove(): Promise<TacticalMove> {
        return Promise.resolve({
          move: 'next_practice_item',
          tier: 1,
          rationale: 'wrong key',
          item: {
            rep: 'truth_table',
            targetExpression: 'A OR B',
            claimedTruthTable: [1, 0, 0, 0], // completely wrong
            visibleReps: ['truth_table'],
            prompt: 'Fill in the truth table for A OR B.',
          },
        });
      }
    }
    const action = await proposeAction(new WrongKeyProvider(), makeInput(1));
    expect(action.type).toBe('mount');
    if (action.type !== 'mount') throw new Error('unreachable');
    if (action.component.kind !== 'TruthTablePractice') throw new Error('expected TruthTablePractice');
    // Engine overwrote to the correct key
    expect(action.component.claimedTruthTable).toEqual([0, 1, 1, 1]);
    Action.parse(action);
  });

  // ---------------------------------------------------------------------------
  // Case 3: over-var-cap → rejected, never enumerated
  // ---------------------------------------------------------------------------
  it('GOLDEN: 11-var expression → rejected, completes in <50ms (no enumeration)', () => {
    const expr = 'A AND B AND C AND D AND E AND F AND G AND H AND I AND J AND K';
    const start = Date.now();
    const result = checkGeneratedItem({ expression: expr, prompt: 'Fill it in.' }, makeInput(1));
    expect(Date.now() - start).toBeLessThan(50);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.detail).toMatch(/cap/i);
  });

  it('GOLDEN: 11-var expression via computeItemKey → {ok:false}, fast', () => {
    const expr = 'A AND B AND C AND D AND E AND F AND G AND H AND I AND J AND K';
    const start = Date.now();
    const result = computeItemKey(expr);
    expect(Date.now() - start).toBeLessThan(50);
    expect(result.ok).toBe(false);
  });

  it('GOLDEN: 10-var expression (at cap) → accepted by computeItemKey', () => {
    const expr = 'A AND B AND C AND D AND E AND F AND G AND H AND I AND J';
    const result = computeItemKey(expr);
    expect(result.ok).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Case 4: unparseable → rejected
  // ---------------------------------------------------------------------------
  it('GOLDEN: unparseable expression → rejected with detail', () => {
    const result = checkGeneratedItem(
      { expression: '@@@ NOT VALID @@@', prompt: 'Fill it in.' },
      makeInput(1),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.detail.length).toBeGreaterThan(0);
  });

  it('GOLDEN: empty expression → rejected', () => {
    const result = computeItemKey('');
    expect(result.ok).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Case 5: prompt-less → rejected
  // ---------------------------------------------------------------------------
  it('GOLDEN: missing prompt → rejected (workspace must never be bare)', () => {
    const result = checkGeneratedItem(
      { expression: 'A AND B', prompt: undefined },
      makeInput(1),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.detail).toMatch(/prompt/i);
  });

  it('GOLDEN: empty prompt → rejected', () => {
    const result = checkGeneratedItem(
      { expression: 'A AND B', prompt: '' },
      makeInput(1),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.detail).toMatch(/prompt/i);
  });

  it('GOLDEN: whitespace-only prompt → rejected', () => {
    const result = checkGeneratedItem(
      { expression: 'A AND B', prompt: '   \t\n   ' },
      makeInput(1),
    );
    expect(result.ok).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Case 6: out-of-alphabet → rejected
  // ---------------------------------------------------------------------------
  it('GOLDEN: NAND on lesson 1 → rejected (not in lesson-1 alphabet)', () => {
    const result = checkGeneratedItem(
      { expression: 'A NAND B', prompt: 'Fill in the NAND table.' },
      makeInput(1),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.detail).toMatch(/alphabet/i);
  });

  it('GOLDEN: NOR on lesson 1 → rejected', () => {
    const result = checkGeneratedItem(
      { expression: 'A NOR B', prompt: 'Fill in the NOR table.' },
      makeInput(1),
    );
    expect(result.ok).toBe(false);
  });

  it('GOLDEN: NOR on lesson 3 → rejected (NOR not in alphabet until lesson 4)', () => {
    const result = checkGeneratedItem(
      { expression: 'A NOR B', prompt: 'Fill in the NOR table.' },
      makeInput(3),
    );
    expect(result.ok).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Case 7: generation never emits a TransferProbe (practice-only)
  // ---------------------------------------------------------------------------
  it('GOLDEN: proposeAction with item-bearing move never mounts a TransferProbe', async () => {
    // Item-bearing moves (next_practice_item / simpler_item / rephrase) compile to
    // TruthTablePractice / CircuitBuilder / PseudocodeChallenge — never TransferProbe.
    class PracticeProvider implements MoveProvider {
      proposeMove(): Promise<TacticalMove> {
        return Promise.resolve({
          move: 'next_practice_item',
          tier: 1,
          rationale: 'test',
          item: {
            rep: 'truth_table',
            targetExpression: 'A AND B',
            claimedTruthTable: [0, 0, 0, 1],
            visibleReps: ['truth_table'],
            prompt: 'Fill in the truth table for A AND B.',
          },
        });
      }
    }
    const action = await proposeAction(new PracticeProvider(), makeInput(1));
    if (action.type === 'mount') {
      expect(action.component.kind).not.toBe('TransferProbe');
    }
  });

  // ---------------------------------------------------------------------------
  // Case 8: taught-concepts composition (cross-lesson operators) allowed
  // ---------------------------------------------------------------------------
  it('GOLDEN: lesson 3 compound expression using AND + NOT (from lesson 1) → passes', () => {
    // Lesson 3 alphabet includes lesson 1 operators (AND, OR, NOT) + NAND
    const result = checkGeneratedItem(
      {
        expression: 'A AND NOT B',
        prompt: 'Fill in the truth table for A AND NOT B.',
      },
      makeInput(3),
    );
    expect(result.ok).toBe(true);
  });

  it('GOLDEN: lesson 3 compound NAND + AND (cross-lesson composition) → passes', () => {
    const result = checkGeneratedItem(
      {
        expression: '(A NAND B) AND NOT A',
        prompt: 'Fill in the truth table for (A NAND B) AND NOT A.',
      },
      makeInput(3),
    );
    expect(result.ok).toBe(true);
  });
});
