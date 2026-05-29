import { type ReactElement, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { buildNextSessionFocus } from './focusParagraph.js';
import './teacherReport.css';

/**
 * Per-KC mastery snapshot from the agent's `GET /api/session/:id/teacher-report` endpoint.
 */
interface KcMasteryRow {
  kc: string;
  bktProbability: number | null;
  masteryState: string | null;
}

interface TeacherReportPayload {
  sessionId: string;
  sessionStartedAt: string | null;
  kcRows: KcMasteryRow[];
  masteredKcs: string[];
  stuckKcs: string[];
}

type LoadState =
  | { kind: 'auth' }
  | { kind: 'loading' }
  | { kind: 'auth-error'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; report: TeacherReportPayload };

/**
 * Teacher report view — mounted at `/teacher/:sessionId`.
 *
 * Auth: operator token entered in an in-page form, sent as an `Authorization: Bearer`
 * header to `GET /api/session/:id/teacher-report`. The token is NEVER in the URL
 * (ADR-012 / D25-3: query params leak secrets in server access logs).
 *
 * `fetchReport` is injectable for tests (following the TutorHandoff pattern);
 * defaults to the global `fetch`.
 */
export function TeacherReport({
  fetchReport = fetch,
}: {
  fetchReport?: typeof fetch;
}): ReactElement {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [state, setState] = useState<LoadState>({ kind: 'auth' });
  const [token, setToken] = useState('');

  const loadReport = useCallback(
    async (tok: string) => {
      if (!sessionId) return;
      setState({ kind: 'loading' });
      try {
        const res = await fetchReport(`/api/session/${sessionId}/teacher-report`, {
          headers: { Authorization: `Bearer ${tok}` },
        });
        if (res.status === 401 || res.status === 403) {
          setState({ kind: 'auth-error', message: 'Invalid token or auth required (401).' });
          return;
        }
        if (!res.ok) {
          setState({ kind: 'error', message: `Failed to load report (status ${res.status}).` });
          return;
        }
        const payload = (await res.json()) as TeacherReportPayload;
        setState({ kind: 'loaded', report: payload });
      } catch {
        setState({ kind: 'error', message: 'Network error — could not reach the agent.' });
      }
    },
    [sessionId, fetchReport],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void loadReport(token.trim());
    },
    [token, loadReport],
  );

  // Auth form (initial state and after 401)
  if (state.kind === 'auth' || state.kind === 'auth-error') {
    return (
      <div className="teacher-report-auth">
        <h1>Teacher Report</h1>
        <form onSubmit={handleSubmit}>
          <label htmlFor="teacher-token">Operator token</label>
          <input
            id="teacher-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            required
          />
          {state.kind === 'auth-error' && (
            <p className="auth-error" role="alert">
              {state.message}
            </p>
          )}
          <button type="submit" disabled={token.trim().length === 0}>
            View report
          </button>
        </form>
      </div>
    );
  }

  if (state.kind === 'loading') {
    return (
      <div className="teacher-report">
        <p aria-live="polite">Loading report&hellip;</p>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="teacher-report">
        <p role="alert">{state.message}</p>
      </div>
    );
  }

  const { report } = state;
  const focusParagraph = buildNextSessionFocus(report.stuckKcs);
  const startedAt = report.sessionStartedAt
    ? new Date(report.sessionStartedAt).toLocaleString()
    : 'unknown';

  return (
    <main className="teacher-report">
      <h1>Teacher Report</h1>
      <p className="report-meta">
        Session: <code>{report.sessionId}</code> &middot; Started: {startedAt}
      </p>

      {/* AC#2 — per-KC mastery table */}
      <section>
        <h2>Knowledge Component Mastery</h2>
        <table className="kc-table">
          <thead>
            <tr>
              <th scope="col">KC</th>
              <th scope="col">BKT P(mastered)</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {report.kcRows.map((row) => {
              const isMastered = typeof row.bktProbability === 'number' && row.bktProbability >= 0.95;
              const pct =
                typeof row.bktProbability === 'number'
                  ? `${(row.bktProbability * 100).toFixed(1)}%`
                  : '—';
              return (
                <tr key={row.kc} className={isMastered ? 'mastered' : 'stuck'}>
                  <td>{row.kc}</td>
                  <td>{pct}</td>
                  <td>
                    <span className={`badge ${isMastered ? 'badge-mastered' : 'badge-stuck'}`}>
                      {isMastered ? 'mastered' : 'stuck'}
                    </span>
                  </td>
                </tr>
              );
            })}
            {report.kcRows.length === 0 && (
              <tr>
                <td colSpan={3}>No KC data recorded for this session yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* AC#3 — misconception flags (stuck KCs) */}
      <section>
        <h2>Misconception / Stuck KC Flags</h2>
        {report.stuckKcs.length === 0 ? (
          <p>No misconceptions detected — the learner passed all covered KCs.</p>
        ) : (
          <ul>
            {report.stuckKcs.map((kc) => (
              <li key={kc}>
                <strong>{kc}</strong> — repeated misses / BKT below mastery threshold.
                Probe with alternative representations in the next session.
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* AC#4 — suggested next-session focus */}
      <section>
        <h2>Suggested Next-Session Focus</h2>
        <p className="focus-paragraph" data-testid="focus-paragraph">
          {focusParagraph}
        </p>
      </section>
    </main>
  );
}
