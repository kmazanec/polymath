import { describe, expect, it, vi } from 'vitest';
import { HandoffArtifactSchema, type SessionSummary } from '@polymath/contract';
import { buildHandoffArtifact, type HandoffArtifactDeps } from './buildArtifact.js';

const SESSION = '11111111-1111-1111-1111-111111111111';

/** A contract-valid F-18 SessionSummary stub (the reconcile: the artifact embeds the
 *  real summary, not the old 3-field placeholder). `kcsMastered`/`kcsStuck` are filled
 *  per-test to match the learner rows so the agreement assertion holds. */
function summaryStub(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    preTestScore: null,
    postTestScore: null,
    growthMultiplier: null,
    timeOnTaskMs: 0,
    transferSuccessRate: 0,
    masteryStatus: 'practicing',
    explainBackVerdict: { passed: false, reasons: [] },
    kcsMastered: [],
    kcsStuck: [],
    source: 'in_session',
    ...over,
  };
}

/**
 * `buildHandoffArtifact` is the sole coupling point to the session-summary source.
 * It composes a contract-valid `HandoffArtifact` from the per-KC learner state
 * (mastered vs stuck, split at the lesson's BKT threshold) + the questions node.
 * It returns `null` for an unknown/empty session and never throws.
 */
function depsWith(
  rows: { kc: string; bktProbability: number | null }[],
  opts: { sessionExists?: boolean; summary?: SessionSummary | null } = {},
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
    getSessionSummary: vi.fn(async () =>
      opts.summary === undefined ? summaryStub() : opts.summary,
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

  it('embeds F-18\'s real SessionSummary as the summary field (F-24↔F-18 reconcile)', async () => {
    const summary = summaryStub({
      preTestScore: 0.25,
      postTestScore: 0.75,
      growthMultiplier: 3,
      masteryStatus: 'mastered',
      kcsMastered: ['AND'],
      kcsStuck: ['OR'],
      source: 'experiment',
    });
    const deps = depsWith(
      [
        { kc: 'AND', bktProbability: 0.99 },
        { kc: 'OR', bktProbability: 0.2 },
      ],
      { summary },
    );
    const art = await buildHandoffArtifact(deps, SESSION);
    expect(HandoffArtifactSchema.safeParse(art).success).toBe(true);
    // The summary is the REAL pipeline output, not the old 3-field placeholder.
    expect(art!.summary).toEqual(summary);
    expect(art!.summary.growthMultiplier).toBe(3);
    expect(art!.summary.masteryStatus).toBe('mastered');
    // Top-level lists agree with the summary's (same learner_state source).
    expect(art!.masteredKcs).toEqual(art!.summary.kcsMastered);
    expect(art!.stuckKcs).toEqual(art!.summary.kcsStuck);
  });

  it('returns null (fail-closed) when the summary pipeline yields none', async () => {
    // A session with learner state but no resolvable summary must not emit a
    // contract-invalid partial — it fails closed to no-artifact.
    const deps = depsWith([{ kc: 'AND', bktProbability: 0.99 }], { summary: null });
    const art = await buildHandoffArtifact(deps, SESSION);
    expect(art).toBeNull();
  });
});
