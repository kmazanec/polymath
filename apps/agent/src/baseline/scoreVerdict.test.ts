import { describe, expect, it } from 'vitest';
import { scoreVerdict } from './service.js';

/**
 * F-16 fairness boundary: a baseline chat learner types FREE TEXT, so the verdict
 * must distinguish three cases (CLAUDE.md fairness + DoS invariants, ADR-011):
 *   - a correct Boolean expression  → true
 *   - an incorrect Boolean expression → false  (NOT a crash, NOT a re-prompt)
 *   - prose / a question             → null   (a re-prompt, NOT auto-wrong)
 *
 * Correctness is decided by the SHARED scoreEquivalence (var cap ≤10 + parse-error
 * → false) — the same truth-maker Polymath uses; never an LLM "is this right?".
 */
describe('scoreVerdict — three-way classify (correct / incorrect / not-an-expression)', () => {
  it('a correct, logically-equivalent expression scores true (commutativity etc.)', () => {
    expect(scoreVerdict('A AND B', 'A AND B')).toBe(true);
    expect(scoreVerdict('B AND A', 'A AND B')).toBe(true);
    expect(scoreVerdict('(NOT A) OR (NOT B)', 'NOT (A AND B)')).toBe(true);
  });

  it('an incorrect expression scores false (not a crash, not a re-prompt)', () => {
    expect(scoreVerdict('A OR B', 'A AND B')).toBe(false);
    expect(scoreVerdict('NOT A', 'A AND B')).toBe(false);
  });

  it('prose / a question is null (a re-prompt, never auto-marked wrong)', () => {
    expect(scoreVerdict('what does AND mean?', 'A AND B')).toBeNull();
    expect(scoreVerdict('I think it is both of them', 'A AND B')).toBeNull();
    expect(scoreVerdict('can you give me a hint', 'A AND B')).toBeNull();
    expect(scoreVerdict('', 'A AND B')).toBeNull();
  });

  it('an over-cap (>10 distinct vars) expression scores false, never a 2^n enumeration (DoS guard)', () => {
    const wide = Array.from({ length: 11 }, (_, i) => String.fromCharCode(65 + i)).join(' AND ');
    expect(scoreVerdict(wide, 'A AND B')).toBe(false);
  });

  it('an incomplete expression attempt ("A AND") is a wrong expression, not prose', () => {
    expect(scoreVerdict('A AND', 'A AND B')).toBe(false);
  });
});
