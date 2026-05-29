import { describe, expect, it, vi } from 'vitest';
import { HandoffArtifactSchema } from '@polymath/contract';
import { buildHandoffArtifact, type HandoffArtifactDeps } from './buildArtifact.js';

const SESSION = '11111111-1111-1111-1111-111111111111';

/**
 * `buildHandoffArtifact` is the sole coupling point to the session-summary source.
 * It composes a contract-valid `HandoffArtifact` from the per-KC learner state
 * (mastered vs stuck, split at the lesson's BKT threshold) + the questions node.
 * It returns `null` for an unknown/empty session and never throws.
 */
function depsWith(
  rows: { kc: string; bktProbability: number | null }[],
  opts: { sessionExists?: boolean } = {},
): HandoffArtifactDeps {
  return {
    sessionExists: vi.fn(async () => opts.sessionExists ?? true),
    readLearnerKcs: vi.fn(async () => rows),
    masteryThreshold: vi.fn(async () => 0.95),
    generateQuestions: vi.fn(async ({ stuckKcs }) =>
      // A simple deterministic double honoring the 3..5 contract bound.
      (stuckKcs.length > 0 ? stuckKcs : ['general']).slice(0, 5).concat(
        ['x', 'y', 'z'],
      ).slice(0, Math.max(3, Math.min(5, Math.max(stuckKcs.length, 3)))).map((kc) => ({
        kc,
        question: `Ask about ${kc}?`,
      })),
    ),
  };
}

describe('buildHandoffArtifact', () => {
  it('returns null for an unknown session', async () => {
    const deps = depsWith([], { sessionExists: false });
    const art = await buildHandoffArtifact(deps, SESSION);
    expect(art).toBeNull();
    expect(deps.readLearnerKcs).not.toHaveBeenCalled();
  });

  it('returns null when the session has no learner-state rows (empty session)', async () => {
    const deps = depsWith([]);
    const art = await buildHandoffArtifact(deps, SESSION);
    expect(art).toBeNull();
  });

  it('splits KCs into mastered (>= threshold) and stuck (< threshold / null)', async () => {
    const deps = depsWith([
      { kc: 'AND', bktProbability: 0.97 },
      { kc: 'OR', bktProbability: 0.4 },
      { kc: 'NOT', bktProbability: null },
    ]);
    const art = await buildHandoffArtifact(deps, SESSION);
    expect(art).not.toBeNull();
    expect(art!.masteredKcs).toEqual(['AND']);
    expect(art!.stuckKcs.sort()).toEqual(['NOT', 'OR']);
  });

  it('produces a contract-valid artifact (3-5 questions, uuid, all fields)', async () => {
    const deps = depsWith([
      { kc: 'AND', bktProbability: 0.99 },
      { kc: 'OR', bktProbability: 0.2 },
    ]);
    const art = await buildHandoffArtifact(deps, SESSION);
    expect(HandoffArtifactSchema.safeParse(art).success).toBe(true);
    expect(art!.sessionId).toBe(SESSION);
  });

  it('orders the fields intro -> mastered -> stuck -> questions -> footer (AC#2)', async () => {
    const deps = depsWith([
      { kc: 'AND', bktProbability: 0.99 },
      { kc: 'OR', bktProbability: 0.2 },
    ]);
    const art = await buildHandoffArtifact(deps, SESSION);
    const keys = Object.keys(art!);
    const order = (k: string) => keys.indexOf(k);
    expect(order('warmIntro')).toBeGreaterThanOrEqual(0);
    expect(order('warmIntro')).toBeLessThan(order('masteredKcs'));
    expect(order('masteredKcs')).toBeLessThan(order('stuckKcs'));
    expect(order('stuckKcs')).toBeLessThan(order('tutorQuestions'));
    expect(order('tutorQuestions')).toBeLessThan(order('nerdyFooter'));
  });

  it('uses warm + Nerdy-aligned framing, never "I failed" (AC#5)', async () => {
    const deps = depsWith([
      { kc: 'AND', bktProbability: 0.99 },
      { kc: 'OR', bktProbability: 0.2 },
    ]);
    const art = await buildHandoffArtifact(deps, SESSION);
    expect(art!.warmIntro.toLowerCase()).toContain('taken you as far');
    expect(art!.warmIntro.toLowerCase()).not.toContain('failed');
    expect(art!.nerdyFooter.toLowerCase()).not.toContain('failed');
    // Footer carries the Nerdy human-tutor framing.
    expect(art!.nerdyFooter.toLowerCase()).toContain('tutor');
  });

  it('passes mastered+stuck KCs to the questions node', async () => {
    const deps = depsWith([
      { kc: 'AND', bktProbability: 0.99 },
      { kc: 'OR', bktProbability: 0.2 },
    ]);
    await buildHandoffArtifact(deps, SESSION);
    expect(deps.generateQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ stuckKcs: ['OR'], masteredKcs: ['AND'] }),
    );
  });
});
