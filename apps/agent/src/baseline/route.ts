import http from 'node:http';
import type { Db } from '../db/client.js';
import type { BaselineChatProvider } from './chatProvider.js';
import {
  createBaselineSession,
  getBaselineSession,
  handleBaselineChat,
  handleBaselineTransfer,
  type BaselineServiceDeps,
} from './service.js';
import type { loadLesson } from '../lessons/loader.js';

/**
 * F-16 baseline REST routes, mounted on the agent's HTTP server (topology D2:
 * `/api/baseline/*` on apps/agent + a thin static SPA). Purely additive — touches
 * zero existing agent code paths.
 *
 *   POST /api/baseline/session            → create a baseline session, return the plan
 *   GET  /api/baseline/session/:id        → server-derived current progress (reconnect)
 *   POST /api/baseline/chat               → one chat turn (scored + logged)
 *   POST /api/baseline/transfer           → one held-out transfer submission (scored + logged)
 *
 * The chat provider is injectable; production uses GPT-5 (fairness), tests use a
 * deterministic stub (CI is offline). When no provider is configured (no
 * `OPENAI_API_KEY`), the routes that need the LLM FAIL CLOSED with 503 — the
 * `/api/realtime/session` pattern — never a half-configured success.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16 * 1024;

/**
 * Per-session serialization for the baseline write handlers (MR !7 review).
 * `handleBaselineChat`/`handleBaselineTransfer` are read-modify-write (read the log,
 * derive progress, call the LLM, append a turn). Two concurrent POSTs for the same
 * in-progress item can both pass the not-yet-complete check, both invoke the LLM, and
 * append duplicate turns — the score tally is idempotent (distinct-id counting), but
 * the LLM call and the log are not. Serialize per sessionId with the same keyed-lock
 * pattern server.ts uses for explain-back/recall. A promise-chain mutex: each key's
 * work is appended to that key's tail so same-session turns run strictly in order,
 * while different sessions stay fully concurrent.
 */
function makeKeyedLock(): <T>(key: string, fn: () => Promise<T>) => Promise<T> {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const prior = tails.get(key) ?? Promise.resolve();
    const run = prior.then(fn, fn);
    // Keep the chain alive but don't leak rejections into the next waiter's scheduling.
    tails.set(key, run.then(() => undefined, () => undefined));
    return run;
  };
}
const withBaselineSessionLock = makeKeyedLock();
const BODY_TIMEOUT_MS = 5_000;

export interface BaselineRouteDeps {
  db: Db;
  /** The GPT-5 chat provider, or `undefined` (no key) → the chat route 503s. */
  chat?: BaselineChatProvider;
  loadLessonFn?: typeof loadLesson;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('body timeout'));
      req.destroy();
    }, BODY_TIMEOUT_MS);
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        finish(() => reject(new Error('body too large')));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () =>
      finish(() => {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        if (raw === '') {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error('invalid JSON'));
        }
      }),
    );
    req.on('error', (err) => finish(() => reject(err)));
  });
}

function bodyErrorStatus(reason: string): number {
  return reason === 'body too large' ? 413 : reason === 'body timeout' ? 408 : 400;
}

/** Try to handle a baseline route. Returns `true` if it matched (response sent),
 *  `false` if the path isn't a baseline route (the caller falls through to 404). */
