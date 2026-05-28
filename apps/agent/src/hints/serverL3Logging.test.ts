import { describe, expect, it } from 'vitest';
import type { Action } from '@polymath/contract';

/**
 * LOGIC-UNIT TEST (criterion 7). This exercises the validation-layer *decision
 * rule* that handleClientFrame applies before writing the events row — it
 * deliberately re-implements that small rule here so it runs with NO Postgres
 * and NO WebSocket (the agent integration test needs a DB and is skipped when
 * one isn't reachable). The real-path coverage — that handleClientFrame actually
 * writes this `validation` object into the `events` table — lives in
 * server.integration.test.ts, which drives the real server against a live DB.
 * Keeping a fast offline check here means the rule can't silently rot when the
 * DB-backed suite is skipped locally; the copy below must stay in sync with
 * server.ts's isL3Hint / validationLayer / validationStatus block.
 *
 * The production code in handleClientFrame sets:
 *   - layer: 3, status: 'unverified_prose'  for a HintCard level-3 mount
 *   - layer: 2, status: 'pass'              for other item mounts that pass L2
 *   - layer: 1, status: 'pass'              for non-mount actions
 */

/** Mirror of the server's validation-layer determination logic (see the header
 *  comment for why this is a copy, not a call into server.ts). */
function determineValidation(
  shaped: Action,
  layer2Ok: boolean,
  downgraded: boolean,
): { layer: number; status: string; detail: string } {
  const isL3Hint =
    shaped.type === 'mount' &&
    shaped.component.kind === 'HintCard' &&
    shaped.component.level === 3;
  const validationLayer = isL3Hint ? 3 : shaped.type === 'mount' ? 2 : 1;
  const validationStatus = isL3Hint
    ? 'unverified_prose'
    : layer2Ok
      ? 'pass'
      : 'reject';
  return {
    layer: validationLayer,
    status: validationStatus,
    detail: layer2Ok ? (downgraded ? 'downgraded malformed proposal' : 'ok') : 'layer2 rejected',
  };
}

describe('server L3 hint validation logging (criterion 7)', () => {
  it('L3 HintCard mount → layer 3, status unverified_prose', () => {
    const action: Action = {
      type: 'mount',
      component: { kind: 'HintCard', level: 3, body: 'deep prose hint' },
      rationale: 'r',
    };
    const v = determineValidation(action, true, false);
    expect(v.layer).toBe(3);
    expect(v.status).toBe('unverified_prose');
  });

  it('L1 HintCard mount → layer 2 (same as any non-item mount), status pass', () => {
    const action: Action = {
      type: 'mount',
      component: { kind: 'HintCard', level: 1, body: 'light hint' },
      rationale: 'r',
    };
    const v = determineValidation(action, true, false);
    expect(v.layer).toBe(2);
    expect(v.status).toBe('pass');
  });

  it('L2 HintCard mount → layer 2, status pass', () => {
    const action: Action = {
      type: 'mount',
      component: { kind: 'HintCard', level: 2, body: 'medium hint' },
      rationale: 'r',
    };
    const v = determineValidation(action, true, false);
    expect(v.layer).toBe(2);
    expect(v.status).toBe('pass');
  });

  it('practice item mount → layer 2, status pass when L2 ok', () => {
    const action: Action = {
      type: 'mount',
      component: {
        kind: 'TruthTablePractice',
        expression: 'A AND B',
        claimedTruthTable: [0, 0, 0, 1],
        visibleReps: ['truth_table'],
      },
      rationale: 'r',
    };
    const v = determineValidation(action, true, false);
    expect(v.layer).toBe(2);
    expect(v.status).toBe('pass');
  });

  it('practice item mount → layer 2, status reject when L2 fails', () => {
    const action: Action = {
      type: 'mount',
      component: {
        kind: 'TruthTablePractice',
        expression: 'A AND B',
        claimedTruthTable: [0, 0, 0, 1],
        visibleReps: ['truth_table'],
      },
      rationale: 'r',
    };
    const v = determineValidation(action, false, false);
    expect(v.layer).toBe(2);
    expect(v.status).toBe('reject');
  });

  it('no_action → layer 1, status pass', () => {
    const action: Action = { type: 'no_action', reason: 'thinking', rationale: 'r' };
    const v = determineValidation(action, true, false);
    expect(v.layer).toBe(1);
    expect(v.status).toBe('pass');
  });
});
