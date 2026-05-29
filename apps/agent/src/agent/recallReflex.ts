import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { events, learnerState } from '../db/schema.js';
import { detectRegression, type RegressionHit } from './regression.js';

/**
 * F-14 — server-side data reads for the cross-lesson recall reflex.
 *
 * The reflex itself lives in `server.ts` (alongside the explain-back / transfer
 * reflexes); this module owns the two DB reads it needs, kept here so the
 * monotonic-throttle invariant is enforced in ONE auditable place.
 *
 * Two SERVER-DERIVED inputs (CLAUDE.md "server-derive integrity signals"):
 *  1. `readL1Bkt` — the prior-lesson KC BKT, from `learner_state` (one row per
 *     (session, kc)). The cross-lesson trigger; only ever populated for an L1 KC
 *     once the SAME session ran L1 (i.e. after F-15's in-session L1→L2 transition).
 *  2. `countRecalledKcs` — how many `CrossLessonRecall` cards have already been
 *     mounted this session, PER KC, from a SEPARATE UNCAPPED `count(*)` over the
 *     full `events` log. This is the "≤1 recall per session per KC" throttle. It
 *     MUST NOT be derived from the bounded `MAX_SESSION_EVENTS` fold: a monotonic
 *     integrity counter folded over a capped window can be reset by pushing the
 *     recall rows out with benign frames (a fail-open drift). Modeled exactly on
 *     `countOffTopicAnswers` (server.ts).
 */

/** Read the L1 KC → BKT probability map for a session, restricted to the given
 *  L1 KC names. A KC with no row (never practiced this session) is simply absent
 *  from the map — `detectRegression` treats absence as "no regression to recall".
 *  A null `bkt_probability` is skipped (degrade, never throw). */
export async function readL1Bkt(
  db: Db,
  sessionId: string,
  l1Kcs: readonly string[],
): Promise<Record<string, number>> {
  if (l1Kcs.length === 0) return {};
  const rows = await db
    .select({ kc: learnerState.kc, bkt: learnerState.bktProbability })
    .from(learnerState)
    .where(
      sql`${learnerState.sessionId} = ${sessionId}
        AND ${learnerState.kc} IN (${sql.join(
          l1Kcs.map((kc) => sql`${kc}`),
          sql`, `,
        )})`,
    );
  const out: Record<string, number> = {};
  for (const row of rows) {
    if (typeof row.bkt === 'number' && !Number.isNaN(row.bkt)) out[row.kc] = row.bkt;
  }
  return out;
}

/**
 * The KCs already recalled this session — a SEPARATE UNCAPPED aggregate over the
 * full event log (the monotonic-throttle invariant). Counts every persisted turn
 * whose mounted action was a `CrossLessonRecall`, grouped by its `kc` slot, and
 * returns the set of KC names with ≥1 recall. Never the bounded fold.
 */
export async function readRecalledKcs(db: Db, sessionId: string): Promise<string[]> {
  const rows = await db
    .select({ kc: sql<string>`${events.payload} -> 'action' -> 'component' ->> 'kc'` })
    .from(events)
    .where(
      sql`${events.sessionId} = ${sessionId}
        AND ${events.payload} -> 'action' -> 'component' ->> 'kind' = 'CrossLessonRecall'`,
    )
    .groupBy(sql`${events.payload} -> 'action' -> 'component' ->> 'kc'`);
  return rows.map((r) => r.kc).filter((kc): kc is string => typeof kc === 'string' && kc.length > 0);
}

/**
 * Compute the recall reflex's decision for a turn. Reads the two server-derived
 * inputs, then runs the pure `detectRegression`. Returns the regression hit (the
 * slots for a `CrossLessonRecall` mount) or null. The caller (server.ts) decides
 * whether to mount it — gating on phase (suppressed during `transferring`) and
 * lesson (production trigger only on lesson > 1; the synthetic seam supplies the
 * map standalone).
 *
 * `injectedL1Bkt` is the `POLYMATH_ENABLE_TEST_SEAMS`-gated synthetic L1 BKT for
 * standalone build/eval (there is no real L1 state in an L2 session until F-15).
 * When present it REPLACES the DB read (the eval drives the reflex deterministically
 * without a prior L1 run); when absent the real `learner_state` read is used.
 */
export async function computeRecall(
  db: Db,
  sessionId: string,
  currentItemId: string,
  l1Kcs: readonly string[],
  injectedL1Bkt: Record<string, number> | undefined,
): Promise<RegressionHit | null> {
  const l1BktByKc = injectedL1Bkt ?? (await readL1Bkt(db, sessionId, l1Kcs));
  if (Object.keys(l1BktByKc).length === 0) return null;
  const alreadyRecalledKcs = await readRecalledKcs(db, sessionId);
  return detectRegression({ l1BktByKc, alreadyRecalledKcs, currentItemId });
}
