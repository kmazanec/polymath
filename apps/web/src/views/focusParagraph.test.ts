/**
 * Unit tests for buildNextSessionFocus — pure, deterministic, no LLM.
 * Acceptance criteria:
 *   AC#4 — deterministic focus paragraph from stuck KCs
 */
import { describe, it, expect } from 'vitest';
import { buildNextSessionFocus } from './focusParagraph.js';

describe('buildNextSessionFocus', () => {
  it('names stuck KCs when present', () => {
    const result = buildNextSessionFocus(['NOT', 'NAND']);
    expect(result).toContain('NOT');
    expect(result).toContain('NAND');
    // Should recommend focused practice
    expect(result.length).toBeGreaterThan(20);
  });

  it('names a single stuck KC', () => {
    const result = buildNextSessionFocus(['OR']);
    expect(result).toContain('OR');
    expect(result.length).toBeGreaterThan(20);
  });

  it('returns a "ready to advance" message when no stuck KCs', () => {
    const result = buildNextSessionFocus([]);
    expect(result).toMatch(/advance|ready|mastered|all/i);
    expect(result.length).toBeGreaterThan(20);
  });

  it('is deterministic: same input → same output', () => {
    const a = buildNextSessionFocus(['AND', 'OR']);
    const b = buildNextSessionFocus(['AND', 'OR']);
    expect(a).toBe(b);
  });

  it('handles many stuck KCs gracefully', () => {
    const result = buildNextSessionFocus(['NOT', 'AND', 'OR', 'NAND', 'NOR']);
    expect(result.length).toBeGreaterThan(20);
    expect(result).not.toMatch(/undefined|null/i);
  });
});
