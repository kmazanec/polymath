import { describe, expect, it } from 'vitest';
import { loadLesson } from '../lessons/loader.js';
import { deriveState, toLearnerState, type LoggedEvent } from './eventConsumer.js';
import { evaluateRuleGate } from './gate.js';

const { content, masteryConfig } = loadLesson(1);

describe('deriveState (the single learner_state writer, pure core)', () => {
  it('updates BKT per KC on each submit, keyed by item expression or id', () => {
    const events: LoggedEvent[] = [
      { kind: 'submit', itemId: 'A AND B', correct: true },
      { kind: 'submit', itemId: 'l1-or', correct: true },
    ];
    const d = deriveState(events, content, masteryConfig);
    expect(d.bktByKc['AND']!.pMastered).toBeGreaterThan(masteryConfig.bktPrior_L0);
    expect(d.bktByKc['OR']!.pMastered).toBeGreaterThan(masteryConfig.bktPrior_L0);
  });

  it('counts consecutive correct, resetting on a wrong submit or a hint', () => {
    const d1 = deriveState(
      [
        { kind: 'submit', itemId: 'l1-and', correct: true },
        { kind: 'submit', itemId: 'l1-and', correct: true },
        { kind: 'submit', itemId: 'l1-and', correct: false },
        { kind: 'submit', itemId: 'l1-and', correct: true },
      ],
      content,
      masteryConfig,
    );
    expect(d1.consecutiveCorrect).toBe(1);

    const d2 = deriveState(
      [
        { kind: 'submit', itemId: 'l1-and', correct: true },
        { kind: 'request_hint', itemId: 'l1-and' },
        { kind: 'submit', itemId: 'l1-and', correct: true },
      ],
      content,
      masteryConfig,
    );
    expect(d2.consecutiveCorrect).toBe(1); // the hint reset the streak
    expect(d2.hintsUsed).toBe(1);
  });

  it('counts retries (a repeated submit on the same item) and a transfer pass', () => {
    const d = deriveState(
      [
        { kind: 'submit', itemId: 'l1-and', correct: false },
        { kind: 'submit', itemId: 'l1-and', correct: true }, // retry
        { kind: 'transfer_submitted', itemId: 'L1-01', transferCorrect: true },
      ],
      content,
      masteryConfig,
    );
    expect(d.retries).toBe(1);
    expect(d.transferPassed).toBe(true);
  });

  it('a clean 3-correct AND streak drives the rule gate to passed', () => {
    const events: LoggedEvent[] = [
      { kind: 'submit', itemId: 'l1-and', correct: true, responseTimeMs: 5000 },
      { kind: 'submit', itemId: 'l1-and', correct: true, responseTimeMs: 6000 },
      { kind: 'submit', itemId: 'l1-and', correct: true, responseTimeMs: 4000 },
    ];
    const ls = toLearnerState(deriveState(events, content, masteryConfig));
    // BKT for AND after 3 correct should exceed 0.95.
    expect(ls.bktByKc['AND']).toBeGreaterThanOrEqual(masteryConfig.bktMasteryThreshold);
    expect(evaluateRuleGate(ls, masteryConfig).passed).toBe(true);
  });

  it('a hinty session is blocked by the hint ratio', () => {
    const events: LoggedEvent[] = [
      { kind: 'submit', itemId: 'l1-and', correct: true, responseTimeMs: 5000 },
      { kind: 'request_hint', itemId: 'l1-and' },
      { kind: 'submit', itemId: 'l1-and', correct: true, responseTimeMs: 6000 },
    ];
    const ls = toLearnerState(deriveState(events, content, masteryConfig));
    const gate = evaluateRuleGate(ls, masteryConfig);
    expect(gate.passed).toBe(false);
    // hintsUsed=1 > 0 AND hintRatio 1/2=0.5 > 0.20 → both blockers present.
    expect(gate.blockers).toContain('hint_ratio_exceeded');
  });
});
