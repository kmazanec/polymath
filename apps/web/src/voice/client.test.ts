import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceClient } from './client.js';
import type { RoomConnector } from './client.js';

// Minimal MediaStreamTrack stub.
function makeTrack() {
  return { stop: vi.fn() };
}

// Minimal MediaStream stub.
function makeStream(tracks = [makeTrack()]) {
  return {
    getTracks: () => tracks,
  } as unknown as MediaStream;
}

// Minimal RoomConnector mock.
function makeConnector(): RoomConnector & {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
} {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

function makeSuccessFetch(body = { token: 'tk', url: 'wss://lk.example', roomName: 'room1', expiresAt: '2099-01-01' }) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => body,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VoiceClient construction', () => {
  it('does NOT call getUserMedia when constructed', () => {
    const getUserMedia = vi.fn();
    new VoiceClient({ sessionId: 'sess-1', getUserMedia, connector: makeConnector() });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('starts in idle state', () => {
    const client = new VoiceClient({ sessionId: 'sess-1', getUserMedia: vi.fn(), connector: makeConnector() });
    expect(client.state).toBe('idle');
  });
});

describe('VoiceClient.start() — happy path', () => {
  it('calls getUserMedia, POSTs to /api/realtime/session with sessionId, then calls connector.connect with url+token', async () => {
    const stream = makeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    const fetchFn = makeSuccessFetch();
    const connector = makeConnector();

    const client = new VoiceClient({
      sessionId: 'sess-abc',
      getUserMedia,
      fetchFn,
      connector,
    });

    await client.start();

    // Permission requested
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });

    // Correct endpoint + body
    expect(fetchFn).toHaveBeenCalledWith('/api/realtime/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-abc' }),
    });

    // Connector invoked with the values from the API response
    expect(connector.connect).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'wss://lk.example', token: 'tk' }),
    );

    expect(client.state).toBe('connected');
  });
});

describe('VoiceClient.start() — 503 voice not configured', () => {
  it('sets state unavailable, does NOT call connector.connect, does not throw', async () => {
    const getUserMedia = vi.fn().mockResolvedValue(makeStream());
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: 'voice not configured' }),
    });
    const connector = makeConnector();

    const client = new VoiceClient({ sessionId: 'sess-1', getUserMedia, fetchFn, connector });

    await expect(client.start()).resolves.toBeUndefined();
    expect(client.state).toBe('unavailable');
    expect(connector.connect).not.toHaveBeenCalled();
  });
});

describe('VoiceClient.start() — getUserMedia rejected (permission denied)', () => {
  it('sets state error, does not call fetch or connector.connect, does not throw', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
    const fetchFn = vi.fn();
    const connector = makeConnector();

    const client = new VoiceClient({ sessionId: 'sess-1', getUserMedia, fetchFn, connector });

    await expect(client.start()).resolves.toBeUndefined();
    expect(client.state).toBe('error');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(connector.connect).not.toHaveBeenCalled();
  });
});

describe('VoiceClient.stop()', () => {
  it('stops all mic tracks and calls connector.disconnect', async () => {
    const track = makeTrack();
    const stream = makeStream([track]);
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    const connector = makeConnector();
    const client = new VoiceClient({
      sessionId: 'sess-1',
      getUserMedia,
      fetchFn: makeSuccessFetch(),
      connector,
    });

    await client.start();
    await client.stop();

    expect(track.stop).toHaveBeenCalled();
    expect(connector.disconnect).toHaveBeenCalled();
    expect(client.state).toBe('idle');
  });

  it('is idempotent — a second stop() does not throw and disconnect is called only once', async () => {
    const connector = makeConnector();
    const client = new VoiceClient({
      sessionId: 'sess-1',
      getUserMedia: vi.fn().mockResolvedValue(makeStream()),
      fetchFn: makeSuccessFetch(),
      connector,
    });

    await client.start();
    await client.stop();
    await client.stop(); // second call — should be a no-op

    expect(connector.disconnect).toHaveBeenCalledTimes(1);
    expect(client.state).toBe('idle');
  });

  it('stops mic tracks even if start() failed mid-way (error during connect)', async () => {
    const track = makeTrack();
    const stream = makeStream([track]);
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    const connector = makeConnector();
    connector.connect.mockRejectedValue(new Error('network error'));

    const client = new VoiceClient({
      sessionId: 'sess-1',
      getUserMedia,
      fetchFn: makeSuccessFetch(),
      connector,
    });

    await client.start(); // will fail at connect
    expect(client.state).toBe('error');
    // Tracks must be released on error
    expect(track.stop).toHaveBeenCalled();
  });
});
