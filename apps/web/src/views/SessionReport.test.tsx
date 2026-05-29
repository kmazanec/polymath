import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SessionSummary } from '@polymath/contract';
import { SessionReport } from './SessionReport.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const experimentSummary: SessionSummary = {
  preTestScore: 0.25,
  postTestScore: 0.75,
  growthMultiplier: 2.0,
  timeOnTaskMs: 600_000,
  transferSuccessRate: 1,
  masteryStatus: 'mastered',
  explainBackVerdict: { passed: true, reasons: [] },
  kcsMastered: ['AND', 'OR'],
  kcsStuck: [],
  source: 'experiment',
};

const inSessionSummary: SessionSummary = {
  preTestScore: null,
  postTestScore: 0.6,
  growthMultiplier: null,
  timeOnTaskMs: 120_000,
  transferSuccessRate: 0.5,
  masteryStatus: 'practicing',
  explainBackVerdict: { passed: false, reasons: ['no_item_reference'] },
  kcsMastered: [],
  kcsStuck: ['NOT'],
  source: 'in_session',
};

function renderAt(id = 'sess-1') {
  return render(
    <MemoryRouter initialEntries={[`/session/${id}/report`]}>
      <Routes>
        <Route path="/session/:id/report" element={<SessionReport />} />
      </Routes>
    </MemoryRouter>,
  );
}

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

describe('SessionReport view', () => {
  it('renders the growth-multiplier tile prominently for an experiment session', async () => {
    mockFetch(200, experimentSummary);
    const { container, findByText } = renderAt();
    // The growth tile carries the "double growth" emphasis class and the value.
    await findByText(/growth/i);
    const growthTile = container.querySelector('.session-report__tile--growth');
    expect(growthTile).not.toBeNull();
    expect(growthTile!.textContent).toMatch(/2(\.0)?/);
    // Pre + post are shown as percentages.
    expect(container.textContent).toMatch(/25%/);
    expect(container.textContent).toMatch(/75%/);
  });

  it('shows "pre-test not run" (never an empty/0 field) when the pre-test is null', async () => {
    mockFetch(200, inSessionSummary);
    const { findByText, container } = renderAt();
    await findByText(/pre-test not run/i);
    // The growth tile must NOT show a fabricated number when growth is null.
    const growthTile = container.querySelector('.session-report__tile--growth');
    expect(growthTile).not.toBeNull();
    expect(growthTile!.textContent).not.toMatch(/\d/);
  });

  it('shows an auth-required state with an operator-secret input on a 401', async () => {
    mockFetch(401, { error: 'operator authentication required' });
    const { findByLabelText, container } = renderAt();
    await findByLabelText(/operator secret/i);
    expect(container.textContent).toMatch(/authoriz|operator/i);
  });

  it('retries with the operator secret in a header (never a query param) when submitted', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'auth' }), { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(experimentSummary), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const { findByLabelText, findByText, getByRole } = renderAt();
    const input = (await findByLabelText(/operator secret/i)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'super-secret' } });
    fireEvent.click(getByRole('button', { name: /load report/i }));

    await findByText(/growth/i);
    // The second call carried the secret as a header — and the URL has NO secret query.
    const secondCall = spy.mock.calls[1]!;
    const calledUrl = String(secondCall[0]);
    expect(calledUrl).not.toMatch(/secret/i);
    const init = secondCall[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get('x-operator-secret') ?? headers.get('authorization')).toBeTruthy();
  });

  it('shows an error state on a non-auth fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const { findByText } = renderAt();
    await findByText(/could not load|error|failed/i);
  });
});
