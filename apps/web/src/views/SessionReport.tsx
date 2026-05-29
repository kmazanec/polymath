import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import type { SessionSummary } from '@polymath/contract';
import './sessionReport.css';

/**
 * Session report view — mounted at `/session/:id/report` (a regular React Router
 * route, NOT a ComponentSpec: it is operator/evaluator-facing, never mounted during
 * a learner session). Renders the Nerdy KPI tile shape (pre/post + a prominent
 * "double growth" multiplier) from `GET /api/session/:id/report` — the locked
 * `SessionSummary`.
 *
 * Fail-soft rendering (the dashboard never lies):
 *   - a `null` score (pre-test not run on a non-experiment session) renders the
 *     "pre-test not run" tile, never an empty field or a fabricated 0 (AC#4);
 *   - a `null` growthMultiplier renders the same "not measured" treatment;
 *   - a 401/403 surfaces an operator-secret input that retries with the secret in an
 *     `X-Operator-Secret` HEADER (never a query param — D10: a query string lands in
 *     logs/history; the operator secret must not).
 */

type FetchState =
  | { kind: 'loading' }
  | { kind: 'ready'; summary: SessionSummary }
  | { kind: 'auth' }
  | { kind: 'error'; message: string };

/** Render a [0,1] fraction as a whole-percent string, or the "not measured" dash. */
function pct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

/** Human-readable minutes:seconds for the time-on-task tile. */
function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${String(sec).padStart(2, '0')}s`;
}

const MASTERY_LABEL: Record<SessionSummary['masteryStatus'], string> = {
  mastered: 'Mastered',
  remediating: 'Remediating',
  practicing: 'Practicing',
  not_started: 'Not started',
};

export function SessionReport(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<FetchState>({ kind: 'loading' });
  const [secret, setSecret] = useState('');

  const load = useCallback(
    async (operatorSecret?: string) => {
      if (!id) {
        setState({ kind: 'error', message: 'No session id in the URL.' });
        return;
      }
      setState({ kind: 'loading' });
      try {
        // Relative path → Caddy proxies `/api/*` to the agent (same as App.tsx). The
        // operator secret rides in a HEADER, never the query string (D10).
        const headers: Record<string, string> = {};
        if (operatorSecret) headers['x-operator-secret'] = operatorSecret;
        const res = await fetch(`/api/session/${encodeURIComponent(id)}/report`, { headers });
        if (res.status === 401 || res.status === 403) {
          setState({ kind: 'auth' });
          return;
        }
        if (res.status === 404) {
          setState({ kind: 'error', message: 'No report for that session id.' });
          return;
        }
        if (!res.ok) {
          setState({ kind: 'error', message: `Could not load the report (HTTP ${res.status}).` });
          return;
        }
        const summary = (await res.json()) as SessionSummary;
        setState({ kind: 'ready', summary });
      } catch {
        setState({ kind: 'error', message: 'Could not load the report (network error).' });
      }
    },
    [id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === 'loading') {
    return (
      <main className="session-report">
        <p className="session-report__status">Loading session report…</p>
      </main>
    );
  }

  if (state.kind === 'auth') {
    return (
      <main className="session-report">
        <h1 className="session-report__title">Session report</h1>
        <form
          className="session-report__auth"
          onSubmit={(e) => {
            e.preventDefault();
            void load(secret);
          }}
        >
          <p>This report is operator-restricted. Enter the operator secret to authorize.</p>
          <label htmlFor="operator-secret">Operator secret</label>
          <input
            id="operator-secret"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="off"
          />
          <button type="submit">Load report</button>
        </form>
      </main>
    );
  }

  if (state.kind === 'error') {
    return (
      <main className="session-report">
        <h1 className="session-report__title">Session report</h1>
        <p className="session-report__status session-report__status--error" role="alert">
          {state.message}
        </p>
      </main>
    );
  }

  const s = state.summary;
  const growthDisplay = s.growthMultiplier === null ? '—' : `${s.growthMultiplier.toFixed(1)}×`;
  const preNotRun = s.preTestScore === null;

  return (
    <main className="session-report" aria-label="Session report">
      <header className="session-report__header">
        <h1 className="session-report__title">Session report</h1>
        <p className="session-report__subtitle">
          Session <code>{id}</code> ·{' '}
          {s.source === 'experiment' ? 'Pre/post experiment arm' : 'In-session summary'}
        </p>
      </header>

      <section className="session-report__tiles">
        {/* Pre-test — "not run" copy instead of an empty field (AC#4). */}
        <article className="session-report__tile session-report__tile--pre">
          <h2 className="session-report__tile-label">Pre-test</h2>
          {preNotRun ? (
            <p className="session-report__tile-empty">pre-test not run</p>
          ) : (
            <p className="session-report__tile-value">{pct(s.preTestScore)}</p>
          )}
        </article>

        {/* Post-test. */}
        <article className="session-report__tile session-report__tile--post">
          <h2 className="session-report__tile-label">Post-test</h2>
          <p className="session-report__tile-value">{pct(s.postTestScore)}</p>
        </article>

        {/* Growth multiplier — the Nerdy "double growth" hero tile. */}
        <article className="session-report__tile session-report__tile--growth">
          <h2 className="session-report__tile-label">Growth</h2>
          {s.growthMultiplier === null ? (
            <p className="session-report__tile-empty">not measured</p>
          ) : (
            <p className="session-report__tile-value session-report__tile-value--hero">
              {growthDisplay}
            </p>
          )}
          <p className="session-report__tile-note">learning-gain multiplier</p>
        </article>

        <article className="session-report__tile">
          <h2 className="session-report__tile-label">Time on task</h2>
          <p className="session-report__tile-value">{formatDuration(s.timeOnTaskMs)}</p>
        </article>

        <article className="session-report__tile">
          <h2 className="session-report__tile-label">Transfer success</h2>
          <p className="session-report__tile-value">{pct(s.transferSuccessRate)}</p>
        </article>

        <article className="session-report__tile">
          <h2 className="session-report__tile-label">Mastery status</h2>
          <p className="session-report__tile-value session-report__tile-value--text">
            {MASTERY_LABEL[s.masteryStatus]}
          </p>
        </article>

        <article className="session-report__tile">
          <h2 className="session-report__tile-label">Explain-back</h2>
          <p
            className={`session-report__tile-value session-report__tile-value--text ${
              s.explainBackVerdict.passed
                ? 'session-report__verdict--pass'
                : 'session-report__verdict--fail'
            }`}
          >
            {s.explainBackVerdict.passed ? 'Passed' : 'Not passed'}
          </p>
          {s.explainBackVerdict.reasons.length > 0 && (
            <ul className="session-report__reasons">
              {s.explainBackVerdict.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <section className="session-report__kcs">
        <div>
          <h2 className="session-report__tile-label">KCs mastered</h2>
          {s.kcsMastered.length > 0 ? (
            <ul>
              {s.kcsMastered.map((kc) => (
                <li key={kc}>{kc}</li>
              ))}
            </ul>
          ) : (
            <p className="session-report__tile-empty">none yet</p>
          )}
        </div>
        <div>
          <h2 className="session-report__tile-label">KCs stuck</h2>
          {s.kcsStuck.length > 0 ? (
            <ul>
              {s.kcsStuck.map((kc) => (
                <li key={kc}>{kc}</li>
              ))}
            </ul>
          ) : (
            <p className="session-report__tile-empty">none</p>
          )}
        </div>
      </section>
    </main>
  );
}
