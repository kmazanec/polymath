/**
 * OTel SDK registration — the one place this process turns the voice-turn spans
 * (`recordVoiceTurnSpan`, otel.ts) into real exported traces.
 *
 * Fail-closed, env-gated, modelled on the LIVEKIT / realtime-session pattern: a
 * MISSING or BLANK `OTEL_EXPORTER_OTLP_ENDPOINT` means "telemetry not configured" —
 * `registerOtel()` is a clean no-op that registers nothing and NEVER throws (a bad
 * endpoint must not take down boot). Only a complete URL wires a `NodeTracerProvider`
 * + a `BatchSpanProcessor(OTLPTraceExporter)` and registers it as the global provider,
 * after which the API-only `recordVoiceTurnSpan` starts emitting to the collector.
 *
 * This module deliberately does NOT touch `recordVoiceTurnSpan` or its nine
 * attributes — it only registers the SDK so the existing API calls resolve to a real
 * exporter instead of the API no-op.
 */
import { NodeTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';

const DEFAULT_SERVICE_NAME = 'polymath-agent';

let registered = false;

/** Parse the comma/`=`-encoded `OTEL_EXPORTER_OTLP_HEADERS` env into a map. */
function parseHeaders(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  const headers: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (k) headers[k] = v;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

/**
 * Register the OTel SDK if (and only if) `OTEL_EXPORTER_OTLP_ENDPOINT` is a complete
 * URL. Returns `true` when it actually registered a provider this call, `false`
 * otherwise (unconfigured, malformed, or already-registered). Never throws.
 */
export function registerOtel(): boolean {
  if (registered) return false;

  const endpoint = (process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? '').trim();
  if (endpoint.length === 0) return false;

  // Validate the endpoint is a real URL before constructing the exporter — a
  // malformed value is "not configured", not a crash.
  try {
    // eslint-disable-next-line no-new
    new URL(endpoint);
  } catch {
    return false;
  }

  try {
    const serviceName = (process.env['OTEL_SERVICE_NAME'] ?? '').trim() || DEFAULT_SERVICE_NAME;
    const headers = parseHeaders(process.env['OTEL_EXPORTER_OTLP_HEADERS']);
    const exporter = new OTLPTraceExporter({
      // The OTLP/HTTP exporter wants the signal-specific path; honour an endpoint that
      // already names `/v1/traces`, else append it.
      url: endpoint.endsWith('/v1/traces')
        ? endpoint
        : `${endpoint.replace(/\/$/, '')}/v1/traces`,
      ...(headers ? { headers } : {}),
    });
    const provider = new NodeTracerProvider({
      resource: resourceFromAttributes({ 'service.name': serviceName }),
      spanProcessors: [new BatchSpanProcessor(exporter)],
    });
    provider.register();
    registered = true;
    return true;
  } catch {
    // Any SDK wiring failure degrades to "telemetry off" — never propagates into boot.
    return false;
  }
}

/** Test-only: reset the module-level guard so each test starts unregistered. */
export function __resetOtelForTest(): void {
  registered = false;
}
