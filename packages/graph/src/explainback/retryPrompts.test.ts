import { describe, expect, it } from 'vitest';
import { retryPromptFor } from './retryPrompts.js';
import type { PreconditionReason } from '@polymath/contract';

describe('retryPromptFor (stock copy per precondition reason)', () => {
  it('no_item_reference → asks for the specific variables (AC#4)', () => {
    expect(retryPromptFor('no_item_reference')).toMatch(/specific variables/i);
  });

  it('duration_too_short → asks the learner to please respond', () => {
    expect(retryPromptFor('duration_too_short')).toMatch(/respond|hear you/i);
  });

  it('too_few_words → tells them it was too short, try again', () => {
    expect(retryPromptFor('too_few_words')).toMatch(/too short|try again/i);
  });

  it('every reason maps to non-empty copy (incl. fail-closed judge_unavailable)', () => {
    const reasons: PreconditionReason[] = [
      'duration_too_short',
      'duration_too_long',
      'too_few_words',
      'no_kc_vocab',
      'no_item_reference',
      'judge_unavailable',
    ];
    for (const r of reasons) {
      expect(retryPromptFor(r).length).toBeGreaterThan(0);
    }
  });

  it('picks the FIRST reason when several are present (deterministic)', () => {
    expect(retryPromptForFirst(['duration_too_short', 'too_few_words'])).toBe(
      retryPromptFor('duration_too_short'),
    );
  });

  it('falls back to a generic retry when the reason list is empty', () => {
    expect(retryPromptForFirst([]).length).toBeGreaterThan(0);
  });
});

// Local helper mirroring the route's "first reason" selection, to pin the contract.
import { retryPromptForFirst } from './retryPrompts.js';
