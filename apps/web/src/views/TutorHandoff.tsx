import { type ReactElement, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { HandoffArtifact } from '@polymath/contract';
import './tutorHandoff.css';

/**
 * The tutor-handoff artifact view (ADR-012 stretch). A learner-facing, shareable,
 * printable one-pager that frames the AI session as preparation for a Nerdy human
 * tutor: what they nailed, where a human helps most, and exactly what to ask next.
 *
 * Reached two ways:
 *   /handoff/:sessionId          — the learner's own (fetches the bare API path; a
 *                                  shareable link is created only when the learner
 *                                  clicks "Create shareable link", which POSTs to
 *                                  /handoff/share — never auto-minted on read, MR !9).
 *   /handoff/:sessionId/:token   — a shared link (fetches the tokened API path).
 *
 * PDF is "Print → Save as PDF" via `@media print` + `window.print()` — no Puppeteer,
 * no Chromium in the image, no cross-container render (D24-1).
 */

interface TutorHandoffProps {
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchArtifact?: typeof fetch;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'loaded'; artifact: HandoffArtifact; shareUrl: string | null }
  | { status: 'error' };

export function TutorHandoff({ fetchArtifact = fetch }: TutorHandoffProps): ReactElement {
  const { sessionId, token } = useParams<{ sessionId: string; token?: string }>();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    if (!sessionId) {
      setState({ status: 'error' });
      return;
    }
    const apiPath = token
      ? `/api/session/${sessionId}/handoff/${token}`
      : `/api/session/${sessionId}/handoff`;
    void fetchArtifact(apiPath)
      .then(async (res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return res.json() as Promise<{ artifact: HandoffArtifact; shareUrl?: string | null }>;
      })
      .then((body) => {
        if (cancelled) return;
        setState({ status: 'loaded', artifact: body.artifact, shareUrl: body.shareUrl ?? null });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, token, fetchArtifact]);

  if (state.status === 'loading') {
    return (
      <main className="handoff handoff--status">
        <p>Preparing your handoff…</p>
      </main>
    );
  }
  if (state.status === 'error') {
    return (
      <main className="handoff handoff--status">
        <h1>Handoff unavailable</h1>
        <p>We couldn&apos;t load this handoff. The link may be incomplete or expired.</p>
      </main>
    );
  }

  const { artifact, shareUrl } = state;
  const shareHref = shareUrl ? `${window.location.origin}${shareUrl}` : null;
  // The owner view (no :token) may create a share link on demand; a shared view never
  // re-mints. POST /handoff/share is the only path that mints (MR !9 review).
  const isOwnerView = !token;

  const createShareLink = (): void => {
    if (!sessionId) return;
    void fetchArtifact(`/api/session/${sessionId}/handoff/share`, { method: 'POST' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return res.json() as Promise<{ shareUrl?: string | null }>;
      })
      .then((body) => {
        if (body.shareUrl) setState({ status: 'loaded', artifact, shareUrl: body.shareUrl });
      })
      .catch(() => {
        /* leave the page as-is; the learner can retry the button */
      });
  };

  return (
    <main className="handoff">
      <div className="handoff__actions handoff__no-print">
        <button type="button" className="handoff__print" onClick={() => window.print()}>
          Print / Download PDF
        </button>
        {shareHref ? (
          <a className="handoff__share" href={shareHref}>
            Shareable link
          </a>
        ) : (
          isOwnerView && (
            <button type="button" className="handoff__share" onClick={createShareLink}>
              Create shareable link
            </button>
          )
        )}
      </div>

      {/* AC#2 order: intro -> mastered -> stuck -> questions -> footer. */}
      <header className="handoff__header">
        <p className="handoff__eyebrow">Your tutor handoff</p>
        <h1 className="handoff__intro">{artifact.warmIntro}</h1>
      </header>

      <section className="handoff__section handoff__mastered">
        <h2>What you&apos;ve mastered</h2>
        {artifact.masteredKcs.length > 0 ? (
          <ul>
            {artifact.masteredKcs.map((kc) => (
              <li key={kc}>{kc}</li>
            ))}
          </ul>
        ) : (
          <p>We&apos;re still building toward your first mastered concept — that&apos;s exactly what your tutor can help with.</p>
        )}
      </section>

      <section className="handoff__section handoff__stuck">
        <h2>Where a human can help most</h2>
        {artifact.stuckKcs.length > 0 ? (
          <ul>
            {artifact.stuckKcs.map((kc) => (
              <li key={kc}>{kc}</li>
            ))}
          </ul>
        ) : (
          <p>You cleared everything here — bring the questions below to go deeper.</p>
        )}
      </section>

      <section className="handoff__section handoff__questions">
        <h2>What to ask your tutor</h2>
        <ol>
          {artifact.tutorQuestions.map((q, i) => (
            <li key={`${q.kc}-${i}`}>
              <span className="handoff__q-kc">{q.kc}</span>
              <span className="handoff__q-text">{q.question}</span>
            </li>
          ))}
        </ol>
      </section>

      <footer className="handoff__footer">
        <p>{artifact.nerdyFooter}</p>
        <p className="handoff__generated">
          Generated {new Date(artifact.generatedAt).toLocaleString()}
        </p>
      </footer>
    </main>
  );
}
