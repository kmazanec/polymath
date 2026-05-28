import { describe, expect, it } from 'vitest';
import { Action, ClientEvent, ComponentSpec } from './index.js';

/**
 * VERIFY-ONLY (F-11 checklist): the F-11 spec's "Contracts touched" list is
 * pre-F-01 and STALE — it claims F-11 must add an `ExplainBackPrompt` ComponentSpec
 * variant, an `explain_back_recording_ended` ClientEvent, and a
 * `propose_explain_back_prompt` Action. F-01 already locked all three (minus the
 * bogus Action variant). This test pins that: F-11 is WIRING over inert contracts,
 * it adds NO new wire/Action/ComponentSpec shapes. If a future change drops or
 * reshapes any of these, this fails loudly.
 */
describe('F-11 verify-only: the inert contracts already exist (no new schema)', () => {
  it('ExplainBackPrompt parses via ComponentSpec', () => {
    const spec = ComponentSpec.parse({
      kind: 'ExplainBackPrompt',
      targetItemId: 'l1-and',
      promptBody: 'In your own words, explain how you solved A AND B.',
      maxDurationSec: 15,
    });
    expect(spec.kind).toBe('ExplainBackPrompt');
  });

  it('explain_back_recording_ended parses via ClientEvent', () => {
    const ev = ClientEvent.parse({
      kind: 'explain_back_recording_ended',
      sessionId: '00000000-0000-4000-8000-000000000000',
      targetItemId: 'l1-and',
      transcript: 'For A AND B the output is true only when both A and B are true.',
      durationMs: 11_000,
    });
    expect(ev.kind).toBe('explain_back_recording_ended');
  });

  it('a mount of ExplainBackPrompt is a valid Action (the reflex reuses `mount`, no new variant)', () => {
    const action = Action.parse({
      type: 'mount',
      component: {
        kind: 'ExplainBackPrompt',
        targetItemId: 'l1-and',
        promptBody: 'Explain how you solved it.',
        maxDurationSec: 15,
      },
      rationale: 'transfer-pass reflex mount',
    });
    expect(action.type).toBe('mount');
  });

  it('there is NO propose_explain_back_prompt Action variant (the stale spec is wrong)', () => {
    const parsed = Action.safeParse({
      type: 'propose_explain_back_prompt',
      targetItemId: 'l1-and',
      rationale: 'should not exist',
    });
    expect(parsed.success).toBe(false);
  });
});
