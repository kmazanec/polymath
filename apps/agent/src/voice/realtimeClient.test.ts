import { beforeEach, describe, expect, it } from 'vitest';
import {
  MockRealtimeSession,
  resetCacheRegistry,
} from './realtimeClient.js';
import type {
  MockRealtimeSessionOpts,
  RealtimeSessionConfig,
  VoiceTranscript,
} from './realtimeClient.js';

const config: RealtimeSessionConfig = {
  systemPrompt: 'persona...',
  cacheKey: 'lesson:1|phase:assessed',
  model: 'gpt-realtime',
};

function makeSession(overrides: MockRealtimeSessionOpts = {}) {
  return new MockRealtimeSession(config, overrides);
}

beforeEach(() => {
  resetCacheRegistry();
});

describe('MockRealtimeSession — contract', () => {
  it('connect resolves and records what it connected with', async () => {
    const s = new MockRealtimeSession(config);
    await s.connect();
    expect(s.connectedWith).toEqual(config);
  });

  it('a scripted utterance + flush yields learner then tutor transcripts', async () => {
    const s = new MockRealtimeSession(config, {
      reply: { tutorText: 'What does AND return when both inputs are true?', audioFrames: 2 },
    });
    const got: VoiceTranscript[] = [];
    s.onTranscript((t) => got.push(t));
    await s.connect();

    s.pushLearnerUtterance('I think it is true');
    s.flush();

    expect(got.map((t) => t.role)).toEqual(['learner', 'tutor']);
    expect(got[0]?.text).toBe('I think it is true');
    expect(got[0]?.final).toBe(true);
    expect(got[1]?.role).toBe('tutor');
    expect(got[1]?.text).toBe('What does AND return when both inputs are true?');
    expect(typeof got[1]?.at).toBe('number');
  });

  it('onAudio receives the tutor audio frames after flush', async () => {
    const s = new MockRealtimeSession(config, {
      reply: { tutorText: 'ok', audioFrames: 3 },
    });
    const frames: Uint8Array[] = [];
    s.onAudio((f) => frames.push(f));
    await s.connect();
    s.pushLearnerUtterance('hi');
    s.flush();
    expect(frames).toHaveLength(3);
    expect(frames[0]).toBeInstanceOf(Uint8Array);
  });

  it('records sent audio frames so wiring can be asserted', async () => {
    const s = makeSession();
    await s.connect();
    const frame = new Uint8Array([1, 2, 3]);
    s.sendAudioFrame(frame);
    expect(s.sentFrames).toEqual([frame]);
  });

  it('isResponding is true mid-response and false once drained', async () => {
    const s = new MockRealtimeSession(config, {
      reply: { tutorText: 'a longer answer', audioFrames: 2 },
    });
    await s.connect();
    expect(s.isResponding()).toBe(false);
    s.pushLearnerUtterance('go');
    expect(s.isResponding()).toBe(true);
    s.flush();
    expect(s.isResponding()).toBe(false);
  });

  it('interrupt() during a response stops emission and clears isResponding', async () => {
    const s = new MockRealtimeSession(config, {
      reply: { tutorText: 'this should be cut off', audioFrames: 5 },
    });
    const got: VoiceTranscript[] = [];
    const frames: Uint8Array[] = [];
    s.onTranscript((t) => got.push(t));
    s.onAudio((f) => frames.push(f));
    await s.connect();

    s.pushLearnerUtterance('wait, stop');
    // Drain only the learner ASR + the first tutor audio frame, mid-response.
    s.tick();
    expect(s.isResponding()).toBe(true);

    s.interrupt();
    expect(s.isResponding()).toBe(false);

    // Flushing after a barge-in must emit nothing further (no tutor transcript,
    // no remaining tutor frames) — this is what C3 asserts barge-in against.
    const framesAtInterrupt = frames.length;
    const transcriptsAtInterrupt = got.length;
    s.flush();
    expect(frames.length).toBe(framesAtInterrupt);
    expect(got.length).toBe(transcriptsAtInterrupt);
    expect(got.some((t) => t.role === 'tutor')).toBe(false);
  });

  it('cacheHit is false on first connect with a key, true on a later connect with the same key', async () => {
    const first = new MockRealtimeSession(config);
    await first.connect();
    expect(first.cacheHit).toBe(false);

    const second = new MockRealtimeSession(config);
    await second.connect();
    expect(second.cacheHit).toBe(true);
  });

  it('cacheHit can be forced via constructor opts', async () => {
    const s = new MockRealtimeSession(config, { cacheHit: true });
    await s.connect();
    expect(s.cacheHit).toBe(true);
  });

  it('close is idempotent', async () => {
    const s = makeSession();
    await s.connect();
    await s.close();
    await expect(s.close()).resolves.toBeUndefined();
  });

  it('rejects audio frames before connect and after close', async () => {
    const s = makeSession();
    expect(() => s.sendAudioFrame(new Uint8Array([1]))).toThrow();
    await s.connect();
    await s.close();
    expect(() => s.sendAudioFrame(new Uint8Array([1]))).toThrow();
  });
});
