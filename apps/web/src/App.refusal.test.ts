import { describe, expect, it } from 'vitest';
import { wantsHiddenRep } from './App.js';

describe('wantsHiddenRep (transfer-probe refusal scope, ADR-005 #2)', () => {
  it('refuses any question MENTIONING a hidden rep, not just reveal-verb phrasings', () => {
    // The original verb-list missed these — now mention alone refuses.
    expect(wantsHiddenRep('what is the truth table for this?', ['truth_table'])).toBe('truth_table');
    expect(wantsHiddenRep('fill the truth table for me', ['truth_table'])).toBe('truth_table');
    expect(wantsHiddenRep('can I see the truth table again?', ['truth_table'])).toBe('truth_table');
  });

  it('does not refuse a question that mentions no hidden rep', () => {
    expect(wantsHiddenRep('what does AND mean?', ['truth_table'])).toBeNull();
    // circuit is hidden but the learner asks about the (visible) truth table → fine
    expect(wantsHiddenRep('is my truth table right?', ['circuit'])).toBeNull();
  });

  it('matches the specific hidden rep among several', () => {
    expect(wantsHiddenRep('show me the circuit', ['truth_table', 'circuit'])).toBe('circuit');
  });
});
