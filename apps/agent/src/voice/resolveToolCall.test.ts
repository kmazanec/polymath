import { describe, expect, it } from 'vitest';
import type { LearnerSnapshot, TransferProbeItem } from '../agent/client.js';
import type { MasteryGateResult } from '../mastery/gate.js';
import { resolveVoiceToolCall, type ResolveVoiceToolCallContext } from './resolveToolCall.js';

// ---------------------------------------------------------------------------
// Fixture builders — minimal valid shapes for each type.
// ---------------------------------------------------------------------------

function learner(overrides: Partial<LearnerSnapshot> = {}): LearnerSnapshot {
  return {
    bktByKc: {},
    hintsUsed: 0,
    consecutiveCorrect: 0,
    ruleGatePassed: false,
    explainBackPassed: false,
    topicGuardrailClean: true,
    ...overrides,
  };
}

function gate(passed: boolean): MasteryGateResult {
  return passed
    ? { passed: true, blockers: [] }
    : { passed: false, blockers: ['rule_gate_failed'] };
}

const PROBE: TransferProbeItem = {
  itemId: 'L1-and-circuit',
  targetExpression: 'A AND B',
  targetRep: 'circuit',
  hiddenReps: ['truth_table'],
};

function ctx(overrides: Partial<ResolveVoiceToolCallContext> = {}): ResolveVoiceToolCallContext {
  return {
    learner: learner(),
    gate: gate(false),
    transferCandidates: undefined,
    ...overrides,
  };
}

/** Minimal valid tool-call args object for a given move. All nullable fields set
 *  to null so MoveSchema passes without extra required fields. */
