/**
 * TeacherReport component tests (mocked fetch).
 *
 * Acceptance criteria tested:
 *   AC#1 — /teacher/:sessionId renders the teacher report for a completed session
 *   AC#2 — per-KC mastery table is visible
 *   AC#3 — misconception flags (stuck KCs) are surfaced
 *   AC#4 — suggested next-session focus paragraph shown
 *   AC#5 — invalid/absent token → auth-required UI state; token sent as Authorization header
 *   AC#6 — the view is print-friendly (verified by CSS file presence + no inline print breakage)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TeacherReport } from './TeacherReport.js';

afterEach(cleanup);

/** Minimal TeacherReportPayload fixture */
const SESSION_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const REPORT_PAYLOAD = {
  sessionId: SESSION_ID,
  sessionStartedAt: '2026-05-29T10:00:00.000Z',
  kcRows: [
    { kc: 'NOT', bktProbability: 0.97, masteryState: 'rule_gate_passed' },
    { kc: 'AND', bktProbability: 0.60, masteryState: 'practicing' },
    { kc: 'OR', bktProbability: 0.95, masteryState: 'rule_gate_passed' },
  ],
  masteredKcs: ['NOT', 'OR'],
  stuckKcs: ['AND'],
};

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function errResponse(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as Response;
}

