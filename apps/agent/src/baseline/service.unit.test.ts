import { describe, expect, it } from 'vitest';
import { deriveProgress, type BaselineSessionPlan } from './service.js';
import { BASELINE_APP, type BaselineEventPayload } from './log.js';

/**
 * Pure server-side derivation (no DB). `deriveProgress` is the F-16 "what does the
 * learner do next" truth-maker — folded from the logged events, never from a client
 * frame (CLAUDE.md "server never trusts the client"). These tests pin the fixed-length
 * arc: 3 content items → 2 transfer items → ended, and the server-derived score tally.
 */

const plan: BaselineSessionPlan = {
  sessionId: '00000000-0000-0000-0000-000000000000',
  lessonId: 1,
  contentItems: [
    { itemId: 'l1-and', kc: 'AND', targetExpression: 'A AND B' },
    { itemId: 'l1-or', kc: 'OR', targetExpression: 'A OR B' },
    { itemId: 'l1-not', kc: 'NOT', targetExpression: 'NOT A' },
  ],
  transferItems: [
    { itemId: 't1', targetExpression: 'NOT (A AND B)' },
    { itemId: 't2', targetExpression: 'A OR NOT B' },
  ],
};

const started: BaselineEventPayload = {
  kind: 'session_started',
  app: BASELINE_APP,
  lessonId: 1,
  contentItemIds: ['l1-and', 'l1-or', 'l1-not'],
  transferItemIds: ['t1', 't2'],
};

function chatTurn(itemId: string, correct: boolean | null, itemComplete: boolean): BaselineEventPayload {
  return {
    kind: 'chat_turn',
    app: BASELINE_APP,
    itemId,
    message: 'x',
    reply: 'y',
    correct,
    itemComplete,
    score: { correct: 0, total: 0 },
  };
}

describe('deriveProgress — fixed-length baseline arc (server-derived)', () => {
  it('starts on the first content item', () => {
    const p = deriveProgress(plan, [started]);
    expect(p.phase).toBe('chat');
    if (p.phase === 'chat') {
      expect(p.item.itemId).toBe('l1-and');
      expect(p.itemIndex).toBe(0);
      expect(p.itemCount).toBe(3);
    }
  });

  it('an incorrect / prose turn does NOT advance the item', () => {
    const log = [started, chatTurn('l1-and', false, false), chatTurn('l1-and', null, false)];
    const p = deriveProgress(plan, log);
    expect(p.phase).toBe('chat');
    if (p.phase === 'chat') expect(p.item.itemId).toBe('l1-and');
    expect(p.score).toEqual({ correct: 0, total: 0 });
  });

  it('a completing turn advances to the next content item and scores it', () => {
    const log = [started, chatTurn('l1-and', true, true)];
    const p = deriveProgress(plan, log);
    expect(p.phase).toBe('chat');
    if (p.phase === 'chat') expect(p.item.itemId).toBe('l1-or');
    expect(p.score).toEqual({ correct: 1, total: 1 });
  });

  it('after all 3 content items, moves to the first transfer item', () => {
    const log = [
      started,
      chatTurn('l1-and', true, true),
      chatTurn('l1-or', true, true),
      chatTurn('l1-not', true, true),
    ];
    const p = deriveProgress(plan, log);
    expect(p.phase).toBe('transfer');
    if (p.phase === 'transfer') {
      expect(p.item.itemId).toBe('t1');
      expect(p.itemCount).toBe(2);
    }
    expect(p.score).toEqual({ correct: 3, total: 3 });
  });

  it('a duplicate completing turn for the same item counts ONCE (no double-count under a race)', () => {
    // Two concurrent chat turns can both observe the item incomplete and both log
    // itemComplete:true. The tally must count one point per DISTINCT completed item.
    const log = [started, chatTurn('l1-and', true, true), chatTurn('l1-and', true, true)];
    const p = deriveProgress(plan, log);
    expect(p.phase).toBe('chat');
    if (p.phase === 'chat') expect(p.item.itemId).toBe('l1-or');
    expect(p.score).toEqual({ correct: 1, total: 1 });
  });

  it('a duplicate transfer submission for the same item counts ONCE', () => {
    const log: BaselineEventPayload[] = [
      started,
      chatTurn('l1-and', true, true),
      chatTurn('l1-or', true, true),
      chatTurn('l1-not', true, true),
      { kind: 'transfer_submitted', app: BASELINE_APP, itemId: 't1', submission: 'NOT (A AND B)', correct: true, score: { correct: 0, total: 0 } },
      { kind: 'transfer_submitted', app: BASELINE_APP, itemId: 't1', submission: 'NOT (A AND B)', correct: true, score: { correct: 0, total: 0 } },
    ];
    const p = deriveProgress(plan, log);
    // Only t1 submitted (twice) → still on t2; t1 contributes a single point.
    expect(p.phase).toBe('transfer');
    if (p.phase === 'transfer') expect(p.item.itemId).toBe('t2');
    expect(p.score).toEqual({ correct: 4, total: 4 });
  });

  it('after both transfer items, the session is ended; tally counts transfer correctness', () => {
    const log: BaselineEventPayload[] = [
      started,
      chatTurn('l1-and', true, true),
      chatTurn('l1-or', true, true),
      chatTurn('l1-not', true, true),
      { kind: 'transfer_submitted', app: BASELINE_APP, itemId: 't1', submission: 'NOT (A AND B)', correct: true, score: { correct: 0, total: 0 } },
      { kind: 'transfer_submitted', app: BASELINE_APP, itemId: 't2', submission: 'wrong', correct: false, score: { correct: 0, total: 0 } },
    ];
    const p = deriveProgress(plan, log);
    expect(p.phase).toBe('ended');
    // 3 content + 1 transfer correct of 5 total scored items.
    expect(p.score).toEqual({ correct: 4, total: 5 });
  });
});
