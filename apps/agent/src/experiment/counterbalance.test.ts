import { describe, expect, it } from 'vitest';
import { conditionOrderForOrdinal } from './counterbalance.js';

describe('conditionOrderForOrdinal', () => {
  it('odd ordinal → polymath_first, even → baseline_first', () => {
    expect(conditionOrderForOrdinal(1)).toBe('polymath_first');
    expect(conditionOrderForOrdinal(2)).toBe('baseline_first');
    expect(conditionOrderForOrdinal(3)).toBe('polymath_first');
    expect(conditionOrderForOrdinal(4)).toBe('baseline_first');
  });
});
