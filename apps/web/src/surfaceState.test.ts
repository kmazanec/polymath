/**
 * surfaceState — applyMount dedupe (B4/B6).
 *
 * The server can re-emit the SAME spec across a phase transition (the
 * WorkedExample is sent twice across introducing→practicing) and a retry
 * re-mounts the SAME practice item. Without dedupe, each re-anchor pushes
 * another byte-identical transcript turn, so the learner sees the same
 * "Walk-through (A & B)" card stacked twice (B4) or two "Completed: B AND A"
 * entries for one item (B6). These tests pin the dedupe: consecutive identical
 * re-anchors collapse to ONE transcript turn, while genuinely DIFFERENT ones
 * both appear.
 */

import { describe, expect, it } from 'vitest';
import type { ComponentSpec } from '@polymath/contract';
import { applyMount, appendVerdict, type SurfaceState } from './surfaceState.js';

const WE_AND: ComponentSpec = {
  kind: 'WorkedExample',
  expression: 'A AND B',
  steps: [{ label: 'Walk-through (A & B)', detail: 'Both inputs must be 1.' }],
  visibleReps: ['truth_table'],
};

const WE_OR: ComponentSpec = {
  kind: 'WorkedExample',
  expression: 'A OR B',
  steps: [{ label: 'Walk-through (A | B)', detail: 'Either input can be 1.' }],
  visibleReps: ['truth_table'],
};

const TT_BANDA: ComponentSpec = {
  kind: 'TruthTablePractice',
  expression: 'B AND A',
  claimedTruthTable: [0, 0, 0, 1],
  visibleReps: ['truth_table'],
  prompt: 'Fill in the truth table for B AND A.',
};

const TT_OTHER: ComponentSpec = {
  kind: 'TruthTablePractice',
  expression: 'A OR B',
  claimedTruthTable: [0, 1, 1, 1],
  visibleReps: ['truth_table'],
  prompt: 'Fill in the truth table for A OR B.',
};

function freshSurface(mounted: ComponentSpec): SurfaceState {
  return { mounted, mountSeq: 0, transcript: [] };
}

describe('applyMount dedupe (B4 — duplicate worked-example)', () => {
  it('two consecutive IDENTICAL WorkedExample mounts produce ONE transcript turn', () => {
    // Start with the worked example mounted (as the server's first WE mount left it).
    let s = freshSurface(WE_AND);
    // Server re-emits the SAME worked example (the double-emit across the transition).
    s = applyMount(s, WE_AND);
    // Then a practice item arrives (re-anchors, pushing the prior WE).
    s = applyMount(s, TT_BANDA);

    const workedTurns = s.transcript.filter((t) => t.kind === 'workedExample');
    expect(workedTurns).toHaveLength(1);
    expect(s.mounted).toBe(TT_BANDA);
  });

  it('two DIFFERENT WorkedExamples both appear in the transcript', () => {
    let s = freshSurface(WE_AND);
    s = applyMount(s, WE_OR); // different worked example → prior WE_AND logged
    s = applyMount(s, TT_BANDA); // prior WE_OR logged

    const workedTurns = s.transcript.filter((t) => t.kind === 'workedExample');
    expect(workedTurns).toHaveLength(2);
  });
});

describe('applyMount dedupe (B6 — retry re-mounting the same item)', () => {
  it('a retry re-mounting the SAME item yields at most ONE "Completed" turn', () => {
    let s = freshSurface(TT_BANDA);
    // Wrong-then-right retry: the server re-mounts the SAME item.
    s = applyMount(s, TT_BANDA);
    // Then the next, different item arrives.
    s = applyMount(s, TT_OTHER);

    const completed = s.transcript.filter((t) => t.kind === 'completedItem');
    expect(completed).toHaveLength(1);
    expect(s.mounted).toBe(TT_OTHER);
  });

  it('two genuinely DIFFERENT completed items both log', () => {
    let s = freshSurface(TT_BANDA);
    s = applyMount(s, TT_OTHER); // prior TT_BANDA → completedItem
    s = applyMount(s, WE_AND); // prior TT_OTHER → completedItem

    const completed = s.transcript.filter((t) => t.kind === 'completedItem');
    expect(completed).toHaveLength(2);
  });
});

describe('completedItem.solved (BUG-03 — wrong-then-superseded item not "Completed")', () => {
  it('a CORRECT last verdict marks the completed item solved=true', () => {
    let s = freshSurface(TT_BANDA);
    s = appendVerdict(s, true, 'B AND A'); // learner got it right
    s = applyMount(s, TT_OTHER); // prior TT_BANDA superseded → completedItem

    const completed = s.transcript.filter((t) => t.kind === 'completedItem');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ kind: 'completedItem', solved: true });
  });

  it('a WRONG last verdict marks the superseded item solved=false (rendered "Reviewed", not "Completed")', () => {
    let s = freshSurface(TT_BANDA);
    s = appendVerdict(s, false, 'B AND A'); // learner got it wrong
    // The tutor moves the learner on to a DIFFERENT item (or remediates with a
    // fresh, non-identical retry) — the wrong item is superseded.
    s = applyMount(s, TT_OTHER);

    const completed = s.transcript.filter((t) => t.kind === 'completedItem');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ kind: 'completedItem', solved: false });
  });

  it('the LAST verdict wins: wrong then right → solved=true', () => {
    let s = freshSurface(TT_BANDA);
    s = appendVerdict(s, false, 'B AND A'); // first attempt wrong
    s = appendVerdict(s, true, 'B AND A'); // retry correct
    s = applyMount(s, TT_OTHER);

    const completed = s.transcript.filter((t) => t.kind === 'completedItem');
    expect(completed[0]).toMatchObject({ kind: 'completedItem', solved: true });
  });

  it('no verdict recorded → solved is undefined (neutral, not a success claim)', () => {
    let s = freshSurface(TT_BANDA);
    s = applyMount(s, TT_OTHER); // superseded with no verdict ever submitted

    const completed = s.transcript.filter((t) => t.kind === 'completedItem');
    expect(completed[0]).toMatchObject({ kind: 'completedItem' });
    expect((completed[0] as { solved?: boolean }).solved).toBeUndefined();
  });
});
