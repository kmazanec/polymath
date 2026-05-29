/**
 * Thin client for the F-16 baseline routes (which live on apps/agent — topology
 * D2). All scoring + logging is server-side; this SPA only renders the dialogue
 * and posts learner input. The `app:'baseline'` tagging happens entirely on the
 * server; the browser never asserts which arm it is.
 */

export interface BaselineContentItem {
  itemId: string;
  kc: string;
  targetExpression: string;
}

export type BaselineProgress =
  | { phase: 'chat'; item: BaselineContentItem; itemIndex: number; itemCount: number; score: BaselineScore }
  | { phase: 'transfer'; item: { itemId: string }; itemIndex: number; itemCount: number; score: BaselineScore }
  | { phase: 'ended'; score: BaselineScore };

export interface BaselineScore {
  correct: number;
  total: number;
}

export interface CreateSessionResponse {
  sessionId: string;
  lessonId: number;
  contentItems: BaselineContentItem[];
  transferItemCount: number;
}

export interface ChatResponse {
  reply: string;
  correct: boolean | null;
  itemComplete: boolean;
  progress: BaselineProgress;
}

export interface TransferResponse {
  correct: boolean;
  progress: BaselineProgress;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error((detail as { error?: string }).error ?? `request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export const baselineApi = {
  createSession: () => postJson<CreateSessionResponse>('/api/baseline/session'),
  chat: (sessionId: string, message: string) =>
    postJson<ChatResponse>('/api/baseline/chat', { sessionId, message }),
  transfer: (sessionId: string, itemId: string, submission: string) =>
    postJson<TransferResponse>('/api/baseline/transfer', { sessionId, itemId, submission }),
  session: async (sessionId: string) => {
    const res = await fetch(`/api/baseline/session/${sessionId}`);
    if (!res.ok) throw new Error(`request failed (${res.status})`);
    return (await res.json()) as { sessionId: string; progress: BaselineProgress };
  },
};
