/**
 * Circuit-suppression split-test (visual-utility metric, D6: designed-for + DORMANT).
 *
 * For a SMALL matched set of items, the experiment can suppress the circuit view and
 * compare time-to-correct against the circuit-shown arm — measuring whether the
 * circuit representation actually helps. This is the only genuinely intrusive change
 * in the counter-metrics work, so it ships OFF by default behind an explicit env
 * opt-in (`POLYMATH_ENABLE_CIRCUIT_SPLIT_TEST=true`). When off, no arm is assigned and
 * the metric reports `unconfigured` — a half-wired suppression is worse than an honest
 * gray tile.
 *
 * The arm decision is:
 *  - SCOPED to `MATCHED_SPLIT_ITEMS` only (no effect on any other item);
 *  - DETERMINISTIC per item (a stable hash, not a coin flip) so a reconnect / re-run
 *    keeps the same item in the same arm — a flapping arm would void the comparison;
 *  - ORTHOGONAL to `spec.visibleReps`: this is a metrics ANNOTATION persisted on the
 *    event payload, never a change to which reps a probe hides (the probe-integrity
 *    boundary is untouched).
 *
 * The arm is recorded as the optional `circuitSuppressed` field on the persisted
 * per-turn `events` payload (append-only; absent on every non-matched/dormant turn).
 */

/** The small matched item set the split-test applies to (lesson practice items). */
export const MATCHED_SPLIT_ITEMS: readonly string[] = ['l1-and', 'l1-or', 'l2-and-or-c', 'l2-nor'];

/** A tiny deterministic string hash (FNV-1a, 32-bit) — stable across processes, so an
 *  item's arm never flaps between turns/reconnects. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The suppression arm for an item, or `undefined` when the split-test is off or the
 * item is not in the matched set. `true` = circuit suppressed; `false` = circuit shown.
 */
export function circuitSuppressionArm(itemId: string, enabled: boolean): boolean | undefined {
  if (!enabled) return undefined;
  if (!MATCHED_SPLIT_ITEMS.includes(itemId)) return undefined;
  return hash32(itemId) % 2 === 0;
}
