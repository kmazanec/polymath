import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { trace } from '@opentelemetry/api';
import { registerOtel, __resetOtelForTest } from './otelSdk.js';

/**
 * `registerOtel()` wires the OTel SDK (a `NodeTracerProvider` + OTLP exporter) ONLY
 * when `OTEL_EXPORTER_OTLP_ENDPOINT` is a complete URL — modelled on the LIVEKIT /
 * realtime-session fail-closed pattern: a missing/blank/partial config is "not
 * configured", a clean no-op that NEVER throws into boot. Idempotent: a second call
 * is a no-op (we never double-register a global provider).
 */

const ENDPOINT = 'OTEL_EXPORTER_OTLP_ENDPOINT';

function clearEnv(): void {
  delete process.env[ENDPOINT];
  delete process.env['OTEL_EXPORTER_OTLP_HEADERS'];
  delete process.env['OTEL_SERVICE_NAME'];
}

describe('registerOtel (fail-closed env gating)', () => {
  beforeEach(() => {
    clearEnv();
    __resetOtelForTest();
    trace.disable();
  });

  afterEach(() => {
    clearEnv();
    __resetOtelForTest();
    trace.disable();
  });

  it('is a clean no-op (returns false) when the endpoint is unset', () => {
    expect(registerOtel()).toBe(false);
  });

  it('is a no-op when the endpoint is blank / whitespace only', () => {
    process.env[ENDPOINT] = '   ';
    expect(registerOtel()).toBe(false);
  });

  it('never throws on a malformed endpoint, just declines', () => {
    process.env[ENDPOINT] = 'not a url';
    expect(() => registerOtel()).not.toThrow();
    expect(registerOtel()).toBe(false);
  });

  it('registers a provider and returns true on a complete URL', () => {
    process.env[ENDPOINT] = 'http://otel-collector:4318';
    expect(registerOtel()).toBe(true);
  });

  it('is idempotent — a second call returns false (no double registration)', () => {
    process.env[ENDPOINT] = 'http://otel-collector:4318';
    expect(registerOtel()).toBe(true);
    expect(registerOtel()).toBe(false);
  });
});
