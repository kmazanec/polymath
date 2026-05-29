import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { baselineApi, type BaselineProgress, type CreateSessionResponse } from './api.js';
import { LatexText } from './Latex.js';

/**
 * F-16 chat-baseline SPA. A minimal chat interface (input + message history) +
 * an end-of-session transfer check. NO statechart, NO curated components, NO
 * mastery gate, NO voice/explain-back — the architectural pieces ADR-011 names as
 * the difference from Polymath. The learner completes an L1 session via chat alone
 * over the SAME lesson content, scored by the SAME validator (server-side).
 */

interface ChatMessage {
  role: 'tutor' | 'learner';
  text: string;
}

type Status = 'loading' | 'ready' | 'error';

/** Where the in-progress baseline sessionId is persisted across reloads. A mid-session
 *  refresh/reload/network blip must RESUME the same session (server-derived progress)
 *  rather than create a fresh one — otherwise every refresh writes a partial,
 *  never-ended session into the shared tables that F-17/F-21 fold into the baseline
 *  arm as a confound. Reconnect is purely server-derived (the route returns `progress`),
 *  so we restore progress; the visible chat history can't be repainted (the route
 *  doesn't return dialogue) and is intentionally left to start fresh on resume. */
const SESSION_STORAGE_KEY = 'polymath.baseline.sessionId';

function loadStoredSessionId(): string | null {
  try {
    return window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeSessionId(id: string): void {
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, id);
  } catch {
    // sessionStorage unavailable (private mode / disabled) — resume is best-effort.
  }
}

