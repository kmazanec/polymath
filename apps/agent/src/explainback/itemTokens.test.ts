import { describe, expect, it } from 'vitest';
import { deriveItemTokens } from './itemTokens.js';
import { loadLesson } from '../lessons/loader.js';

/**
 * Precondition #5's token source: THIS item's variable names + operator literals,
 * derived SERVER-SIDE from the lesson/transfer item's targetExpression. DISTINCT
 * from the generic KC vocab (#4). VAR-CAPPED: a forged/wide expression must not
 * force a 2^n parse (CLAUDE.md DoS invariant); over-cap/unknown → empty set → #5
 * fails closed.
 */
describe('deriveItemTokens', () => {
  const lesson = loadLesson(1);

  it('resolves an L1 item by itemId → its vars + operators', () => {
    const tokens = deriveItemTokens('l1-and', lesson, []);
    expect(tokens).toContain('A');
    expect(tokens).toContain('B');
    expect(tokens.map((t) => t.toUpperCase())).toContain('AND');
  });

  it('resolves an item by targetExpression too (the web names items by expression)', () => {
    const tokens = deriveItemTokens('A OR B', lesson, []);
    expect(tokens).toContain('A');
    expect(tokens).toContain('B');
    expect(tokens.map((t) => t.toUpperCase())).toContain('OR');
  });

  it('resolves a transfer-bank item when the id is not in the lesson', () => {
    const tokens = deriveItemTokens(
      'L1-xfer-1',
      lesson,
      [{ itemId: 'L1-xfer-1', targetExpression: 'NOT A' }],
    );
    expect(tokens).toContain('A');
    expect(tokens.map((t) => t.toUpperCase())).toContain('NOT');
  });

  it('FAILS CLOSED: unknown/forged targetItemId → empty token set', () => {
    expect(deriveItemTokens('does-not-exist', lesson, [])).toEqual([]);
  });

  it('FAILS CLOSED: an over-cap (wide) expression → empty token set, no 2^n parse', () => {
    // 11 distinct vars > MAX_SUBMIT_VARS(10); the var-cap rejects it as empty rather
    // than enumerating. The id IS a transfer-bank row, so the only defense is the cap.
    const wide = 'A AND B AND C AND D AND E AND F AND G AND H AND I AND J AND K';
    expect(deriveItemTokens('wide', lesson, [{ itemId: 'wide', targetExpression: wide }])).toEqual([]);
  });

  it('FAILS CLOSED: an unparseable expression → empty token set, never a throw', () => {
    expect(deriveItemTokens('bad', lesson, [{ itemId: 'bad', targetExpression: 'A AND AND' }])).toEqual([]);
  });
});
