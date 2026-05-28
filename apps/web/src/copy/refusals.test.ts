import { describe, expect, it } from 'vitest';
import { transferRepRefusal, MID_ITEM_REFUSAL, MASTERY_WITHOUT_CONDITIONS_REFUSAL } from './refusals.js';

describe('refusal copy (ADR-005)', () => {
  it('the transfer-probe refusal names the hidden rep and is warm, not adversarial', () => {
    const tt = transferRepRefusal('truth_table');
    expect(tt).toContain('truth table');
    expect(tt).toMatch(/review it together|right after/i);
    expect(transferRepRefusal('circuit')).toContain('circuit');
    expect(transferRepRefusal('pseudocode')).toContain('pseudocode');
  });

  it('exposes the mid-item and mastery refusals in one place (F-12 reuses the latter)', () => {
    expect(MID_ITEM_REFUSAL).toMatch(/submit|skip|hint/i);
    expect(MASTERY_WITHOUT_CONDITIONS_REFUSAL).toMatch(/transfer|explain-back/i);
  });
});