function clearStoredSessionId(): void {
  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

const INTRO_MESSAGE: ChatMessage = {
  role: 'tutor',
  text:
    'Welcome to the Boolean logic baseline tutor (Lesson 1: AND, OR, NOT). ' +
    "I'll walk you through three items, then two transfer questions. " +
    'Type a Boolean expression using the given variables and AND / OR / NOT.',
};

export function App(): ReactElement {
  const [status, setStatus] = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [session, setSession] = useState<CreateSessionResponse | null>(null);
  const [sessionId, setSessionId] = useState<string>('');
  const [progress, setProgress] = useState<BaselineProgress | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const start = useCallback(async () => {
    setStatus('loading');
    setErrorMsg('');
    // Resume an in-progress session across a refresh/reload if one is stored, so a
    // mid-session reload doesn't abandon it and orphan a partial row. Progress is
    // server-derived from the reconnect route; only create a NEW session when there
    // is no stored id or the stored one no longer exists (404).
    const stored = loadStoredSessionId();
    if (stored) {
      try {
        const view = await baselineApi.session(stored);
        setSessionId(view.sessionId);
        setProgress(view.progress);
        setMessages([{ ...INTRO_MESSAGE }]);
        setStatus('ready');
        return;
      } catch {
        // Stored session is gone (404) or unreachable — fall through to create a fresh one.
        clearStoredSessionId();
      }
    }
    try {
      const created = await baselineApi.createSession();
      storeSessionId(created.sessionId);
      setSession(created);
      setSessionId(created.sessionId);
      const view = await baselineApi.session(created.sessionId);
      setProgress(view.progress);
      setMessages([{ ...INTRO_MESSAGE }]);
      setStatus('ready');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'failed to start');
      setStatus('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void start();
  }, [start]);

  const sendChat = useCallback(async () => {
    const message = input.trim();
    if (message.length === 0 || busy || !sessionId) return;
    setBusy(true);
    setInput('');
    setMessages((m) => [...m, { role: 'learner', text: message }]);
    try {
      const res = await baselineApi.chat(sessionId, message);
      setMessages((m) => [...m, { role: 'tutor', text: res.reply }]);
      setProgress(res.progress);
      if (res.progress.phase === 'ended') clearStoredSessionId();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'chat failed');
    } finally {
      setBusy(false);
    }
  }, [input, busy, sessionId]);

  const submitTransfer = useCallback(
    async (itemId: string, submission: string) => {
      if (busy || !sessionId) return;
      setBusy(true);
      try {
        const res = await baselineApi.transfer(sessionId, itemId, submission);
        setProgress(res.progress);
        if (res.progress.phase === 'ended') clearStoredSessionId();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'transfer failed');
      } finally {
        setBusy(false);
      }
    },
    [busy, sessionId],
  );

  if (status === 'loading') return <main className="bl-shell">Starting baseline session…</main>;
  if (status === 'error')
    return (
      <main className="bl-shell">
        <p className="bl-error">Could not start the baseline: {errorMsg}</p>
        <button onClick={() => void start()}>Retry</button>
      </main>
    );

  return (
    <main className="bl-shell">
      <header className="bl-header">
        <h1>Boolean logic — chat baseline</h1>
        {session ? <p className="bl-sub">Lesson {session.lessonId} · {session.contentItems.length} items</p> : null}
        {progress ? (
          <p className="bl-score" data-testid="score">
            Score: {progress.score.correct}/{progress.score.total}
          </p>
        ) : null}
      </header>

      <section className="bl-history" data-testid="history">
        {messages.map((m, i) => (
          <div key={i} className={`bl-msg bl-msg-${m.role}`}>
            <span className="bl-role">{m.role === 'tutor' ? 'Tutor' : 'You'}</span>
            <div className="bl-text">
              <LatexText text={m.text} />
            </div>
          </div>
        ))}
      </section>

      {progress?.phase === 'chat' ? (
        <ChatComposer
          itemIndex={progress.itemIndex}
          itemCount={progress.itemCount}
          input={input}
          busy={busy}
          onChange={setInput}
          onSend={() => void sendChat()}
        />
      ) : null}

      {progress?.phase === 'transfer' ? (
        <TransferComposer
          itemId={progress.item.itemId}
          itemIndex={progress.itemIndex}
          itemCount={progress.itemCount}
          busy={busy}
          onSubmit={(submission) => void submitTransfer(progress.item.itemId, submission)}
        />
      ) : null}

      {progress?.phase === 'ended' ? (
        <section className="bl-ended" data-testid="ended">
          <h2>Session complete</h2>
          <p>
            Final score: {progress.score.correct}/{progress.score.total}
          </p>
        </section>
      ) : null}

      {errorMsg && status === 'ready' ? <p className="bl-error">{errorMsg}</p> : null}
    </main>
  );
}

function ChatComposer(props: {
  itemIndex: number;
  itemCount: number;
  input: string;
  busy: boolean;
  onChange: (v: string) => void;
  onSend: () => void;
}): ReactElement {
  return (
    <form
      className="bl-composer"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSend();
      }}
    >
      <label className="bl-progress">
        Item {props.itemIndex + 1} of {props.itemCount}
      </label>
      <input
        aria-label="message"
        value={props.input}
        disabled={props.busy}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder="Type a Boolean expression or a question…"
      />
      <button type="submit" disabled={props.busy || props.input.trim().length === 0}>
        Send
      </button>
    </form>
  );
}

function TransferComposer(props: {
  itemId: string;
  itemIndex: number;
  itemCount: number;
  busy: boolean;
  onSubmit: (submission: string) => void;
}): ReactElement {
  const [value, setValue] = useState('');
  return (
    <form
      className="bl-transfer"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim().length === 0) return;
        props.onSubmit(value.trim());
        setValue('');
      }}
    >
      <h2>Transfer check</h2>
      <p>
        Transfer item {props.itemIndex + 1} of {props.itemCount} ({props.itemId}). Enter your
        Boolean expression.
      </p>
      <input
        aria-label="transfer answer"
        value={value}
        disabled={props.busy}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. NOT (A AND B)"
      />
      <button type="submit" disabled={props.busy || value.trim().length === 0}>
        Submit
      </button>
    </form>
  );
}
