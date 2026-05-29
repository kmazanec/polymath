import { and, eq, isNull } from 'drizzle-orm';
import type { HandoffArtifact } from '@polymath/contract';
import type { Db } from '../db/client.js';
import { sessions } from '../db/schema.js';
import { buildHandoffArtifact, makeHandoffArtifactDeps, type HandoffArtifactDeps } from './buildArtifact.js';
import { mintShareToken, validateShareToken } from './shareToken.js';

/**
 * The tutor-handoff HTTP route (ADR-012 stretch). Two read-only shapes:
 *
 *   GET /api/session/:id/handoff
 *     The learner's own session. Builds the artifact, lazily mints + persists a
 *     share token (so the page can offer a shareable URL), and returns
 *     `{ artifact, shareUrl }`.
 *
 *   GET /api/session/:id/handoff/:token
 *     A shared link. The random per-session token authenticates the request — NOT
 *     the (guessable-by-enumeration) session UUID — so this route is EXEMPT from
 *     operator auth (the `followup_token` precedent; the artifact is the learner's
 *     own, intentionally shareable). A wrong token → 403; a session with no minted
 *     token → 403 (you can only reach the tokened path via a share URL that carries
 *     a real token). Fails CLOSED throughout.
 *
 * The session read is scoped to Polymath rows (`sessions.app IS NULL`) inside the
 * artifact builder, so a baseline-arm session id never yields a Polymath artifact.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[0-9a-f]+$/i;

export interface HandoffRouteResult {
  status: number;
  body: unknown;
}

export interface HandoffRouteDeps {
  db: Db;
  /** The artifact builder (DI for tests). Defaults to the real DB-backed deps. */
  artifactDeps?: HandoffArtifactDeps;
}

/** Lazily fetch-or-mint the session's share token. Returns the token, or `null` if
 *  the session does not exist (a Polymath session row). */
async function ensureShareToken(db: Db, sessionId: string): Promise<string | null> {
  const rows = await db
    .select({ shareToken: sessions.shareToken })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), isNull(sessions.app)))
    .limit(1);
  if (rows.length === 0) return null;
  const existing = rows[0]!.shareToken;
  if (existing) return existing;
  const token = mintShareToken();
  // Persist. Concurrent first-shares could both mint; the UNIQUE constraint makes a
  // collision a no-op write — re-read to return whichever token won.
  await db
    .update(sessions)
    .set({ shareToken: token })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.app)));
  const after = await db
    .select({ shareToken: sessions.shareToken })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), isNull(sessions.app)))
    .limit(1);
  return after[0]?.shareToken ?? token;
}

/** Read the stored share token for a session (Polymath rows only). */
async function readShareToken(db: Db, sessionId: string): Promise<string | null | undefined> {
  const rows = await db
    .select({ shareToken: sessions.shareToken })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), isNull(sessions.app)))
    .limit(1);
  if (rows.length === 0) return undefined; // session does not exist
  return rows[0]!.shareToken;
}

/**
 * Try to handle a handoff request. Returns `null` when the path/method is not a
 * handoff route (the server falls through to its 404), or a `{ status, body }` to
 * send. Never throws — a thrown builder/DB error is mapped to a 500 by the caller.
 */
export async function tryHandleHandoffRoute(
  deps: HandoffRouteDeps,
  method: string,
  pathname: string,
): Promise<HandoffRouteResult | null> {
  const tokened = pathname.match(/^\/api\/session\/([^/]+)\/handoff\/([^/]+)$/);
  const bare = pathname.match(/^\/api\/session\/([^/]+)\/handoff$/);
  if (!tokened && !bare) return null;
  if (method !== 'GET') return { status: 405, body: { error: 'method not allowed' } };

  const sessionId = (tokened ?? bare)![1]!;
  if (!UUID_RE.test(sessionId)) {
    return { status: 400, body: { error: 'sessionId must be a UUID' } };
  }

  const artifactDeps = deps.artifactDeps ?? makeHandoffArtifactDeps(deps.db);

  // The tokened (shared) path: authenticate with the per-session random token first.
  if (tokened) {
    const presented = tokened[2]!;
    if (!TOKEN_RE.test(presented)) {
      return { status: 403, body: { error: 'invalid share token' } };
    }
    const stored = await readShareToken(deps.db, sessionId);
    if (stored === undefined) {
      return { status: 404, body: { error: 'unknown session' } };
    }
    // stored may be null (never shared) → validate fails closed → 403.
    if (!validateShareToken(stored, presented)) {
      return { status: 403, body: { error: 'invalid share token' } };
    }
    const artifact = await buildHandoffArtifact(artifactDeps, sessionId);
    if (!artifact) return { status: 404, body: { error: 'unknown session' } };
    return { status: 200, body: { artifact } };
  }

  // The bare (owner) path: build the artifact, lazily mint + return a share URL.
  const artifact = await buildHandoffArtifact(artifactDeps, sessionId);
  if (!artifact) return { status: 404, body: { error: 'unknown session' } };
  const token = await ensureShareToken(deps.db, sessionId);
  const shareUrl = token ? `/handoff/${sessionId}/${token}` : null;
  return { status: 200, body: { artifact, shareUrl } satisfies HandoffBareResponse };
}

interface HandoffBareResponse {
  artifact: HandoffArtifact;
  shareUrl: string | null;
}
