import { describe, expect, it } from 'vitest';
import type { Action } from '@polymath/contract';
import { repairVisibleReps, validateOutboundAction } from './validateAction.js';

/**
 * B12: an item-bearing practice mount must always be renderable — its `visibleReps`
 * must include its OWN rep, or every rep component renders null → a blank, dead-end
 * workspace. The contract permits `visibleReps: []` (no `.min(1)`), so the outbound
 * boundary REPAIRS the LLM's Zod-valid-but-unrenderable proposal.
 */
describe('B12 visibleReps repair at the outbound boundary', () => {
  it('repairs an LLM TruthTablePractice with empty visibleReps to include its own rep', () => {
    // The exact dead-end the learner hit: A OR NOT B with visibleReps: [].
    const proposal = {
      type: 'mount',
      component: {
        kind: 'TruthTablePractice',
        expression: 'A OR NOT B',
        claimedTruthTable: [1, 0, 1, 1],
        visibleReps: [],
        prompt: 'Fill in the truth table for A OR NOT B.',
      },
      rationale: 'continued practice (LLM)',
    };

    const { action, downgraded } = validateOutboundAction(proposal);
    expect(downgraded).toBe(false); // repaired, NOT downgraded to no_action
    expect(action.type).toBe('mount');
    if (action.type === 'mount' && action.component.kind === 'TruthTablePractice') {
      expect(action.component.visibleReps).toContain('truth_table');
      expect(action.component.visibleReps.length).toBeGreaterThan(0);
      // claimedTruthTable untouched (never fabricated/altered).
      expect(action.component.claimedTruthTable).toEqual([1, 0, 1, 1]);
      expect(action.component.expression).toBe('A OR NOT B');
    }
  });

  it('injects the own rep while preserving any other reps the agent intended', () => {
    const proposal: Action = {
      type: 'mount',
      component: {
        kind: 'CircuitBuilder',
        targetExpression: 'A AND B',
        claimedTruthTable: [0, 0, 0, 1],
        allowedGates: ['AND', 'OR', 'NOT'],
        // missing its own 'circuit' rep but shows pseudocode alongside.
        visibleReps: ['pseudocode'],
        prompt: 'Build the circuit.',
      },
      rationale: 'practice',
    };

    const repaired = repairVisibleReps(proposal);
    expect(repaired.type).toBe('mount');
    if (repaired.type === 'mount' && repaired.component.kind === 'CircuitBuilder') {
      expect(repaired.component.visibleReps).toContain('circuit'); // own rep injected
      expect(repaired.component.visibleReps).toContain('pseudocode'); // preserved
    }
  });

  it('repairs PseudocodeChallenge missing its own rep', () => {
    const repaired = repairVisibleReps({
      type: 'mount',
      component: {
        kind: 'PseudocodeChallenge',
        targetExpression: 'NOT A',
        claimedTruthTable: [1, 0],
        visibleReps: [],
        prompt: 'Write the expression.',
      },
      rationale: 'practice',
    });
    if (repaired.type === 'mount' && repaired.component.kind === 'PseudocodeChallenge') {
      expect(repaired.component.visibleReps).toEqual(['pseudocode']);
    }
  });

  it('leaves a correct visibleReps untouched (idempotent — no duplicate own rep)', () => {
    const good: Action = {
      type: 'mount',
      component: {
        kind: 'TruthTablePractice',
        expression: 'A AND B',
        claimedTruthTable: [0, 0, 0, 1],
        visibleReps: ['truth_table'],
        prompt: 'Fill it in.',
      },
      rationale: 'practice',
    };
    const repaired = repairVisibleReps(good);
    expect(repaired).toBe(good); // same reference — no change
    if (repaired.type === 'mount' && repaired.component.kind === 'TruthTablePractice') {
      expect(repaired.component.visibleReps).toEqual(['truth_table']); // not doubled
    }
  });

  it('does NOT force a held-out rep onto a TransferProbe (probe-integrity preserved)', () => {
    // A transfer probe intentionally hides the probed rep; repair must not touch it.
    const probe: Action = {
      type: 'mount',
      component: {
        kind: 'TransferProbe',
        itemId: 't-mix-1',
        expression: 'A AND NOT B',
        targetRep: 'pseudocode',
        hiddenReps: ['truth_table', 'circuit'],
        prompt: 'Transfer probe.',
      },
      rationale: 'transfer probe',
    };
    const repaired = repairVisibleReps(probe);
    expect(repaired).toBe(probe); // untouched — TransferProbe has no visibleReps to repair
    expect(repaired.type === 'mount' && repaired.component.kind === 'TransferProbe').toBe(true);
  });

  it('passes non-item-bearing mounts and non-mount actions through unchanged', () => {
    const hint: Action = {
      type: 'mount',
      component: { kind: 'HintCard', level: 1, body: 'Think row by row.' },
      rationale: 'hint',
    };
    expect(repairVisibleReps(hint)).toBe(hint);

    const noAction: Action = { type: 'no_action', reason: 'thinking', rationale: 'deferring' };
    expect(repairVisibleReps(noAction)).toBe(noAction);
  });
});
