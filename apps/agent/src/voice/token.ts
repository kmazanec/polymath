import { randomUUID } from 'node:crypto';
import { AccessToken } from 'livekit-server-sdk';

/** A LiveKit join token is deliberately short-lived: the browser exchanges it
 *  for a media session immediately, so it only needs to outlive the handshake.
 *  Five minutes is generous for that while keeping a leaked token near-useless. */
export const REALTIME_TOKEN_TTL_SECONDS = 300;

/** The room a session joins is derived from the session id (not chosen by the
 *  client) so a minted token is scoped to exactly one session's room — a learner
 *  can never request a token for someone else's room. */
export function roomNameForSession(sessionId: string): string {
  return `session-${sessionId}`;
}

export interface MintRealtimeTokenOptions {
  sessionId: string;
  apiKey: string;
  apiSecret: string;
  livekitUrl: string;
  /** Injected for deterministic expiry in tests; defaults to wall-clock. */
  now?: number;
}

export interface RealtimeTokenResult {
  token: string;
  url: string;
  roomName: string;
  expiresAt: number;
}

/** Mint a short-lived LiveKit access token scoped to a single session's room.
 *  Pure (env is read by the caller): given credentials it returns the signed JWT
 *  plus the metadata the browser needs to join. The grant is join-only for the
 *  one room — no room-create/list/admin — so the token confers no authority
 *  beyond joining and publishing/subscribing in that session's room. */
export async function mintRealtimeToken(
  opts: MintRealtimeTokenOptions,
): Promise<RealtimeTokenResult> {
  const now = opts.now ?? Date.now();
  const roomName = roomNameForSession(opts.sessionId);

  const at = new AccessToken(opts.apiKey, opts.apiSecret, {
    // A stable, unique participant identity per minted token. The learner is
    // anonymous at the media layer; the session binding lives in the room name.
    identity: `learner-${opts.sessionId}-${randomUUID()}`,
    ttl: REALTIME_TOKEN_TTL_SECONDS,
  });
  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
  });

  return {
    token: await at.toJwt(),
    url: opts.livekitUrl,
    roomName,
    expiresAt: now + REALTIME_TOKEN_TTL_SECONDS * 1000,
  };
}
