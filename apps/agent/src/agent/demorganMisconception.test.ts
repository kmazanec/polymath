import { describe, expect, it } from 'vitest';
import { Action } from '@polymath/contract';
import { StubAgentClient } from './stubClient.js';
import type { AgentInput } from './client.js';
import { loadLesson } from '../lessons/loader.js';

/**
 * ADR-012 stretch (Lesson 4): a wrong submit that matches the halfway De Morgan
 * misconception must surface the NAMED hint via the existing propose_hint /
 * HintCard path (no new TacticalMove — D23-1). A correct answer, and a wrong
 * answer that is NOT the halfway form, must NOT trip it (zero false positives).
 */

const lesson = loadLesson(4);
const SID = '00000000-0000-0000-0000-000000000000';

function submitInput(
  itemId: string,
  cells: (0 | 1)[],
  opts: { correct: boolean; rep?: 'truth_table' | 'circuit' },
): AgentInput {
  const rep = opts.rep ?? 'truth_table';
  const event: AgentInput['event'] = {
    kind: 'submit',
    sessionId: SID,
    itemId,
    submission: 'whatever the learner typed',
    correct: opts.correct,
    repSubmission:
      rep === 'truth_table'
        ? { rep: 'truth_table', cells }
        : { rep: 'circuit', expression: '', nodes: [], edges: [] },
  };
  return {
    event,
    lesson,
    learnerState: { bktByKc: {}, hintsUsed: 0, consecutiveCorrect: 0, ruleGatePassed: false },
    recentHistory: [],
    currentSubmitCorrect: opts.correct,
  };
}

describe('halfway De Morgan misconception → named hint (Lesson 4)', () => {
  it('a halfway-form wrong submit yields a HintCard that NAMES the misconception', async () => {
    // l4-nand2-trap: NOT(A AND B). Halfway answer (NOT A) AND (NOT B) → column [1,0,0,0].
    const action = await new StubAgentClient().propose(
      submitInput('l4-nand2-trap', [1, 0, 0, 0], { correct: false }),
    );
    expect(action.type).toBe('mount');
    if (action.type === 'mount') {
      expect(action.component.kind).toBe('HintCard');
      if (action.component.kind === 'HintCard') {
        expect(action.component.level).toBe(1);
        expect(action.component.body.toLowerCase()).toContain('halfway');
        // Names the corrective action: flip the operator (AND→OR).
        expect(action.component.body).toMatch(/AND to OR|operator/i);
      }
    }
    expect(() => Action.parse(action)).not.toThrow();
  });

  it('resolves the item even when the submit names it by targetExpression (web mount)', async () => {
    const action = await new StubAgentClient().propose(
      submitInput('NOT (A AND B)', [1, 0, 0, 0], { correct: false }),
    );
    expect(action.type === 'mount' && action.component.kind === 'HintCard').toBe(true);
  });

  it('a CORRECT answer does NOT trip the misconception hint (zero false positive)', async () => {
    // Correct NOT(A AND B) column is [1,1,1,0].
    const action = await new StubAgentClient().propose(
      submitInput('l4-nand2-trap', [1, 1, 1, 0], { correct: true }),
    );
    // A correct submit advances or probes — never a HintCard.
    expect(action.type === 'mount' && action.component.kind === 'HintCard').toBe(false);
  });

  it('a wrong-but-NOT-halfway answer falls back to the generic rephrase, not the named hint', async () => {
    // An unrelated wrong column for NOT(A AND B): not [1,0,0,0].
    const action = await new StubAgentClient().propose(
      submitInput('l4-nand2-trap', [0, 1, 0, 1], { correct: false }),
    );
    expect(action.type).toBe('mount');
    // Rephrase re-presents the item as a practice rep, not a HintCard.
    expect(action.type === 'mount' && action.component.kind === 'HintCard').toBe(false);
  });

  it('a non-truth-table submission is skipped (no MSB column to compare)', async () => {
    const action = await new StubAgentClient().propose(
      submitInput('l4-nand2-trap', [], { correct: false, rep: 'circuit' }),
    );
    // Falls through to the generic wrong-submit handling, never the named hint.
    expect(action.type === 'mount' && action.component.kind === 'HintCard').toBe(false);
  });

  it('fires for a composite trap too (l4-comp-and-or-trap, 3-var)', async () => {
    // NOT((A AND B) OR C). Halfway: NOT(A AND B) OR NOT C → column [1,1,1,1,1,1,1,0].
    const action = await new StubAgentClient().propose(
      submitInput('l4-comp-and-or-trap', [1, 1, 1, 1, 1, 1, 1, 0], { correct: false }),
    );
    expect(action.type === 'mount' && action.component.kind === 'HintCard').toBe(true);
  });
});
