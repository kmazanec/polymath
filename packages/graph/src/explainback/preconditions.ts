import type { PreconditionReason } from '@polymath/contract';
import type { ProsodyFeatures } from './prosody.js';

/**
 * Stage 4a — the 5 deterministic explain-back preconditions (ADR-010 Layer 4).
 *
 * Pure, ordered, first-fail. Runs BEFORE any LLM (the structural anti-cheat). The
 * server clamps the recording window before calling this; `durationMs` here is the
 * SERVER-clamped `effectiveDurationMs`, never the raw client value (AC#9). A
 * missing/empty input FAILS CLOSED to the relevant reason — never a degraded pass.
 *
 * #4 (KC vocab) and #5 (item-specific reference) are DISTINCT checks (the
 * load-bearing anti-cheat per ADR-010 §Tradeoffs): #4 = generic lesson terms from
 * `kc_vocabulary.json`; #5 = THIS item's variable names + operators. Conflating them
 * voids the defense, so they read from separate token lists.
 */

/** Minimum response duration (anti-empty), ADR-010 Layer 4a #1. */
const MIN_DURATION_MS = 3_000;
/** Minimum word count (anti-empty), ADR-010 Layer 4a #3. */
const MIN_WORDS = 10;

export interface PreconditionInput {
  transcript: string;
  /** SERVER-clamped effective duration (min(client.durationMs, maxDurationSec*1000)). */
  durationMs: number;
  /** The mounted prompt's window cap; #2 is `durationMs ≤ maxDurationSec*1000`. */
  maxDurationSec: number;
  /** Generic lesson KC terms from `kc_vocabulary.json` (empty when missing → #4 fails). */
  kcVocabulary: string[];
  /** THIS item's variable names + operator literals (empty when unknown → #5 fails). */
  itemTokens: string[];
  /** Disfluency signals — NOT used by the preconditions (a missing prosody object
   *  never blocks); accepted so callers can pass one input object to 4a + 4b. */
  prosody?: ProsodyFeatures;
}

export interface PreconditionResult {
  passed: boolean;
  failedReason?: PreconditionReason;
}

/** Word count: collapse whitespace, drop empties. */
function wordCount(transcript: string): number {
  return transcript.split(/\s+/).filter((w) => w.length > 0).length;
}

/** Case-insensitive, word-boundary match: does the transcript contain ANY of
 *  `terms` as a whole word? Escapes regex metachars in each term. "android" must
 *  not match "AND"; "Band" must not match "B". */
function containsAnyToken(transcript: string, terms: string[]): boolean {
  const text = transcript.toLowerCase();
  for (const term of terms) {
    const t = term.trim().toLowerCase();
    if (t.length === 0) continue;
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // \b around the term; works for single-letter vars (A, B) and words (AND, gate).
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    if (re.test(text)) return true;
  }
  return false;
}

export function checkPreconditions(input: PreconditionInput): PreconditionResult {
  // #1 — duration ≥ 3s (anti-empty; also where a 15s silence lands, AC#2).
  if (input.durationMs < MIN_DURATION_MS) {
    return { passed: false, failedReason: 'duration_too_short' };
  }
  // #2 — duration ≤ maxDurationSec*1000 (anti-rambling / anti-LLM-pasting). The
  // server clamps already; this defends if an unclamped value ever reaches here.
  if (input.durationMs > input.maxDurationSec * 1000) {
    return { passed: false, failedReason: 'duration_too_long' };
  }
  // #3 — word count ≥ 10 (anti-empty).
  if (wordCount(input.transcript) < MIN_WORDS) {
    return { passed: false, failedReason: 'too_few_words' };
  }
  // #4 — at least one GENERIC KC vocab term. Empty list (missing file) → fail closed.
  if (!containsAnyToken(input.transcript, input.kcVocabulary)) {
    return { passed: false, failedReason: 'no_kc_vocab' };
  }
  // #5 — at least one ITEM-SPECIFIC token (this item's vars + operators). DISTINCT
  // from #4. Empty list (unknown/forged targetItemId) → fail closed.
  if (!containsAnyToken(input.transcript, input.itemTokens)) {
    return { passed: false, failedReason: 'no_item_reference' };
  }
  return { passed: true };
}
