import { describe, expect, it } from 'vitest';
import { checkPreconditions, type PreconditionInput } from './preconditions.js';

/**
 * Stage 4a — the 5 deterministic preconditions (ADR-010 Layer 4), in fixed order,
 * first-fail. These are the structural anti-cheat: a learner who cannot speak
 * fluently about THIS item, in the time available, with the right vocabulary, FAILS
 * before any LLM runs. Order matters (cheap → expensive, and the spec freezes it):
 *   1. duration ≥ 3000ms          → duration_too_short
 *   2. duration ≤ maxDurationSec*1000 → duration_too_long
 *   3. wordCount ≥ 10             → too_few_words
 *   4. ≥1 KC vocab term           → no_kc_vocab
 *   5. ≥1 ITEM-specific token     → no_item_reference   (DISTINCT from #4)
 */

const KC = ['AND', 'OR', 'NOT', 'true', 'false', 'output', 'input', 'gate', 'expression'];
const ITEM = ['A', 'B', 'AND']; // the just-probed item's vars + operators

function base(overrides: Partial<PreconditionInput> = {}): PreconditionInput {
  return {
    transcript:
      'For this AND gate the output is true only when both A and B are true, which is the bottom row.',
    durationMs: 11_000,
    maxDurationSec: 15,
    kcVocabulary: KC,
    itemTokens: ITEM,
    ...overrides,
  };
}

describe('checkPreconditions (ordered, first-fail)', () => {
  it('passes when all 5 hold', () => {
    expect(checkPreconditions(base())).toEqual({ passed: true });
  });

  it('#1 duration_too_short: AC#2 — 15s silence captured as a sub-3s/empty utterance', () => {
    // The clamp upstream caps long windows; a silent window arrives as near-zero
    // duration / empty transcript. Either way #1 trips first.
    expect(checkPreconditions(base({ durationMs: 1_500 }))).toEqual({
      passed: false,
      failedReason: 'duration_too_short',
    });
    expect(checkPreconditions(base({ durationMs: 0, transcript: '' }))).toEqual({
      passed: false,
      failedReason: 'duration_too_short',
    });
  });

  it('#1 boundary: exactly 3000ms passes #1', () => {
    // 3000ms is ≥3s, so #1 holds; the rest of the base input passes too.
    expect(checkPreconditions(base({ durationMs: 3_000 })).passed).toBe(true);
  });

  it('#2 duration_too_long: over maxDurationSec*1000 (server should clamp, but defends anyway)', () => {
    expect(checkPreconditions(base({ durationMs: 15_001 }))).toEqual({
      passed: false,
      failedReason: 'duration_too_long',
    });
  });

  it('#2 boundary: exactly maxDurationSec*1000 passes', () => {
    expect(checkPreconditions(base({ durationMs: 15_000 })).passed).toBe(true);
  });

  it('#3 too_few_words: < 10 words', () => {
    expect(checkPreconditions(base({ transcript: 'A AND B is true sometimes' }))).toEqual({
      passed: false,
      failedReason: 'too_few_words',
    });
  });

  it('#4 no_kc_vocab: 10+ words, item ref, but NO generic KC term', () => {
    // Mentions "A" and "B" (item tokens) repeatedly but avoids every KC vocab word.
    expect(
      checkPreconditions(
        base({
          transcript: 'A combined with B yields a result that I worked through carefully for this one',
          kcVocabulary: KC,
          itemTokens: ['A', 'B'],
        }),
      ),
    ).toEqual({ passed: false, failedReason: 'no_kc_vocab' });
  });

  it('#5 no_item_reference: AC#4 — the keyword-stuffing gamer (KC vocab, no item-specific ref)', () => {
    // "yeah I just used the AND and OR gates" — 10+ words, KC vocab present, but NO
    // reference to THIS item's variables (A/B). #4 passes, #5 fails. The load-bearing
    // anti-cheat: #4 and #5 are DISTINCT code paths.
    expect(
      checkPreconditions(
        base({
          transcript:
            'yeah I just used the AND and OR gates like the input and output expression stuff',
          kcVocabulary: KC,
          itemTokens: ['A', 'B'], // this item used vars A,B — not mentioned
        }),
      ),
    ).toEqual({ passed: false, failedReason: 'no_item_reference' });
  });

  it('#4 vs #5 are distinct: a transcript with item vars but no KC vocab fails #4 not #5', () => {
    const r = checkPreconditions(
      base({
        transcript: 'A combined with B yields a result that I worked through carefully for this one',
        itemTokens: ['A', 'B'],
      }),
    );
    expect(r.failedReason).toBe('no_kc_vocab');
  });

  it('KC + item matching is case-insensitive and word-boundary (no substring false positives)', () => {
    // "android" must NOT match the KC term "AND"; "Band" must NOT match item token "B".
    const r = checkPreconditions(
      base({
        transcript: 'my android Band played a brandnew song about something unrelated to logic entirely today',
        kcVocabulary: ['AND'],
        itemTokens: ['B'],
      }),
    );
    // No real KC term (only the substring inside "android"/"brandnew") → #4 fails.
    expect(r.failedReason).toBe('no_kc_vocab');
  });

  it('empty kcVocabulary (missing kc_vocabulary.json) FAILS CLOSED at #4', () => {
    // ADR-010 + CLAUDE.md: a missing/garbled vocab file → empty list → #4 fails. A
    // missing input is BLOCK, never a degraded pass.
    expect(checkPreconditions(base({ kcVocabulary: [] }))).toEqual({
      passed: false,
      failedReason: 'no_kc_vocab',
    });
  });

  it('empty itemTokens (unknown/forged targetItemId) FAILS CLOSED at #5', () => {
    expect(checkPreconditions(base({ itemTokens: [] }))).toEqual({
      passed: false,
      failedReason: 'no_item_reference',
    });
  });
});
