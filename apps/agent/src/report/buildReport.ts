import { eq } from 'drizzle-orm';
import { SessionSummarySchema, type SessionSummary } from '@polymath/contract';
import type { Db } from '../db/client.js';
import { sessions } from '../db/schema.js';

/**
 * Build the end-of-session summary report (the body of `GET /api/session/:id/report`).
 *
 * This is the minimum-viable producer that fixes the seam: it resolves whether the
 * session exists and returns a contract-valid `SessionSummary` (validated through
 * `SessionSummarySchema.parse`, so a drifting shape is caught here). The real number
 * assembly — pre/post scores, growth (`computeGrowthMultiplier`), transfer rate,
 * KC lists, explain-back verdict — is owned by the summary workstream and slots in
 * here.
 *
 * Returns `null` for an unknown session so the route can answer 404. Every numeric
 * field defaults to a fail-closed "not measured" value (`null` scores, empty KC
 * lists, a not-passed explain-back verdict) — an unbuilt report never fabricates a
 * pass.
 */
export async function buildReport(db: Db, sessionId: string): Promise<SessionSummary | null> {
  const found = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (found.length === 0) return null;

  const summary: SessionSummary = {
    preTestScore: null,
    postTestScore: null,
    growthMultiplier: null,
    timeOnTaskMs: 0,
    transferSuccessRate: 0,
    masteryStatus: 'not_started',
    explainBackVerdict: { passed: false, reasons: [] },
    kcsMastered: [],
    kcsStuck: [],
    source: 'in_session',
  };
  // Parse before returning so a future producer that drifts from the contract is
  // caught at this boundary, not silently shipped to the dashboard.
  return SessionSummarySchema.parse(summary);
}
