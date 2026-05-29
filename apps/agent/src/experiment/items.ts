/**
 * F-17 item selection + exclusion (AC#2, AC#3, AC#6).
 *
 * The experiment protocol needs, per subject, mutually-exclusive item sets drawn
 * from the L1 transfer bank. There are exactly **8** L1 items (`L1-01-and`…
 * `L1-08-or-and`), so design (ii) is adopted (see the spec's build plan): the two
 * conditions SHARE one held-out 4-item post-test, giving `4 pre + 4 shared-post =
 * 8` exactly — zero slack. The follow-up reuses pre/post items in a DIFFERENT
 * `targetRep` rather than drawing new items (the bank can't supply more).
 *
 * `sampleUnusedItems` mirrors `readTransferCandidates`'s filter shape (exclude a
 * `usedSet`, L1 only) but sources `usedSet` from the subject's recorded usage
 * across the lifecycle, not a session event log. It throws `InsufficientItemsError`
 * when the bank can't supply `n` unused items — which, with 8 items + design (ii),
 * it won't for a correct run, but a buggy caller (or a future content regression)
 * surfaces loudly instead of silently serving a contaminated test.
 */

/** The lesson whose bank backs the experiment (L1 — the only fully-authored set). */
export const EXPERIMENT_LESSON_ID = 1;

/** A bank row as the experiment cares about it (the columns read for selection +
 *  scoring + the surface-form override). */
export interface ExperimentBankItem {
  itemId: string;
  targetExpression: string;
  targetRep: string;
  hiddenReps: string[];
}

/** Thrown when the bank cannot supply `n` items the subject hasn't already seen.
 *  With the 8-item L1 bank + design (ii) this never fires on a correct lifecycle;
 *  it's the loud failure mode if the design is violated (e.g. someone tries to
 *  give each arm its own post-test → needs 14 > 8). */
export class InsufficientItemsError extends Error {
  override name = 'InsufficientItemsError';
  constructor(requested: number, available: number) {
    super(`insufficient unseen transfer items: requested ${requested}, ${available} available`);
  }
}

/**
 * Pick `n` items from `bank` the subject hasn't used yet (`usedSet`), deterministic
 * in item-id order so a test against the real 8-item bank is reproducible. The
 * randomness in the *protocol* is the recruitment order, not per-draw shuffling —
 * and with exactly 8 items there is no slack to shuffle within anyway.
 *
 * Throws `InsufficientItemsError` when fewer than `n` unused items remain.
 */
export function sampleUnusedItems(
  bank: ExperimentBankItem[],
  usedSet: ReadonlySet<string>,
  n: number,
): ExperimentBankItem[] {
  const available = bank
    .filter((item) => !usedSet.has(item.itemId))
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
  if (available.length < n) {
    throw new InsufficientItemsError(n, available.length);
  }
  return available.slice(0, n);
}

/**
 * Pick a DIFFERENT surface form (`targetRep`) for a follow-up item than the one
 * the learner practiced/was tested on. The bank has no separate "alternate form"
 * field, so the only proxy is rotating off the item's own `targetRep` to a rep
 * that is NOT the original (design (ii)'s follow-up-by-rep-override). Prefers a
 * rep the item explicitly hid (it was deliberately held out, so it's a genuine
 * transfer), else any of the three reps that isn't the original.
 */
const ALL_REPS = ['truth_table', 'circuit', 'pseudocode'] as const;
export function differentSurfaceRep(item: ExperimentBankItem): string {
  const hidden = item.hiddenReps.find((r) => r !== item.targetRep);
  if (hidden) return hidden;
  const other = ALL_REPS.find((r) => r !== item.targetRep);
  // Every item has a targetRep among the three, so `other` is always defined; the
  // fallback keeps the function total for the type checker.
  return other ?? item.targetRep;
}

/** How many items each phase draws (design (ii), AC#2/#3/#4). */
export const PRETEST_N = 4;
export const POSTTEST_N = 4;
export const FOLLOWUP_N = 2;
