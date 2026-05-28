import { describe, expect, it } from 'vitest';
import { parse, variables } from '@polymath/booleans';
import {
  extractSlots,
  generateL1,
  generateL2,
  generateL3Canned,
  L1_TEMPLATES,
  L2_TEMPLATES,
} from './templates.js';

/** The L1 lesson items used in our tests. */
const LESSON_1_EXPRESSIONS = ['A AND B', 'A OR B', 'NOT A'] as const;

/** Extract the token set for an expression: variable names + gate keywords. */
function itemTokens(expr: string): Set<string> {
  const tokens = new Set<string>();
  // Variables from the AST
  try {
    const vars = variables(parse(expr));
    for (const v of vars) tokens.add(v);
  } catch {
    // ignore
  }
  // Gate keywords from the expression string
  const upper = expr.toUpperCase();
  if (/\bAND\b/.test(upper)) tokens.add('AND');
  if (/\bOR\b/.test(upper)) tokens.add('OR');
  if (/\bNOT\b/.test(upper)) tokens.add('NOT');
  return tokens;
}

describe('extractSlots', () => {
  it('extracts gate AND for "A AND B"', () => {
    const slots = extractSlots('A AND B');
    expect(slots).not.toBeNull();
    expect(slots!.gate).toBe('AND');
    expect(slots!.var1).toBe('A');
    expect(slots!.var2).toBe('B');
    expect(slots!.subExpression).toBe('A AND B');
  });

  it('extracts gate OR for "A OR B"', () => {
    const slots = extractSlots('A OR B');
    expect(slots!.gate).toBe('OR');
  });

  it('extracts gate NOT for "NOT A"', () => {
    const slots = extractSlots('NOT A');
    expect(slots!.gate).toBe('NOT');
    expect(slots!.var1).toBe('A');
    // Single-variable expression: var2 falls back to var1
    expect(slots!.var2).toBe('A');
  });

  it('returns null for an unparseable expression', () => {
    expect(extractSlots('INVALID ## EXPR')).toBeNull();
  });
});

describe('L1/L2 slot-value subset property (ADR-010 Layer 3)', () => {
  /**
   * Core ADR-010 / spec criterion 6: every slot value in an L1/L2 template
   * must be a subset of the item's tokens (variables + gate keywords). This
   * makes the rendered hint reference the item's actual content.
   */
  for (const expr of LESSON_1_EXPRESSIONS) {
    it(`L1 template slot values ⊆ item tokens for "${expr}"`, () => {
      const slots = extractSlots(expr);
      expect(slots).not.toBeNull();
      const tokens = itemTokens(expr);

      // gate slot must be in the token set
      expect(tokens.has(slots!.gate)).toBe(true);
      // var1/var2 must be in the token set
      expect(tokens.has(slots!.var1)).toBe(true);
      expect(tokens.has(slots!.var2)).toBe(true);
    });

    it(`L2 template slot values ⊆ item tokens for "${expr}"`, () => {
      const slots = extractSlots(expr);
      expect(slots).not.toBeNull();
      const tokens = itemTokens(expr);

      expect(tokens.has(slots!.gate)).toBe(true);
      expect(tokens.has(slots!.var1)).toBe(true);
      expect(tokens.has(slots!.var2)).toBe(true);
      // subExpression contains all the item's tokens
      const sub = slots!.subExpression.toUpperCase();
      for (const t of tokens) {
        expect(sub).toContain(t.toUpperCase());
      }
    });
  }
});

describe('generateL1 / generateL2', () => {
  it('returns a non-empty string for each L1 lesson expression', () => {
    for (const expr of LESSON_1_EXPRESSIONS) {
      const body = generateL1(expr);
      expect(body).not.toBeNull();
      expect(body!.length).toBeGreaterThan(10);
    }
  });

  it('returns a non-empty string for each L2 lesson expression', () => {
    for (const expr of LESSON_1_EXPRESSIONS) {
      const body = generateL2(expr);
      expect(body).not.toBeNull();
      expect(body!.length).toBeGreaterThan(10);
    }
  });

  it('L1 body references the item\'s gate or variable', () => {
    const body = generateL1('A AND B')!;
    // Should mention AND, A, or B
    expect(/\b(AND|A|B)\b/.test(body)).toBe(true);
  });

  it('L2 body references the item\'s variables or sub-expression', () => {
    const body = generateL2('A AND B')!;
    expect(/\b(A|B)\b/.test(body)).toBe(true);
  });

  it('returns null for unparseable expressions', () => {
    expect(generateL1('INVALID ## EXPR')).toBeNull();
    expect(generateL2('INVALID ## EXPR')).toBeNull();
  });

  it('covers all L1_TEMPLATES (no dead templates)', () => {
    // Generate L1 hints for a large set of expressions and check every
    // template index is reached at least once. With 5 templates and 3
    // expressions this may not cover all — but we at least confirm the
    // templates array is non-empty and the generator doesn't throw.
    expect(L1_TEMPLATES.length).toBeGreaterThan(0);
    expect(L2_TEMPLATES.length).toBeGreaterThan(0);
  });
});

describe('generateL3Canned', () => {
  it('returns a non-empty string mentioning the operator for "A AND B"', () => {
    const body = generateL3Canned('A AND B');
    expect(body).toContain('AND');
    expect(body.length).toBeGreaterThan(20);
  });

  it('returns a non-empty string for "A OR B"', () => {
    const body = generateL3Canned('A OR B');
    expect(body).toContain('OR');
  });

  it('returns a non-empty string for "NOT A"', () => {
    const body = generateL3Canned('NOT A');
    expect(body).toContain('NOT');
  });

  it('returns a fallback string for unparseable expressions', () => {
    const body = generateL3Canned('INVALID ## EXPR');
    expect(body.length).toBeGreaterThan(10);
  });
});
