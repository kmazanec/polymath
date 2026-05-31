import { describe, expect, it } from 'vitest';
import {
  allowedOperatorAlphabet,
  lessonMaxVars,
  checkGeneratedItem,
} from './rails.js';
import { loadLesson } from '../lessons/loader.js';
import type { AgentInput } from './client.js';

/**
 * Tests for rails enforcement (F-29 checklist item 4).
 *
 * Rails = (a) operator alphabet ⊆ operators in taught lessons ≤ currentLessonId,
 *         (b) var count ≤ lesson max (≤ cap),
 *         (c) prompt presence.
 */

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

// ---------------------------------------------------------------------------
// allowedOperatorAlphabet
// ---------------------------------------------------------------------------

describe('allowedOperatorAlphabet', () => {
  it('lesson 1 alphabet contains AND, OR, NOT (the basics)', () => {
    const alpha = allowedOperatorAlphabet(1);
    expect(alpha).toContain('AND');
    expect(alpha).toContain('OR');
    expect(alpha).toContain('NOT');
  });

  it('lesson 3 alphabet also includes NAND (taught in lesson 3)', () => {
    const alpha = allowedOperatorAlphabet(3);
    expect(alpha).toContain('NAND');
  });

  it('alphabet for lesson 1 does NOT include NAND (not taught yet)', () => {
    const alpha = allowedOperatorAlphabet(1);
    expect(alpha).not.toContain('NAND');
  });

  it('lesson 4 alphabet includes NOR (taught in lesson 4)', () => {
    const alpha = allowedOperatorAlphabet(4);
    expect(alpha).toContain('NOR');
  });

  it('alphabet for lesson 3 does NOT include NOR (not taught until lesson 4)', () => {
    const alpha = allowedOperatorAlphabet(3);
    expect(alpha).not.toContain('NOR');
  });

  it('includes operators from ALL prior lessons (union, not current-only)', () => {
    // lesson 3 teaches NAND; lesson 1 teaches AND/OR/NOT
    // → lesson-3 alphabet should include AND, OR, NOT, NAND
    const alpha = allowedOperatorAlphabet(3);
    expect(alpha).toContain('AND');
    expect(alpha).toContain('OR');
    expect(alpha).toContain('NOT');
    expect(alpha).toContain('NAND');
  });
});

// ---------------------------------------------------------------------------
// lessonMaxVars
// ---------------------------------------------------------------------------

describe('lessonMaxVars', () => {
  it('returns the maximum variable count from lesson items', () => {
    const max = lessonMaxVars(1);
    expect(max).toBeGreaterThanOrEqual(1);
    expect(max).toBeLessThanOrEqual(10); // never exceeds the cap
  });

  it('lesson 2 max vars >= lesson 1 max vars (harder lessons use more vars)', () => {
    const max1 = lessonMaxVars(1);
    const max2 = lessonMaxVars(2);
    expect(max2).toBeGreaterThanOrEqual(max1);
  });
});

// ---------------------------------------------------------------------------
// checkGeneratedItem — happy path
// ---------------------------------------------------------------------------

describe('checkGeneratedItem — happy path', () => {
  it('in-rails expression with a prompt → passes and returns computed engine key', () => {
    const input = makeInput(1);
    const result = checkGeneratedItem(
      { expression: 'A AND B', prompt: 'What is the output of A AND B?' },
      input,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    // Engine key must be the correct MSB-first table
    expect(result.table).toEqual([0, 0, 0, 1]);
  });

  it('OR expression with a prompt on lesson 1 → passes', () => {
    const input = makeInput(1);
    const result = checkGeneratedItem(
      { expression: 'A OR B', prompt: 'Fill in the truth table for A OR B.' },
      input,
    );
    expect(result.ok).toBe(true);
  });

  it('composed expression allowed (taught concepts across lessons)', () => {
    // Lesson 3 teaches NAND on top of AND/OR/NOT — composition allowed
    const input = makeInput(3);
    const result = checkGeneratedItem(
      { expression: 'A NAND B', prompt: 'Fill the NAND truth table.' },
      input,
    );
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkGeneratedItem — adversarial rejections
// ---------------------------------------------------------------------------

describe('checkGeneratedItem — adversarial: out-of-alphabet', () => {
  it('ADVERSARIAL: NAND on a lesson-1-only lesson → rejected (not yet taught)', () => {
    const input = makeInput(1);
    const result = checkGeneratedItem(
      { expression: 'A NAND B', prompt: 'Fill in the NAND table.' },
      input,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.detail).toMatch(/alphabet/i);
  });

  it('ADVERSARIAL: NOR on lesson 1 → rejected (not in alphabet)', () => {
    const input = makeInput(1);
    const result = checkGeneratedItem(
      { expression: 'A NOR B', prompt: 'Fill the NOR table.' },
      input,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.detail).toMatch(/alphabet/i);
  });

  it('ADVERSARIAL: NOR on lesson 3 → rejected (NOR not in alphabet until lesson 4)', () => {
    const input = makeInput(3);
    const result = checkGeneratedItem(
      { expression: 'A NOR B', prompt: 'Fill the NOR table.' },
      input,
    );
    expect(result.ok).toBe(false);
  });
});

describe('checkGeneratedItem — adversarial: over-var-cap', () => {
  it('ADVERSARIAL: over-var-cap expression → rejected, never enumerated (fast)', () => {
    const input = makeInput(1);
    const overcapExpr = 'A AND B AND C AND D AND E AND F AND G AND H AND I AND J AND K';
    const start = Date.now();
    const result = checkGeneratedItem({ expression: overcapExpr, prompt: 'Fill it in.' }, input);
    const elapsed = Date.now() - start;
    expect(result.ok).toBe(false);
    expect(elapsed).toBeLessThan(50);
  });
});

describe('checkGeneratedItem — adversarial: unparseable', () => {
  it('ADVERSARIAL: unparseable expression → rejected', () => {
    const input = makeInput(1);
    const result = checkGeneratedItem(
      { expression: '@@@ NOT VALID', prompt: 'Fill it in.' },
      input,
    );
    expect(result.ok).toBe(false);
  });
});

describe('checkGeneratedItem — adversarial: prompt-less', () => {
  it('ADVERSARIAL: missing prompt → rejected (a workspace must never be bare)', () => {
    const input = makeInput(1);
    const result = checkGeneratedItem({ expression: 'A AND B', prompt: '' }, input);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.detail).toMatch(/prompt/i);
  });

  it('ADVERSARIAL: undefined prompt → rejected', () => {
    const input = makeInput(1);
    const result = checkGeneratedItem(
      { expression: 'A AND B', prompt: undefined },
      input,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.detail).toMatch(/prompt/i);
  });

  it('ADVERSARIAL: whitespace-only prompt → rejected', () => {
    const input = makeInput(1);
    const result = checkGeneratedItem({ expression: 'A AND B', prompt: '   ' }, input);
    expect(result.ok).toBe(false);
  });
});

describe('checkGeneratedItem — over-lesson-max-vars', () => {
  it('expression using more variables than lesson max → rejected', () => {
    // Lesson 1 max vars = 2 (A AND B, A OR B, NOT A, (A OR B) AND NOT A)
    // An expression with 3+ variables exceeds the lesson max for lesson 1
    const input = makeInput(1);
    const result = checkGeneratedItem(
      { expression: 'A AND B AND C', prompt: 'Fill it in.' },
      input,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.detail).toMatch(/var/i);
  });
});
