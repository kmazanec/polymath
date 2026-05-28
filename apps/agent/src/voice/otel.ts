/**
 * OpenTelemetry instrumentation for a completed voice turn.
 *
 * We emit one span per turn carrying the small, fixed attribute set that makes the
 * voice channel observable: which learner/lesson/phase, which model version, did
 * the prompt cache hit, time-to-first-token, did the learner barge in, and the
 * `transcript_log_id` that links the span back to the persisted `events` row.
 *
 * This uses only the OTel *API*. With no SDK/exporter registered in this process
 * the API is a safe no-op (a later feature wires real exporters), so production
 * code never needs to know whether telemetry is collected. Tests register an
 * in-memory provider via the SDK and assert against the recorded span.
 */
import { trace } from '@opentelemetry/api';

/** The exactly-nine attributes carried on a `voice.turn` span. */
export interface VoiceTurnSpanAttrs {
  turnId: string;
  learnerId: string;
  lessonId: number;
  phase: string;
  modelVersion: string;
  cacheHit: boolean;
  ttftMs: number;
  bargeIn: boolean;
  transcriptLogId: string;
}

/**
 * Start and immediately end a `voice.turn` span with the given attributes. The
 * turn has already completed by the time we record it, so the span is a point
 * marker rather than a wrapper around live work — start, set attributes, end.
 */
export function recordVoiceTurnSpan(attrs: VoiceTurnSpanAttrs): void {
  const tracer = trace.getTracer('polymath.voice');
  const span = tracer.startSpan('voice.turn');
  // Snake_case attribute keys are the OTel convention and what dashboards key on.
  span.setAttribute('turn_id', attrs.turnId);
  span.setAttribute('learner_id', attrs.learnerId);
  span.setAttribute('lesson_id', attrs.lessonId);
  span.setAttribute('phase', attrs.phase);
  span.setAttribute('model_version', attrs.modelVersion);
  span.setAttribute('cache_hit', attrs.cacheHit);
  span.setAttribute('ttft_ms', attrs.ttftMs);
  span.setAttribute('barge_in', attrs.bargeIn);
  span.setAttribute('transcript_log_id', attrs.transcriptLogId);
  span.end();
}