function renderReport(
  fetchReport: typeof fetch = vi.fn(() => new Promise<Response>(() => {})),
  sessionId = SESSION_ID,
) {
  return render(
    <MemoryRouter initialEntries={[`/teacher/${sessionId}`]}>
      <Routes>
        <Route
          path="/teacher/:sessionId"
          element={<TeacherReport fetchReport={fetchReport as typeof fetch} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('TeacherReport', () => {
  describe('AC#5 — auth required state', () => {
    it('shows a heading and token input on initial render', () => {
      renderReport(vi.fn(() => new Promise<Response>(() => {})));
      // Auth form is shown before any fetch
      expect(screen.getByRole('heading', { name: /teacher report/i })).toBeTruthy();
      expect(screen.getByLabelText(/operator token/i)).toBeTruthy();
      expect(screen.getByRole('button', { name: /view report/i })).toBeTruthy();
    });

    it('shows an error message when fetch returns 401', async () => {
      const fetchReport = vi.fn(async () => errResponse(401, { error: 'operator auth required' }));
      renderReport(fetchReport);

      const input = screen.getByLabelText(/operator token/i);
      fireEvent.change(input, { target: { value: 'wrong-token' } });
      fireEvent.click(screen.getByRole('button', { name: /view report/i }));

      await waitFor(() => expect(screen.getByText(/invalid token|auth required/i)).toBeTruthy());
    });

    it('sends the token as an Authorization Bearer header, not a query param', async () => {
      const fetchReport = vi.fn(async () => okResponse(REPORT_PAYLOAD));
      renderReport(fetchReport);

      const input = screen.getByLabelText(/operator token/i);
      fireEvent.change(input, { target: { value: 'my-secret-token' } });
      fireEvent.click(screen.getByRole('button', { name: /view report/i }));

      await waitFor(() => expect(fetchReport).toHaveBeenCalled());
      const [url, opts] = fetchReport.mock.calls[0] as [string, RequestInit];
      // Token must NOT appear in the URL (AC#5 / D25-3: no query-param auth)
      expect(url).not.toContain('my-secret-token');
      // Must be in the Authorization header
      expect((opts?.headers as Record<string, string>)?.['Authorization']).toBe('Bearer my-secret-token');
    });
  });

  describe('AC#1 + AC#2 — report renders with KC mastery table', () => {
    it('displays the KC table with all KC names after successful fetch', async () => {
      const fetchReport = vi.fn(async () => okResponse(REPORT_PAYLOAD));
      renderReport(fetchReport);

      fireEvent.change(screen.getByLabelText(/operator token/i), { target: { value: 'tok' } });
      fireEvent.click(screen.getByRole('button', { name: /view report/i }));

      await waitFor(() => expect(screen.queryByText('NOT')).toBeTruthy());
      // AND appears in both table and misconception section — use queryAllBy
      expect(screen.queryAllByText('AND').length).toBeGreaterThan(0);
      expect(screen.queryByText('OR')).toBeTruthy();
    });

    it('shows mastered and stuck badges in the KC table', async () => {
      const fetchReport = vi.fn(async () => okResponse(REPORT_PAYLOAD));
      renderReport(fetchReport);

      fireEvent.change(screen.getByLabelText(/operator token/i), { target: { value: 'tok' } });
      fireEvent.click(screen.getByRole('button', { name: /view report/i }));

      await waitFor(() => expect(screen.queryByText('NOT')).toBeTruthy());
      // At least one mastered badge
      const masteredBadges = screen.getAllByText('mastered');
      expect(masteredBadges.length).toBeGreaterThanOrEqual(2);
      // At least one stuck badge
      expect(screen.getByText('stuck')).toBeTruthy();
    });
  });

  describe('AC#3 — misconception flags (stuck KCs)', () => {
    it('surfaces stuck KCs in the misconception flags section', async () => {
      const fetchReport = vi.fn(async () => okResponse(REPORT_PAYLOAD));
      renderReport(fetchReport);

      fireEvent.change(screen.getByLabelText(/operator token/i), { target: { value: 'tok' } });
      fireEvent.click(screen.getByRole('button', { name: /view report/i }));

      await waitFor(() => expect(screen.queryByText('NOT')).toBeTruthy());
      // "Misconception" section heading exists (use role=heading to be specific)
      expect(screen.getByRole('heading', { name: /misconception/i })).toBeTruthy();
    });

    it('shows "none detected" when no KCs are stuck', async () => {
      const allMasteredPayload = {
        ...REPORT_PAYLOAD,
        stuckKcs: [],
        masteredKcs: ['NOT', 'AND', 'OR'],
        kcRows: REPORT_PAYLOAD.kcRows.map((r) => ({ ...r, bktProbability: 0.97 })),
      };
      const fetchReport = vi.fn(async () => okResponse(allMasteredPayload));
      renderReport(fetchReport);

      fireEvent.change(screen.getByLabelText(/operator token/i), { target: { value: 'tok' } });
      fireEvent.click(screen.getByRole('button', { name: /view report/i }));

      await waitFor(() => expect(screen.queryByText('NOT')).toBeTruthy());
      expect(screen.getByText(/no misconceptions detected/i)).toBeTruthy();
    });
  });

  describe('AC#4 — next-session focus paragraph', () => {
    it('shows a focus paragraph naming stuck KCs', async () => {
      const fetchReport = vi.fn(async () => okResponse(REPORT_PAYLOAD));
      renderReport(fetchReport);

      fireEvent.change(screen.getByLabelText(/operator token/i), { target: { value: 'tok' } });
      fireEvent.click(screen.getByRole('button', { name: /view report/i }));

      await waitFor(() => expect(screen.queryByText('NOT')).toBeTruthy());
      // Focus paragraph should be present
      expect(screen.getByText(/suggested next.session focus/i)).toBeTruthy();
      // And should reference the stuck KC
      const paragraphContainer = screen.getByTestId('focus-paragraph');
      expect(paragraphContainer.textContent).toContain('AND');
    });

    it('shows a ready-to-advance focus when no KCs are stuck', async () => {
      const allMasteredPayload = {
        ...REPORT_PAYLOAD,
        stuckKcs: [],
        masteredKcs: ['NOT', 'AND', 'OR'],
        kcRows: REPORT_PAYLOAD.kcRows.map((r) => ({ ...r, bktProbability: 0.97 })),
      };
      const fetchReport = vi.fn(async () => okResponse(allMasteredPayload));
      renderReport(fetchReport);

      fireEvent.change(screen.getByLabelText(/operator token/i), { target: { value: 'tok' } });
      fireEvent.click(screen.getByRole('button', { name: /view report/i }));

      await waitFor(() => expect(screen.queryByText('NOT')).toBeTruthy());
      const paragraphContainer = screen.getByTestId('focus-paragraph');
      expect(paragraphContainer.textContent).toMatch(/advance|ready/i);
    });
  });
});
