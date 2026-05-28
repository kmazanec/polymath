/**
 * The `voice.turn` span carries exactly the nine attributes downstream dashboards
 * expect. We register an in-memory SDK provider (production registers nothing —
 * the API no-ops), call `recordVoiceTurnSpan`, and assert the recorded span's name
 * and attribute set.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { recordVoiceTurnSpan, type VoiceTurnSpanAttrs } from './otel.js';

describe('recordVoiceTurnSpan', () => {
  const exporter = new InMemorySpanExporter();
  let provider: BasicTracerProvider;

  beforeAll(() => {
    // SDK v2 takes processors via the constructor; set it as the global provider
    // so the production code's `trace.getTracer('polymath.voice')` resolves to it.
    provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(provider);
  });

  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
  });

  beforeEach(() => {
    exporter.reset();
  });

  it('emits one voice.turn span with all nine attributes, correctly typed', () => {
    const attrs: VoiceTurnSpanAttrs = {
      turnId: 'session-1:turn:1',
      learnerId: 'learner-7',
      lessonId: 3,
      phase: 'practicing',
      modelVersion: 'gpt-realtime',
      cacheHit: true,
      ttftMs: 420,
      bargeIn: false,
      transcriptLogId: 'row-uuid-abc',
    };

    recordVoiceTurnSpan(attrs);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);

    const span = spans[0]!;
    expect(span.name).toBe('voice.turn');

    expect(span.attributes).toEqual({
      turn_id: 'session-1:turn:1',
      learner_id: 'learner-7',
      lesson_id: 3,
      phase: 'practicing',
      model_version: 'gpt-realtime',
      cache_hit: true,
      ttft_ms: 420,
      barge_in: false,
      transcript_log_id: 'row-uuid-abc',
    });

    // Spot-check types survive (numbers stay numbers, booleans stay booleans).
    expect(typeof span.attributes['lesson_id']).toBe('number');
    expect(typeof span.attributes['ttft_ms']).toBe('number');
    expect(typeof span.attributes['cache_hit']).toBe('boolean');
    expect(typeof span.attributes['barge_in']).toBe('boolean');
  });
});