export function tryHandleBaselineRoute(
  deps: BaselineRouteDeps,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): boolean {
  const { pathname } = url;
  if (!pathname.startsWith('/api/baseline/')) return false;

  const service = (chat: BaselineChatProvider): BaselineServiceDeps => ({
    db: deps.db,
    chat,
    ...(deps.loadLessonFn ? { loadLessonFn: deps.loadLessonFn } : {}),
  });

  // The chat provider is required to CREATE a session (the learner can't start a
  // session whose chat turns would all 503) and to CHAT. Fail closed without a key.
  const requireChat = (): BaselineChatProvider | null => {
    if (!deps.chat) {
      sendJson(res, 503, { error: 'baseline chat not configured' });
      return null;
    }
    return deps.chat;
  };

  if (req.method === 'POST' && pathname === '/api/baseline/session') {
    const chat = requireChat();
    if (!chat) return true;
    createBaselineSession(service(chat))
      .then(({ sessionId, plan }) =>
        sendJson(res, 201, {
          sessionId,
          lessonId: plan.lessonId,
          contentItems: plan.contentItems,
          transferItemCount: plan.transferItems.length,
        }),
      )
      .catch(() => sendJson(res, 500, { error: 'failed to create baseline session' }));
    return true;
  }

  const sessionMatch = pathname.match(/^\/api\/baseline\/session\/([^/]+)$/);
  if (req.method === 'GET' && sessionMatch) {
    const sessionId = sessionMatch[1]!;
    if (!UUID_RE.test(sessionId)) {
      sendJson(res, 400, { error: 'sessionId must be a UUID' });
      return true;
    }
    // The provider isn't needed to READ progress, but the service type wants one;
    // pass a no-op (read paths never call .reply). Fail closed only on WRITE paths.
    getBaselineSession(service(deps.chat ?? NOOP_CHAT), sessionId)
      .then((view) =>
        view ? sendJson(res, 200, view) : sendJson(res, 404, { error: 'unknown session' }),
      )
      .catch(() => sendJson(res, 500, { error: 'failed to load baseline session' }));
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/baseline/chat') {
    const chat = requireChat();
    if (!chat) return true;
    handlePost(req, res, async (body) => {
      const sessionId = (body as { sessionId?: unknown })?.sessionId;
      const message = (body as { message?: unknown })?.message;
      if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) {
        sendJson(res, 400, { error: 'sessionId must be a UUID' });
        return;
      }
      if (typeof message !== 'string' || message.trim().length === 0) {
        sendJson(res, 400, { error: 'message is required' });
        return;
      }
      const result = await withBaselineSessionLock(sessionId, () =>
        handleBaselineChat(service(chat), sessionId, message),
      );
      if (result === null) {
        sendJson(res, 404, { error: 'unknown session' });
        return;
      }
      if ('error' in result) {
        sendJson(res, 409, { error: result.error });
        return;
      }
      sendJson(res, 200, result);
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/baseline/transfer') {
    const chat = deps.chat ?? NOOP_CHAT; // transfer scoring never calls the LLM
    handlePost(req, res, async (body) => {
      const sessionId = (body as { sessionId?: unknown })?.sessionId;
      const itemId = (body as { itemId?: unknown })?.itemId;
      const submission = (body as { submission?: unknown })?.submission;
      if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) {
        sendJson(res, 400, { error: 'sessionId must be a UUID' });
        return;
      }
      if (typeof itemId !== 'string' || itemId.length === 0) {
        sendJson(res, 400, { error: 'itemId is required' });
        return;
      }
      if (typeof submission !== 'string') {
        sendJson(res, 400, { error: 'submission is required' });
        return;
      }
      const result = await withBaselineSessionLock(sessionId, () =>
        handleBaselineTransfer(service(chat), sessionId, itemId, submission),
      );
      if (result === null) {
        sendJson(res, 404, { error: 'unknown session' });
        return;
      }
      if ('error' in result) {
        sendJson(res, 409, { error: result.error });
        return;
      }
      sendJson(res, 200, result);
    });
    return true;
  }

  sendJson(res, 404, { error: 'not found' });
  return true;
}

/** Read + parse the body, then run `fn`; map body errors to the right 4xx and
 *  any handler throw to a 500 (never an unhandled rejection that crashes). */
function handlePost(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  fn: (body: unknown) => Promise<void>,
): void {
  readJsonBody(req)
    .then((body) => {
      if (body === null) {
        sendJson(res, 400, { error: 'request body required' });
        return undefined;
      }
      return fn(body);
    })
    .catch((err: unknown) => {
      const reason = err instanceof Error ? err.message : 'invalid request body';
      if (reason === 'invalid JSON' || reason === 'body too large' || reason === 'body timeout') {
        sendJson(res, bodyErrorStatus(reason), { error: reason });
      } else {
        sendJson(res, 500, { error: 'baseline request failed' });
      }
    });
}

/** A never-called placeholder provider for read/transfer paths that don't chat. */
const NOOP_CHAT: BaselineChatProvider = {
  reply: () => Promise.reject(new Error('baseline chat not configured')),
};
