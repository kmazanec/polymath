import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { App } from './App.js';

/**
 * Chat-shell component test (F-16 testing requirement). The network is mocked — the
 * scoring + logging live on the server (apps/agent); the shell only renders the
 * dialogue and posts learner input. Asserts: the intro renders, a learner message
 * round-trips a tutor reply, and the fixed arc transitions chat → transfer → ended.
 */

interface MockRoute {
  match: (url: string, init?: RequestInit) => boolean;
  reply: (url: string, init?: RequestInit) => unknown;
}

function mockFetch(routes: MockRoute[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const route = routes.find((r) => r.match(url, init));
      if (!route) throw new Error(`unmocked fetch: ${url}`);
      const body = route.reply(url, init);
      return {
        ok: true,
        status: 200,
        json: async () => body,
      } as Response;
    }),
  );
}

const SESSION_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe('baseline chat shell', () => {
  it('renders the intro and the first content item composer', async () => {
    mockFetch([
      {
        match: (u, i) => u.endsWith('/api/baseline/session') && i?.method === 'POST',
        reply: () => ({
          sessionId: SESSION_ID,
          lessonId: 1,
          contentItems: [{ itemId: 'l1-and', kc: 'AND', targetExpression: 'A AND B' }],
          transferItemCount: 2,
        }),
      },
      {
        match: (u) => u.includes(`/api/baseline/session/${SESSION_ID}`),
        reply: () => ({
          sessionId: SESSION_ID,
          progress: {
            phase: 'chat',
            item: { itemId: 'l1-and', kc: 'AND', targetExpression: 'A AND B' },
            itemIndex: 0,
            itemCount: 3,
            score: { correct: 0, total: 0 },
          },
        }),
      },
    ]);
    render(<App />);
    await waitFor(() => expect(screen.getByText(/baseline tutor/i)).toBeTruthy());
    expect(screen.getByLabelText('message')).toBeTruthy();
    expect(screen.getByText(/Item 1 of 3/i)).toBeTruthy();
  });

  it('round-trips a learner message into a tutor reply and reaches the ended screen', async () => {
    let chatCalls = 0;
    mockFetch([
      {
        match: (u, i) => u.endsWith('/api/baseline/session') && i?.method === 'POST',
        reply: () => ({
          sessionId: SESSION_ID,
          lessonId: 1,
          contentItems: [{ itemId: 'l1-and', kc: 'AND', targetExpression: 'A AND B' }],
          transferItemCount: 0,
        }),
      },
      {
        match: (u) => u.includes(`/api/baseline/session/${SESSION_ID}`),
        reply: () => ({
          sessionId: SESSION_ID,
          progress: {
            phase: 'chat',
            item: { itemId: 'l1-and', kc: 'AND', targetExpression: 'A AND B' },
            itemIndex: 0,
            itemCount: 1,
            score: { correct: 0, total: 0 },
          },
        }),
      },
      {
        match: (u) => u.endsWith('/api/baseline/chat'),
        reply: () => {
          chatCalls += 1;
          return {
            reply: 'Correct! The answer is $A \\land B$.',
            correct: true,
            itemComplete: true,
            progress: { phase: 'ended', score: { correct: 1, total: 1 } },
          };
        },
      },
    ]);
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('message')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('message'), { target: { value: 'A AND B' } });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => expect(screen.getByTestId('ended')).toBeTruthy());
    expect(chatCalls).toBe(1);
    expect(screen.getByText(/Final score: 1\/1/)).toBeTruthy();
    // The learner's message is in the history.
    expect(screen.getByText('A AND B')).toBeTruthy();
  });

  it('persists the created sessionId so a mid-session refresh RESUMES, not re-creates', async () => {
    let createCalls = 0;
    const resumeProgress = {
      phase: 'chat',
      item: { itemId: 'l1-or', kc: 'OR', targetExpression: 'A OR B' },
      itemIndex: 1,
      itemCount: 3,
      score: { correct: 1, total: 1 },
    };
    const routes: MockRoute[] = [
      {
        match: (u, i) => u.endsWith('/api/baseline/session') && i?.method === 'POST',
        reply: () => {
          createCalls += 1;
          return {
            sessionId: SESSION_ID,
            lessonId: 1,
            contentItems: [{ itemId: 'l1-and', kc: 'AND', targetExpression: 'A AND B' }],
            transferItemCount: 2,
          };
        },
      },
      {
        match: (u) => u.includes(`/api/baseline/session/${SESSION_ID}`),
        reply: () => ({ sessionId: SESSION_ID, progress: resumeProgress }),
      },
    ];

    // First mount: no stored id → creates a session and stores it.
    mockFetch(routes);
    const first = render(<App />);
    await waitFor(() => expect(screen.getByLabelText('message')).toBeTruthy());
    expect(createCalls).toBe(1);
    expect(window.sessionStorage.getItem('polymath.baseline.sessionId')).toBe(SESSION_ID);
    first.unmount();
    cleanup();

    // Simulated refresh: stored id is present → resumes via the reconnect route, no new create.
    mockFetch(routes);
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('message')).toBeTruthy());
    expect(createCalls).toBe(1); // still 1 — resumed, did not re-create
    // Resumed to the server-derived progress (item 2 of 3, score 1/1).
    expect(screen.getByText(/Item 2 of 3/i)).toBeTruthy();
    expect(screen.getByText(/Score: 1\/1/)).toBeTruthy();
  });

  it('creates a fresh session when the stored sessionId 404s', async () => {
    window.sessionStorage.setItem('polymath.baseline.sessionId', 'dead-beef');
    let createCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/baseline/session/dead-beef')) {
          return { ok: false, status: 404, json: async () => ({}) } as Response;
        }
        if (url.endsWith('/api/baseline/session') && init?.method === 'POST') {
          createCalls += 1;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              sessionId: SESSION_ID,
              lessonId: 1,
              contentItems: [{ itemId: 'l1-and', kc: 'AND', targetExpression: 'A AND B' }],
              transferItemCount: 2,
            }),
          } as Response;
        }
        if (url.includes(`/api/baseline/session/${SESSION_ID}`)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              sessionId: SESSION_ID,
              progress: {
                phase: 'chat',
                item: { itemId: 'l1-and', kc: 'AND', targetExpression: 'A AND B' },
                itemIndex: 0,
                itemCount: 3,
                score: { correct: 0, total: 0 },
              },
            }),
          } as Response;
        }
        throw new Error(`unmocked fetch: ${url}`);
      }),
    );
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('message')).toBeTruthy());
    expect(createCalls).toBe(1);
    // The dead id was replaced with the new one.
    expect(window.sessionStorage.getItem('polymath.baseline.sessionId')).toBe(SESSION_ID);
  });
});
