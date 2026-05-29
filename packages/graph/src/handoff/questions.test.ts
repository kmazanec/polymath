import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateTutorQuestions } from './questions.js';

/**
 * The tutor-questions node turns a session's stuck/mastered KCs into 3–5 concrete
 * questions a learner brings to a human tutor. Deterministic templates are ALWAYS
 * on (so the offline MR pipeline exercises the whole behaviour); an LLM rephrase is
 * optional behind a key and fail-soft to the templates.
 */
describe('generateTutorQuestions', () => {
  const savedKey = process.env['OPENAI_API_KEY'];
  beforeEach(() => {
    // The unit tests assert the deterministic template path — no key, no network.
    delete process.env['OPENAI_API_KEY'];
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env['OPENAI_API_KEY'];
    else process.env['OPENAI_API_KEY'] = savedKey;
    vi.restoreAllMocks();
  });

  it('produces 3–5 questions for a handful of stuck KCs (one per stuck KC, clamped)', async () => {
    const qs = await generateTutorQuestions({ stuckKcs: ['OR', 'NOT'], masteredKcs: ['AND'] });
    expect(qs.length).toBeGreaterThanOrEqual(3);
    expect(qs.length).toBeLessThanOrEqual(5);
    // Every stuck KC is represented by at least one question keyed to it.
    expect(qs.some((q) => q.kc === 'OR')).toBe(true);
    expect(qs.some((q) => q.kc === 'NOT')).toBe(true);
    for (const q of qs) expect(q.question.length).toBeGreaterThan(0);
  });

  it('clamps to at most 5 questions when many KCs are stuck', async () => {
    const qs = await generateTutorQuestions({
      stuckKcs: ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR'],
      masteredKcs: [],
    });
    expect(qs.length).toBeLessThanOrEqual(5);
    expect(qs.length).toBeGreaterThanOrEqual(3);
  });

  it('produces 3–5 enrichment questions when nothing is stuck (never "I failed")', async () => {
    const qs = await generateTutorQuestions({ stuckKcs: [], masteredKcs: ['AND', 'OR', 'NOT'] });
    expect(qs.length).toBeGreaterThanOrEqual(3);
    expect(qs.length).toBeLessThanOrEqual(5);
    const joined = qs.map((q) => q.question.toLowerCase()).join(' ');
    expect(joined).not.toContain('failed');
    expect(joined).not.toContain('i failed');
  });

  it('produces 3–5 questions when both lists are empty (degraded but warm)', async () => {
    const qs = await generateTutorQuestions({ stuckKcs: [], masteredKcs: [] });
    expect(qs.length).toBeGreaterThanOrEqual(3);
    expect(qs.length).toBeLessThanOrEqual(5);
  });

  it('falls back to templates when the LLM rephrase throws (never throws, never empty)', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    const rephrase = vi.fn().mockRejectedValue(new Error('llm down'));
    const qs = await generateTutorQuestions(
      { stuckKcs: ['OR'], masteredKcs: ['AND'] },
      { rephrase },
    );
    expect(qs.length).toBeGreaterThanOrEqual(3);
    expect(qs.length).toBeLessThanOrEqual(5);
    expect(rephrase).toHaveBeenCalled();
    // The template content survived the failure.
    expect(qs.some((q) => q.kc === 'OR')).toBe(true);
  });

  it('uses the LLM rephrase when it succeeds but keeps the KC keys + count', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    const rephrase = vi
      .fn()
      .mockImplementation(async (templates: { kc: string; question: string }[]) =>
        templates.map((t) => ({ kc: t.kc, question: `Rephrased: ${t.question}` })),
      );
    const qs = await generateTutorQuestions(
      { stuckKcs: ['OR', 'NOT'], masteredKcs: ['AND'] },
      { rephrase },
    );
    expect(qs.length).toBeGreaterThanOrEqual(3);
    expect(qs.length).toBeLessThanOrEqual(5);
    expect(qs.every((q) => q.question.startsWith('Rephrased:'))).toBe(true);
  });

  it('discards a malformed LLM rephrase (wrong count/blank) and keeps templates', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    // Returns a single blank question — invalid against the contract min(3) + min(1).
    const rephrase = vi.fn().mockResolvedValue([{ kc: 'OR', question: '' }]);
    const qs = await generateTutorQuestions(
      { stuckKcs: ['OR', 'NOT'], masteredKcs: ['AND'] },
      { rephrase },
    );
    expect(qs.length).toBeGreaterThanOrEqual(3);
    for (const q of qs) expect(q.question.length).toBeGreaterThan(0);
  });
});
