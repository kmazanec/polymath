import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { HandoffArtifact } from '@polymath/contract';
import { TutorHandoff } from './TutorHandoff.js';

afterEach(cleanup);

const ARTIFACT: HandoffArtifact = {
  sessionId: '11111111-1111-1111-1111-111111111111',
  generatedAt: '2026-05-29T00:00:00.000Z',
  warmIntro: "I've taken you as far as I usefully can on this. Here's what to ask next.",
  summary: { kcsMastered: ['AND'], kcsStuck: ['OR'], masteryStatus: 'in_progress' },
  masteredKcs: ['AND'],
  stuckKcs: ['OR'],
  tutorQuestions: [
    { kc: 'OR', question: 'Can we walk through OR together?' },
    { kc: 'OR', question: 'How does OR differ from AND?' },
    { kc: 'transfer', question: 'Where do these gates show up in real code?' },
  ],
  nerdyFooter: 'Bring this to your next session with a Nerdy human tutor.',
};

function renderAt(path: string, fetchArtifact: typeof fetch | (() => Promise<Response>)) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/handoff/:sessionId"
          element={<TutorHandoff fetchArtifact={fetchArtifact as typeof fetch} />}
        />
        <Route
          path="/handoff/:sessionId/:token"
          element={<TutorHandoff fetchArtifact={fetchArtifact as typeof fetch} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe('TutorHandoff', () => {
  it('shows a loading state first', () => {
    const fetchArtifact = vi.fn(() => new Promise<Response>(() => {})); // never resolves
    renderAt('/handoff/11111111-1111-1111-1111-111111111111', fetchArtifact);
    expect(screen.getByText(/loading|preparing/i)).toBeTruthy();
  });

  it('renders the artifact once loaded', async () => {
    const fetchArtifact = vi.fn(async () => okResponse({ artifact: ARTIFACT, shareUrl: '/handoff/x/tok' }));
    renderAt('/handoff/11111111-1111-1111-1111-111111111111', fetchArtifact);
    await waitFor(() => expect(screen.getByText(/taken you as far/i)).toBeTruthy());
  });

  it('renders sections in order: intro -> mastered -> stuck -> questions -> footer (AC#2)', async () => {
    const fetchArtifact = vi.fn(async () => okResponse({ artifact: ARTIFACT, shareUrl: null }));
    const { container } = renderAt('/handoff/11111111-1111-1111-1111-111111111111', fetchArtifact);
    await waitFor(() => expect(screen.getByText(/taken you as far/i)).toBeTruthy());
    const text = container.textContent ?? '';
    const intro = text.indexOf('taken you as far');
    const mastered = text.toLowerCase().indexOf('master');
    const stuck = text.toLowerCase().indexOf('stuck') >= 0
      ? text.toLowerCase().indexOf('stuck')
      : text.toLowerCase().indexOf('help');
    const questions = text.toLowerCase().indexOf('walk through or');
    const footer = text.indexOf('Nerdy human tutor');
    expect(intro).toBeGreaterThanOrEqual(0);
    expect(intro).toBeLessThan(mastered);
    expect(mastered).toBeLessThan(stuck);
    expect(stuck).toBeLessThan(questions);
    expect(questions).toBeLessThan(footer);
  });

  it('uses warm Nerdy-aligned framing, never "I failed" (AC#5)', async () => {
    const fetchArtifact = vi.fn(async () => okResponse({ artifact: ARTIFACT, shareUrl: null }));
    const { container } = renderAt('/handoff/11111111-1111-1111-1111-111111111111', fetchArtifact);
    await waitFor(() => expect(screen.getByText(/taken you as far/i)).toBeTruthy());
    expect((container.textContent ?? '').toLowerCase()).not.toContain('failed');
  });

  it('shows an error state when the fetch fails', async () => {
    const fetchArtifact = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response);
    renderAt('/handoff/11111111-1111-1111-1111-111111111111', fetchArtifact);
    await waitFor(() => expect(screen.getByRole('heading', { name: /unavailable/i })).toBeTruthy());
  });

  it('"Print / Download PDF" button calls window.print()', async () => {
    const fetchArtifact = vi.fn(async () => okResponse({ artifact: ARTIFACT, shareUrl: '/handoff/x/tok' }));
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    renderAt('/handoff/11111111-1111-1111-1111-111111111111', fetchArtifact);
    await waitFor(() => expect(screen.getByText(/taken you as far/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /print|download|pdf/i }));
    expect(printSpy).toHaveBeenCalled();
    printSpy.mockRestore();
  });

  it('fetches the tokened API path when a token is in the route', async () => {
    const fetchArtifact = vi.fn(async () => okResponse({ artifact: ARTIFACT }));
    renderAt('/handoff/11111111-1111-1111-1111-111111111111/abc123', fetchArtifact);
    await waitFor(() => expect(fetchArtifact).toHaveBeenCalled());
    expect(fetchArtifact.mock.calls[0]![0]).toBe(
      '/api/session/11111111-1111-1111-1111-111111111111/handoff/abc123',
    );
  });

  it('fetches the bare API path when no token is present', async () => {
    const fetchArtifact = vi.fn(async () => okResponse({ artifact: ARTIFACT, shareUrl: null }));
    renderAt('/handoff/11111111-1111-1111-1111-111111111111', fetchArtifact);
    await waitFor(() => expect(fetchArtifact).toHaveBeenCalled());
    expect(fetchArtifact.mock.calls[0]![0]).toBe(
      '/api/session/11111111-1111-1111-1111-111111111111/handoff',
    );
  });
});
