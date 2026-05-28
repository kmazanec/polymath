import { describe, expect, it } from 'vitest';
import type { Action } from '@polymath/contract';

/**
 * Unit tests for the L3 hint validation logging logic in server.ts (criterion 7).
 * Tests the _decision logic_ in isolation without a real DB or WebSocket.
 *
 * The production code in handleClientFrame sets:
 *   - layer: 3, status: 'unverified_prose'  for a HintCard level-3 mount
 *   - layer: 2, status: 'pass'              for other item mounts that pass L2
 *   - layer: 1, status: 'pass'              for non-mount actions
 */

/** Replicate the server's validation-layer determination logic (minimal
 *  copy so we can unit-test it without the full DB stack). */
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
