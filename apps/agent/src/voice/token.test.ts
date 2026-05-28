import { describe, expect, it } from 'vitest';
import { mintRealtimeToken, REALTIME_TOKEN_TTL_SECONDS } from './token.js';

/** Decode the (unverified) middle segment of a JWT. We only inspect the claims
 *  here — signature verification is LiveKit's job at join time, not the unit
 *  under test (which is "did we ask for the right grant, scoped right, for the
 *  right window?"). */
function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const segment = jwt.split('.')[1];
  if (segment === undefined) throw new Error('malformed jwt: no payload segment');
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('mintRealtimeToken', () => {
  const base = {
    sessionId: '11111111-1111-4111-8111-111111111111',
    apiKey: 'devkey',
    apiSecret: 'devsecret-at-least-32-bytes-long-padding',
    livekitUrl: 'wss://livekit.example.com',
  } as const;

  it('mints a decodable JWT with a room-join grant scoped to the session room', async () => {
    const { token, roomName, url } = await mintRealtimeToken(base);
    expect(roomName).toBe(`session-${base.sessionId}`);
    expect(url).toBe(base.livekitUrl);

    const payload = decodeJwtPayload(token);
    const video = payload['video'] as Record<string, unknown> | undefined;
    expect(video).toBeDefined();
    expect(video!['roomJoin']).toBe(true);
    expect(video!['room']).toBe(`session-${base.sessionId}`);
    expect(video!['canPublish']).toBe(true);
    expect(video!['canSubscribe']).toBe(true);
  });

  it('grants no admin/list authority (join-only)', async () => {
    const { token } = await mintRealtimeToken(base);
    const video = decodeJwtPayload(token)['video'] as Record<string, unknown>;
    // Absent or falsy — never an admin/list/create grant.
    expect(video['roomAdmin']).toBeFalsy();
    expect(video['roomList']).toBeFalsy();
    expect(video['roomCreate']).toBeFalsy();
    expect(video['roomRecord']).toBeFalsy();
    expect(video['ingressAdmin']).toBeFalsy();
  });

  it('sets a 5-minute expiry window on the JWT', async () => {
    const before = Math.floor(Date.now() / 1000);
    const { token } = await mintRealtimeToken(base);
    const after = Math.floor(Date.now() / 1000);

    const payload = decodeJwtPayload(token);
    const exp = payload['exp'] as number;
    expect(typeof exp).toBe('number');
    // Assert the absolute `exp` lands in the [signedAt + TTL] window. We deliberately
    // do NOT assert `exp - nbf === TTL`: `nbf` is set by the LiveKit SDK, not this
    // wrapper, so keying the TTL check off it would make the test break on an SDK
    // change (omitted/zeroed nbf) even when the real expiry is correct.
    expect(exp).toBeGreaterThanOrEqual(before + REALTIME_TOKEN_TTL_SECONDS);
    expect(exp).toBeLessThanOrEqual(after + REALTIME_TOKEN_TTL_SECONDS);
  });

  it('reports expiresAt as injected now + TTL (deterministic)', async () => {
    const now = 1_700_000_000_000;
    const { expiresAt } = await mintRealtimeToken({ ...base, now });
    expect(expiresAt).toBe(now + REALTIME_TOKEN_TTL_SECONDS * 1000);
  });

  it('issues distinct tokens for distinct sessions', async () => {
    const a = await mintRealtimeToken({ ...base, sessionId: '22222222-2222-4222-8222-222222222222' });
    const b = await mintRealtimeToken({ ...base, sessionId: '33333333-3333-4333-8333-333333333333' });
    expect(a.roomName).not.toBe(b.roomName);
    expect(a.token).not.toBe(b.token);
  });
});