function baseArgs(move: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    move,
    rationale: `test: ${move}`,
    item: null,
    tier: null,
    altRep: null,
    workedExpression: null,
    workedSteps: null,
    workedVisibleReps: null,
    question: null,
    answer: null,
    topicClassification: null,
    noActionReason: null,
    hintLevel: null,
    hintBody: null,
    probeExpression: null,
    probeTargetRep: null,
    probeHiddenReps: null,
    probeItemId: null,
    scaffold: null,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// AC-5 acceptance criteria (security-critical gate cases)
// ---------------------------------------------------------------------------

describe('resolveVoiceToolCall — gate cases', () => {
  it('answer_question (on_topic) passes through without downgrade', () => {
    const args = baseArgs('answer_question', {
      question: 'What is an AND gate?',
      answer: 'A gate that outputs 1 only when both inputs are 1.',
      topicClassification: 'on_topic',
    });
    const action = resolveVoiceToolCall(args, ctx({ learner: learner(), gate: gate(false) }));
    expect(action.type).toBe('answer_question');
    if (action.type === 'answer_question') {
      expect(action.topicClassification).toBe('on_topic');
    }
  });

  it('propose_transfer_probe with ruleGatePassed:false → no_action (earned-it downgrade)', () => {
    const args = baseArgs('propose_transfer_probe', {
      probeExpression: 'A AND B',
      probeTargetRep: 'circuit',
      probeHiddenReps: ['truth_table'],
      probeItemId: PROBE.itemId,
    });
    const action = resolveVoiceToolCall(
      args,
      ctx({
        learner: learner({ ruleGatePassed: false }),
        gate: gate(false),
        transferCandidates: [PROBE],
      }),
    );
    expect(action.type).toBe('no_action');
    if (action.type === 'no_action') {
      expect(action.reason).toBe('agent_unsure');
      expect(action.rationale).toMatch(/rule gate/i);
    }
  });

  it('propose_transfer_probe with ruleGatePassed:true but no matching transferCandidates → no_action', () => {
    const args = baseArgs('propose_transfer_probe', {
      probeExpression: 'A AND B',
      probeTargetRep: 'circuit',
      probeHiddenReps: ['truth_table'],
      probeItemId: PROBE.itemId,
    });
    // transferCandidates is empty — the probe has no authorized unseen bank row
    const action = resolveVoiceToolCall(
      args,
      ctx({
        learner: learner({ ruleGatePassed: true }),
        gate: gate(false),
        transferCandidates: [],
      }),
    );
    expect(action.type).toBe('no_action');
    if (action.type === 'no_action') {
      expect(action.rationale).toMatch(/bank item/i);
    }
  });

  it('propose_transfer_probe with ruleGatePassed:true and non-matching candidate → no_action', () => {
    // Candidate exists but its fields don't match the proposed probe
    const differentProbe: TransferProbeItem = {
      itemId: 'L1-or-tt',
      targetExpression: 'A OR B',
      targetRep: 'truth_table',
      hiddenReps: [],
    };
    const args = baseArgs('propose_transfer_probe', {
      probeExpression: 'A AND B',   // expression mismatch
      probeTargetRep: 'circuit',
      probeHiddenReps: ['truth_table'],
      probeItemId: PROBE.itemId,
    });
    const action = resolveVoiceToolCall(
      args,
      ctx({
        learner: learner({ ruleGatePassed: true }),
        gate: gate(false),
        transferCandidates: [differentProbe],
      }),
    );
    expect(action.type).toBe('no_action');
  });

  it('propose_mastery_transition with gate.passed:false → no_action', () => {
    const args = baseArgs('propose_mastery_transition');
    const action = resolveVoiceToolCall(
      args,
      ctx({ learner: learner(), gate: gate(false) }),
    );
    expect(action.type).toBe('no_action');
    if (action.type === 'no_action') {
      expect(action.rationale).toMatch(/mastery_gate_failed/);
    }
  });

  it('propose_mastery_transition with gate.passed:true → accepted action (NOT no_action)', () => {
    const args = baseArgs('propose_mastery_transition');
    // The resolver returns the accepted `transition` action; the server reflex that mints
    // the MasteryCelebration (with server-sourced conceptsMastered) is the caller's job —
    // the resolver gates the proposal, it does not perform the celebration mint.
    const action = resolveVoiceToolCall(
      args,
      ctx({
        learner: learner({ ruleGatePassed: true, explainBackPassed: true, topicGuardrailClean: true }),
        gate: { passed: true, blockers: [] },
      }),
    );
    expect(action.type).not.toBe('no_action');
    // The compiled wire action for propose_mastery_transition is a `transition` to mastered.
    expect(action.type).toBe('transition');
    if (action.type === 'transition') {
      expect(action.to).toBe('mastered');
    }
  });

  it('next_practice_item with a wrong claimedTruthTable → no_action (Layer-2 rejection)', () => {
    // 'A AND B' has truth table [0,0,0,1]; we claim [1,1,1,1] — Layer-2 must reject.
    const args = baseArgs('next_practice_item', {
      tier: 1,
      item: {
        rep: 'truth_table',
        targetExpression: 'A AND B',
        claimedTruthTable: [1, 1, 1, 1], // wrong
        visibleReps: ['truth_table'],
        prompt: null,
      },
    });
    const action = resolveVoiceToolCall(args, ctx());
    expect(action.type).toBe('no_action');
    if (action.type === 'no_action') {
      expect(action.rationale).toMatch(/Layer-2/);
    }
  });

  it('next_practice_item with a CORRECT claimedTruthTable passes through', () => {
    const args = baseArgs('next_practice_item', {
      tier: 1,
      item: {
        rep: 'truth_table',
        targetExpression: 'A AND B',
        claimedTruthTable: [0, 0, 0, 1], // correct MSB-first
        visibleReps: ['truth_table'],
        prompt: null,
      },
    });
    const action = resolveVoiceToolCall(args, ctx());
    expect(action.type).toBe('mount');
    if (action.type === 'mount') {
      expect(action.component.kind).toBe('TruthTablePractice');
    }
  });
});
