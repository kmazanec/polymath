import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The tutor-handoff share token (ADR-012 stretch). A per-session random, unguessable
 * secret minted lazily when a learner first shares their handoff — the
 * `followup_token` precedent: the token, NOT the session id, authenticates the
 * public share URL, so the route is exempt from operator auth (the artifact is the
 * learner's own, intentionally shareable) and a session id is never enumerable.
 *
 * Validation is constant-time and FAILS CLOSED: a null/empty stored token or a
 * length-mismatched presented token is a definite non-match, never a throw.
 */

/** 24 random bytes → 48 hex chars. Matches the experiment follow-up token's entropy. */
export function mintShareToken(): string {
  return randomBytes(24).toString('hex');
}

/** Constant-time compare of the stored token against the presented one. Returns
 *  false (fail closed) when the stored token is absent/empty, the presented token is
 *  empty, or the lengths differ (`timingSafeEqual` throws on unequal lengths, so the
 *  length guard must come first). */
export function validateShareToken(
  stored: string | null | undefined,
  presented: string,
): boolean {
  if (!stored || presented.length === 0) return false;
  const a = Buffer.from(stored);
  const b = Buffer.from(presented);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
