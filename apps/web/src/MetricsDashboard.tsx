import { type ReactElement, useCallback, useState } from 'react';
import './metrics.css';

/**
 * Counter-metrics dashboard — mounted at `/metrics` (operator/evaluator only, NOT
 * learner-facing). Fetches `GET /api/metrics` and renders the six counter-metrics as
 * tiles with FOUR honest visual states. The headline anti-fail-open rule: an
 * unmeasured metric is GRAY (`insufficient_data` / `unconfigured`), never silently
 * collapsed into a green pass or a red fail.
 *
 * The data endpoint is operator-gated (401 without the secret). The secret is supplied
 * at request time from an in-page input and sent as the `X-Operator-Secret` HEADER —
 * never a query param, never bundled into the build (D10). The route itself is an
 * unguarded SPA route; the protection lives entirely on the endpoint's 401.
 */

/** The wire shape of one metric in `GET /api/metrics` (mirrors the agent's
 *  `MetricResult`; the SPA reads it as JSON rather than importing the server type). */
export interface MetricResult {
  id: string;
  label: string;
  value: number | null;
  threshold: number;
  unit: string;
  pass: boolean | null;
  state: 'pass' | 'fail' | 'insufficient_data' | 'unconfigured';
  sampleN: number;
  source: string;
  note?: string;
}

interface MetricsPayload {
  metrics: MetricResult[];
  generatedAt: string;
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; payload: MetricsPayload }
  | { kind: 'error'; message: string };

/** A compact value+unit string, or an em-dash when the value is not determinable. */
function formatValue(m: MetricResult): string {
  if (m.value === null) return '—';
  // Percent-style metrics read more naturally scaled; everything else is raw + unit.
  if (m.unit === '%') return `${(m.value * 100).toFixed(0)}%`;
  return `${m.value.toFixed(2)}${m.unit ? ` ${m.unit}` : ''}`;
}

function stateLabel(m: MetricResult): string {
  switch (m.state) {
    case 'pass':
      return 'PASS';
    case 'fail':
      return 'FAIL';
    case 'insufficient_data':
      return `insufficient data (N=${m.sampleN})`;
    case 'unconfigured':
      return 'not configured (source pending)';
  }
}

function MetricTile({ m }: { m: MetricResult }): ReactElement {
  const thresholdText =
    m.unit === '%' ? `${(m.threshold * 100).toFixed(0)}%` : `${m.threshold}${m.unit ? ` ${m.unit}` : ''}`;
  return (
    <article className="metric-tile" data-metric-id={m.id} data-state={m.state}>
      <header className="metric-tile__head">
        <h2 className="metric-tile__label">{m.label}</h2>
        {/* The source is the tooltip (AC#2): hover shows provenance; it is also the
            accessible title for keyboard/AT users. */}
        <span className="metric-tile__source" title={m.source} aria-label={`source: ${m.source}`}>
          ⓘ
        </span>
      </header>
      <p className="metric-tile__value">{formatValue(m)}</p>
      <p className="metric-tile__threshold">threshold {thresholdText}</p>
      {/* The state badge carries a TEXT label, not hue alone — deuteranopia-safe. */}
      <p className="metric-tile__state" data-state={m.state}>
        {stateLabel(m)}
      </p>
      {m.note && <p className="metric-tile__note">{m.note}</p>}
    </article>
  );
}

/** AC#3: the honest limitations memo. A FAILING tile, or a gray (insufficient/
 *  unconfigured) tile, is a limitation worth quoting in the demo deck. A passing tile
 *  is never a limitation. Plain copy-able text, no new infra. */
function limitationsLines(metrics: MetricResult[]): string[] {
  return metrics
    .filter((m) => m.state !== 'pass')
    .map((m) => {
      if (m.state === 'fail') return `${m.label}: FAILS threshold (${formatValue(m)} vs ${m.threshold}).`;
      if (m.state === 'insufficient_data') return `${m.label}: not yet measurable (N=${m.sampleN}).`;
      return `${m.label}: not configured — ${m.note ?? 'source pending'}.`;
    });
}

export function MetricsDashboard(): ReactElement {
  const [secret, setSecret] = useState('');
  const [load, setLoad] = useState<LoadState>({ kind: 'idle' });

  const fetchMetrics = useCallback(async (): Promise<void> => {
    setLoad({ kind: 'loading' });
    try {
      // The secret travels in the HEADER, never the URL (D10). The route is fixed; no
      // query string carries the credential.
      const res = await fetch('/api/metrics', {
        headers: { 'X-Operator-Secret': secret },
      });
      if (res.status === 401) {
        setLoad({ kind: 'error', message: 'Unauthorized (401) — wrong or missing operator secret.' });
        return;
      }
      if (!res.ok) {
        setLoad({ kind: 'error', message: `Request failed (${res.status}).` });
        return;
      }
      const payload = (await res.json()) as MetricsPayload;
      setLoad({ kind: 'loaded', payload });
    } catch {
      setLoad({ kind: 'error', message: 'Network error — failed to load metrics.' });
    }
  }, [secret]);

  return (
    <main className="metrics-dashboard">
      <h1>Counter-metrics</h1>
      <p className="metrics-dashboard__intro">
        Operator view. Most tiles read gray until the live study runs — an unmeasured
        metric is shown honestly, never as a green pass.
      </p>

      <form
        className="metrics-dashboard__auth"
        onSubmit={(e) => {
          e.preventDefault();
          void fetchMetrics();
        }}
      >
        <label htmlFor="operator-secret">Operator secret</label>
        <input
          id="operator-secret"
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoComplete="off"
        />
        <button type="submit" disabled={load.kind === 'loading'}>
          {load.kind === 'loading' ? 'Loading…' : 'Load'}
        </button>
      </form>

      {load.kind === 'error' && (
        <p className="metrics-dashboard__error" role="alert">
          {load.message}
        </p>
      )}

      {load.kind === 'loaded' && (
        <>
          <section className="metrics-grid" aria-label="Counter-metrics">
            {load.payload.metrics.map((m) => (
              <MetricTile key={m.id} m={m} />
            ))}
          </section>

          <section className="limitations-memo" data-testid="limitations-memo" aria-label="Limitations memo">
            <h2>Limitations (for the demo deck)</h2>
            {(() => {
              const lines = limitationsLines(load.payload.metrics);
              return lines.length === 0 ? (
                <p>All measured metrics pass their thresholds.</p>
              ) : (
                <ul>
                  {lines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              );
            })()}
          </section>

          <p className="metrics-dashboard__generated">Generated {load.payload.generatedAt}</p>
        </>
      )}
    </main>
  );
}
