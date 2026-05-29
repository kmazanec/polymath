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
 *     The learner's own session. Builds + returns the artifact. If a share token has
 *     ALREADY been minted (via the POST below) it also returns the `shareUrl`, but it
 *     does NOT mint one — reading your own artifact must not silently create a durable
 *     public link. Returns `{ artifact, shareUrl: string | null }`.
 *
 *   POST /api/session/:id/handoff/share
 *     Explicitly create (or fetch the existing) share token for the session and return
 *     `{ shareUrl }`. Minting a durable, publicly-fetchable link is an explicit ACTION,
 *     never a side effect of a read (MR !9 review): the prior GET auto-minted, so any
 *     caller who learned the session UUID from a log/screenshot/history could mint a
 *     permanent share link without the learner's consent. The artifact itself stays the
 *     learner's own, UUID-readable, documented-exempt-from-operator-auth (D24-3).
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
  // ATOMIC first-mint (MR !9 review): the UPDATE is conditional on `share_token IS NULL`,
  // so of two concurrent first-shares only the first writes; the loser's UPDATE matches
  // zero rows and is a no-op. Then re-read unconditionally and return whichever token
  // actually won — never the local `token`, which may be the loser's. (A plain
  // last-write-wins UPDATE could return a token that was immediately overwritten and
  // would 403 for the learner.)
  await db
    .update(sessions)
    .set({ shareToken: token })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.app), isNull(sessions.shareToken)));
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
  const share = pathname.match(/^\/api\/session\/([^/]+)\/handoff\/share$/);
  // `:token` is `[^/]+` which would also match the literal `share` segment; the `share`
  // branch is matched + handled first, so a non-null `share` short-circuits before the
  // tokened path is consulted.
  const tokened = share ? null : pathname.match(/^\/api\/session\/([^/]+)\/handoff\/([^/]+)$/);
  const bare = pathname.match(/^\/api\/session\/([^/]+)\/handoff$/);
  if (!share && !tokened && !bare) return null;

  const sessionId = (share ?? tokened ?? bare)![1]!;
  if (!UUID_RE.test(sessionId)) {
    return { status: 400, body: { error: 'sessionId must be a UUID' } };
  }

  // The share-mint is the only mutating shape → POST. Everything else is a read → GET.
  if (share) {
    if (method !== 'POST') return { status: 405, body: { error: 'method not allowed' } };
  } else if (method !== 'GET') {
    return { status: 405, body: { error: 'method not allowed' } };
  }

  const artifactDeps = deps.artifactDeps ?? makeHandoffArtifactDeps(deps.db);

  // POST /handoff/share: explicitly mint-or-fetch the share token (never on a read).
  if (share) {
    const token = await ensureShareToken(deps.db, sessionId);
    if (token === null) return { status: 404, body: { error: 'unknown session' } };
    return { status: 200, body: { shareUrl: `/handoff/${sessionId}/${token}` } };
  }

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

  // The bare (owner) path: build + return the artifact. Return an EXISTING share URL if
  // one was already minted (via POST /handoff/share), but NEVER mint here — reading the
  // artifact must not create a durable public link as a side effect (MR !9 review).
  const artifact = await buildHandoffArtifact(artifactDeps, sessionId);
  if (!artifact) return { status: 404, body: { error: 'unknown session' } };
  const existing = await readShareToken(deps.db, sessionId);
  const shareUrl = existing ? `/handoff/${sessionId}/${existing}` : null;
  return { status: 200, body: { artifact, shareUrl } satisfies HandoffBareResponse };
}

interface HandoffBareResponse {
  artifact: HandoffArtifact;
  shareUrl: string | null;
}
