/**
 * F-16 baseline per-session event-log shape — the LOCKED F-16↔F-17 contract.
 *
 * The chat-baseline arm writes to the SAME shared `events`/`sessions` tables as
 * Polymath, discriminated by the barrier `app` column (D3): every baseline row
 * carries `app:'baseline'` at the COLUMN level (so F-17/F-21 filter
 * `where app = 'baseline'` without digging into the jsonb payload), and the
 * structured per-turn record lives in `events.payload` with the shape below.
 *
 * F-17 (experiment scaffolding) READS this shape; F-21 (counter-metrics) reads
 * the same rows. It is therefore APPEND-ONLY once shipped — add optional fields,
 * never reshape or rename. The four kinds are a fixed-length session arc:
 *
 *   session_started  → one per session, when the learner opens the chat.
 *   chat_turn        → one per learner message; carries the scored verdict when
 *                      the learner's message parsed as a Boolean expression for
 *                      the current content item (`correct: true|false`), or
 *                      `correct: null` when the turn was prose / a question (no
 *                      expression to score — re-prompt, NOT "wrong").
 *   transfer_submitted → one per held-out transfer item answered at session end.
 *   session_ended    → one per session, carrying the final score tally.
 *
 * Correctness on EVERY scored turn (chat + transfer) goes through the shared
 * `scoreEquivalence` (var-capped + parse-error→false) — the same path Polymath
 * uses, so the baseline is never unfairly scored (ADR-011) and never enumerable
 * into a DoS.
 */

/** The literal stored in `events.kind` (and `app`) for baseline rows. */
export const BASELINE_APP = 'baseline' as const;

export type BaselineEventKind =
  | 'session_started'
  | 'chat_turn'
  | 'transfer_submitted'
  | 'session_ended';

/** Running score tally carried on `chat_turn`/`transfer_submitted`/`session_ended`. */
export interface BaselineScore {
  /** Content + transfer items answered correctly so far. */
  correct: number;
  /** Total scored items so far. */
  total: number;
}

/** `events.payload` for `app:'baseline'` rows. Discriminated by `kind`. The
 *  `app` field is mirrored INSIDE the payload too (belt-and-braces for a consumer
 *  reading a raw payload), but the COLUMN is the authoritative discriminator. */
export type BaselineEventPayload =
  | {
      kind: 'session_started';
      app: typeof BASELINE_APP;
      lessonId: number;
      /** The fixed item arc this session will walk (content then transfer). */
      contentItemIds: string[];
      transferItemIds: string[];
    }
  | {
      kind: 'chat_turn';
      app: typeof BASELINE_APP;
      /** The content item the learner is currently working (the prompt they answered). */
      itemId: string;
      /** The learner's raw message (free text — prose or a Boolean expression). */
      message: string;
      /** The tutor's reply text. */
      reply: string;
      /** Server-scored verdict via the SHARED scoreEquivalence when the message
       *  parsed as a Boolean expression for `itemId`; `null` when the turn was
       *  prose / a question with no expression to score (a re-prompt, not "wrong"). */
      correct: boolean | null;
      /** True once this content item is satisfied (a correct expression seen). */
      itemComplete: boolean;
      score: BaselineScore;
    }
  | {
      kind: 'transfer_submitted';
      app: typeof BASELINE_APP;
      itemId: string;
      /** The learner's raw answer to the held-out transfer item. */
      submission: string;
      /** Server-scored verdict (shared scoreEquivalence) against the bank's
       *  canonical target expression. A transfer answer is always an expression
       *  attempt, so this is never null. */
      correct: boolean;
      score: BaselineScore;
    }
  | {
      kind: 'session_ended';
      app: typeof BASELINE_APP;
      score: BaselineScore;
    };
