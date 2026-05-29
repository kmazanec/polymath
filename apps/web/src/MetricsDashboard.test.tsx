import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MetricsDashboard, type MetricResult } from './MetricsDashboard.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function metric(over: Partial<MetricResult>): MetricResult {
  return {
    id: 'm',
    label: 'A metric',
    value: null,
    threshold: 1,
    unit: '',
    pass: null,
    state: 'insufficient_data',
    sampleN: 0,
    source: 'some source',
    ...over,
  };
}

const FOUR_STATES: MetricResult[] = [
  metric({ id: 'a_pass', label: 'Pass metric', state: 'pass', pass: true, value: 0.9, sampleN: 10, threshold: 0.8, unit: '%' }),
  metric({ id: 'b_fail', label: 'Fail metric', state: 'fail', pass: false, value: 0.4, sampleN: 10, threshold: 0.8, unit: '%' }),
  metric({ id: 'c_insufficient', label: 'Insufficient metric', state: 'insufficient_data', sampleN: 2 }),
  metric({ id: 'd_unconfigured', label: 'Unconfigured metric', state: 'unconfigured', note: 'source pending' }),
];

function mockFetchOnce(payload: { metrics: MetricResult[]; generatedAt: string }, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status === 200,
      status,
      json: async () => payload,
    }),
  );
}

describe('MetricsDashboard', () => {
  beforeEach(() => {
    // No auto-fetch on mount: the dashboard waits for the operator secret to be entered.
  });

  it('renders all four tile states distinctly (none collapsed into pass/fail)', async () => {
    mockFetchOnce({ metrics: FOUR_STATES, generatedAt: '2026-05-29T00:00:00Z' });
    render(<MetricsDashboard />);

    // Supply the operator secret + load.
    fireEvent.change(screen.getByLabelText(/operator secret/i), { target: { value: 's3cr3t' } });
    fireEvent.click(screen.getByRole('button', { name: /load/i }));

    await waitFor(() => expect(screen.getByText('Pass metric')).toBeTruthy());

    const passTile = document.querySelector('[data-metric-id="a_pass"]')!;
    const failTile = document.querySelector('[data-metric-id="b_fail"]')!;
    const insufTile = document.querySelector('[data-metric-id="c_insufficient"]')!;
    const unconfTile = document.querySelector('[data-metric-id="d_unconfigured"]')!;

    expect(passTile.getAttribute('data-state')).toBe('pass');
    expect(failTile.getAttribute('data-state')).toBe('fail');
    expect(insufTile.getAttribute('data-state')).toBe('insufficient_data');
    expect(unconfTile.getAttribute('data-state')).toBe('unconfigured');

    // Gray states must NOT report a pass/fail verdict text.
    expect(insufTile.textContent).toMatch(/insufficient data/i);
    expect(insufTile.textContent).toContain('2'); // sampleN surfaced
    expect(unconfTile.textContent).toMatch(/not configured/i);
  });

  it('sends the operator secret in the X-Operator-Secret header, never a query param', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ metrics: FOUR_STATES, generatedAt: 'now' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MetricsDashboard />);
    fireEvent.change(screen.getByLabelText(/operator secret/i), { target: { value: 'topsecret' } });
    fireEvent.click(screen.getByRole('button', { name: /load/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [calledUrl, init] = fetchMock.mock.calls[0]!;
    expect(String(calledUrl)).not.toContain('topsecret'); // never in the URL
    expect((init as RequestInit).headers).toMatchObject({ 'X-Operator-Secret': 'topsecret' });
  });

  it('surfaces a limitations memo summarising failing + gray tiles (AC#3)', async () => {
    mockFetchOnce({ metrics: FOUR_STATES, generatedAt: 'now' });
    render(<MetricsDashboard />);
    fireEvent.change(screen.getByLabelText(/operator secret/i), { target: { value: 's' } });
    fireEvent.click(screen.getByRole('button', { name: /load/i }));

    await waitFor(() => expect(screen.getByText('Fail metric')).toBeTruthy());
    const memo = document.querySelector('[data-testid="limitations-memo"]')!;
    expect(memo).not.toBeNull();
    // The memo names the failing metric and the gray ones honestly.
    expect(memo.textContent).toMatch(/Fail metric/);
    expect(memo.textContent).toMatch(/Insufficient metric|Unconfigured metric/);
    // A passing metric is NOT a limitation.
    expect(memo.textContent).not.toMatch(/Pass metric/);
  });

  it('shows an auth error when the endpoint returns 401', async () => {
    mockFetchOnce({ metrics: [], generatedAt: 'now' }, 401);
    render(<MetricsDashboard />);
    fireEvent.change(screen.getByLabelText(/operator secret/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /load/i }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/unauthor|denied|401/i));
  });

  it('shows a fetch error when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    render(<MetricsDashboard />);
    fireEvent.change(screen.getByLabelText(/operator secret/i), { target: { value: 's' } });
    fireEvent.click(screen.getByRole('button', { name: /load/i }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/error|failed/i));
  });
});
