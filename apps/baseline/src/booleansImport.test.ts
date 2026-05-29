import { describe, expect, it } from 'vitest';
import { equivalent, scoreEquivalence } from '@polymath/booleans';

/**
 * Cross-package import sanity (F-16 testing requirement): `@polymath/booleans` —
 * the SAME validator Polymath uses — is reachable from apps/baseline, so the
 * baseline shares Polymath's correctness path (ADR-011 fairness). The server scores
 * learner input, but the workspace wiring (and the shared truth-maker) must resolve
 * from this app.
 */
describe('@polymath/booleans is importable from apps/baseline', () => {
  it('equivalent + scoreEquivalence resolve and behave', () => {
    expect(equivalent('A AND B', 'B AND A')).toBe(true);
    expect(scoreEquivalence('A AND B', 'A AND B')).toBe(true);
    expect(scoreEquivalence('not an expression', 'A AND B')).toBe(false);
  });
});
