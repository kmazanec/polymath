import { describe, expect, it } from 'vitest';
import {
  parse,
  evaluate,
  truthTable,
  equivalent,
  variables,
  parsePseudocode,
  astToExpression,
  BooleanParseError,
  type Ast,
} from './index.js';

describe('parse', () => {
  it('parses a single variable', () => {
    expect(parse('A')).toEqual({ kind: 'var', name: 'A' });
  });

  it('uppercases variable names (canonical form)', () => {
    expect(parse('a')).toEqual({ kind: 'var', name: 'A' });
  });

  it('parses NOT', () => {
    expect(parse('NOT A')).toEqual({
      kind: 'not',
      operand: { kind: 'var', name: 'A' },
    });
  });

  it('parses AND', () => {
    expect(parse('A AND B')).toEqual({
      kind: 'and',
      left: { kind: 'var', name: 'A' },
      right: { kind: 'var', name: 'B' },
    });
  });

  it('parses OR', () => {
    expect(parse('A OR B')).toEqual({
      kind: 'or',
      left: { kind: 'var', name: 'A' },
      right: { kind: 'var', name: 'B' },
    });
  });

  it('accepts lowercase operators', () => {
    expect(parse('a and b')).toEqual(parse('A AND B'));
  });

  it('binds NOT tighter than AND', () => {
    // NOT A AND B === (NOT A) AND B
    expect(parse('NOT A AND B')).toEqual({
      kind: 'and',
      left: { kind: 'not', operand: { kind: 'var', name: 'A' } },
      right: { kind: 'var', name: 'B' },
    });
  });

  it('binds AND tighter than OR', () => {
    // A OR B AND C === A OR (B AND C)
    expect(parse('A OR B AND C')).toEqual({
      kind: 'or',
      left: { kind: 'var', name: 'A' },
      right: {
        kind: 'and',
        left: { kind: 'var', name: 'B' },
        right: { kind: 'var', name: 'C' },
      },
    });
  });

  it('left-associates AND', () => {
    // A AND B AND C === (A AND B) AND C
    expect(parse('A AND B AND C')).toEqual({
      kind: 'and',
      left: {
        kind: 'and',
        left: { kind: 'var', name: 'A' },
        right: { kind: 'var', name: 'B' },
      },
      right: { kind: 'var', name: 'C' },
    });
  });

  it('left-associates OR', () => {
    expect(parse('A OR B OR C')).toEqual({
      kind: 'or',
      left: {
        kind: 'or',
        left: { kind: 'var', name: 'A' },
        right: { kind: 'var', name: 'B' },
      },
      right: { kind: 'var', name: 'C' },
    });
  });

  it('respects parentheses overriding precedence', () => {
    // (A OR B) AND C
    expect(parse('(A OR B) AND C')).toEqual({
      kind: 'and',
      left: {
        kind: 'or',
        left: { kind: 'var', name: 'A' },
        right: { kind: 'var', name: 'B' },
      },
      right: { kind: 'var', name: 'C' },
    });
  });

  it('parses stacked NOT', () => {
    expect(parse('NOT NOT A')).toEqual({
      kind: 'not',
      operand: { kind: 'not', operand: { kind: 'var', name: 'A' } },
    });
  });

  it('ignores surrounding whitespace', () => {
    expect(parse('  A AND B  ')).toEqual(parse('A AND B'));
  });

  it('throws on empty input', () => {
    expect(() => parse('')).toThrow(BooleanParseError);
    expect(() => parse('   ')).toThrow(BooleanParseError);
  });

  it('throws on a dangling operator', () => {
    expect(() => parse('A AND')).toThrow(BooleanParseError);
  });

  it('throws on a missing operand for NOT', () => {
    expect(() => parse('NOT')).toThrow(BooleanParseError);
  });

  it('throws on an unbalanced opening paren', () => {
    expect(() => parse('(A AND B')).toThrow(BooleanParseError);
  });

  it('throws on an unexpected closing paren', () => {
    expect(() => parse('A)')).toThrow(BooleanParseError);
  });

  it('throws on an unexpected leading operator', () => {
    expect(() => parse('AND A')).toThrow(BooleanParseError);
  });

  it('throws on an illegal character', () => {
    expect(() => parse('A & B')).toThrow(BooleanParseError);
  });

  it('throws on adjacent operands with no operator', () => {
    expect(() => parse('A B')).toThrow(BooleanParseError);
  });

  it('throws on a multi-letter, non-keyword identifier', () => {
    expect(() => parse('FOO AND B')).toThrow(BooleanParseError);
  });
});

describe('variables', () => {
  it('collects variables in sorted, de-duplicated order', () => {
    expect(variables(parse('(B AND A) OR (NOT B)'))).toEqual(['A', 'B']);
  });

  it('returns a single variable', () => {
    expect(variables(parse('NOT Z'))).toEqual(['Z']);
  });
});

describe('evaluate', () => {
  it('evaluates a variable from the environment', () => {
    expect(evaluate(parse('A'), { A: true })).toBe(true);
    expect(evaluate(parse('A'), { A: false })).toBe(false);
  });

  it('evaluates NOT', () => {
    expect(evaluate(parse('NOT A'), { A: false })).toBe(true);
  });

  it('evaluates AND', () => {
    expect(evaluate(parse('A AND B'), { A: true, B: false })).toBe(false);
    expect(evaluate(parse('A AND B'), { A: true, B: true })).toBe(true);
  });

  it('evaluates OR', () => {
    expect(evaluate(parse('A OR B'), { A: false, B: true })).toBe(true);
    expect(evaluate(parse('A OR B'), { A: false, B: false })).toBe(false);
  });

  it('throws when a variable is missing from the environment', () => {
    expect(() => evaluate(parse('A AND B'), { A: true })).toThrow(BooleanParseError);
  });

  it('evaluates a compound expression', () => {
    const ast = parse('(A AND B) OR (NOT C)');
    expect(evaluate(ast, { A: true, B: true, C: true })).toBe(true);
    expect(evaluate(ast, { A: false, B: false, C: true })).toBe(false);
    expect(evaluate(ast, { A: false, B: false, C: false })).toBe(true);
  });
});

describe('truthTable', () => {
  it('produces all 2^n rows in canonical (MSB=first var) order', () => {
    const tt = truthTable('A AND B');
    expect(tt.vars).toEqual(['A', 'B']);
    expect(tt.rows).toEqual([
      [false, false],
      [false, true],
      [true, false],
      [true, true],
    ]);
    expect(tt.out).toEqual([false, false, false, true]);
  });

  it('matches the hand-computed table for (A AND B) OR (NOT C)', () => {
    // acceptance criterion 6 expression, all 8 assignments of A,B,C
    const tt = truthTable('(A AND B) OR (NOT C)');
    expect(tt.vars).toEqual(['A', 'B', 'C']);
    // rows ordered A,B,C as a 3-bit counter; out = (A&B) | !C
    expect(tt.out).toEqual([
      true, // 000 -> !C
      false, // 001
      true, // 010 -> !C
      false, // 011
      true, // 100 -> !C
      false, // 101
      true, // 110 -> A&B
      true, // 111 -> A&B and !C
    ]);
  });
});

describe('equivalent', () => {
  it('is true for the acceptance-criterion-6 pair', () => {
    expect(
      equivalent('(A AND B) OR (NOT C)', '(NOT C) OR (B AND A)'),
    ).toBe(true);
  });

  it('is reflexive', () => {
    expect(equivalent('A AND B', 'A AND B')).toBe(true);
  });

  it('detects non-equivalence', () => {
    expect(equivalent('A AND B', 'A OR B')).toBe(false);
  });

  it('is true across commutativity', () => {
    expect(equivalent('A OR B', 'B OR A')).toBe(true);
  });

  it('is true for a De Morgan pair', () => {
    expect(equivalent('NOT (A AND B)', '(NOT A) OR (NOT B)')).toBe(true);
  });

  it('is false when variable sets differ in output', () => {
    expect(equivalent('A', 'B')).toBe(false);
  });

  it('treats expressions over differing variable sets by their union', () => {
    // A is equivalent to A regardless of an unused B in the other side?
    // A vs (A OR (B AND NOT B)) -> the extra var is a tautological no-op
    expect(equivalent('A', 'A OR (B AND NOT B)')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NOR + De Morgan (ADR-012 stretch grammar). NOR is a strictly-additive infix
// primitive at OR-precedence (pairs with NAND at AND-precedence). De Morgan's
// law is the pedagogical payoff for Lesson 4: NOT(A OR B) ≡ (NOT A) AND (NOT B)
// and NOT(A AND B) ≡ (NOT A) OR (NOT B). The locked function signatures are
// unchanged — NOR flows through parse/evaluate/truthTable/equivalent/astToExpression.
// ---------------------------------------------------------------------------
describe('NOR primitive + De Morgan equivalence', () => {
  it('parses "A NOR B" to a nor node at OR-precedence', () => {
    const ast = parse('A NOR B');
    expect(ast.kind).toBe('nor');
  });

  it('evaluates NOR as !(l || r)', () => {
    const ast = parse('A NOR B');
    expect(evaluate(ast, { A: false, B: false })).toBe(true);
    expect(evaluate(ast, { A: true, B: false })).toBe(false);
    expect(evaluate(ast, { A: false, B: true })).toBe(false);
    expect(evaluate(ast, { A: true, B: true })).toBe(false);
  });

  it('produces an MSB-first truth table for "A NOR B"', () => {
    const tt = truthTable('A NOR B');
    expect(tt.vars).toEqual(['A', 'B']);
    // out = !(A || B): true only when both false (row 00).
    expect(tt.out.map((v) => (v ? 1 : 0))).toEqual([1, 0, 0, 0]);
  });

  it('round-trips "A NOR B" through astToExpression', () => {
    expect(astToExpression(parse('A NOR B'))).toBe('A NOR B');
    expect(equivalent(astToExpression(parse('A NOR B')), 'A NOR B')).toBe(true);
  });

  it('confirms De Morgan: NOT (A OR B) ≡ (NOT A) AND (NOT B)', () => {
    expect(equivalent('NOT (A OR B)', '(NOT A) AND (NOT B)')).toBe(true);
  });

  it('confirms De Morgan: NOT (A AND B) ≡ (NOT A) OR (NOT B)', () => {
    expect(equivalent('NOT (A AND B)', '(NOT A) OR (NOT B)')).toBe(true);
  });

  it('confirms "A NOR B" ≡ NOT (A OR B) (NOR is De Morgan-dual of NAND)', () => {
    expect(equivalent('A NOR B', 'NOT (A OR B)')).toBe(true);
    expect(equivalent('A NAND B', 'NOT (A AND B)')).toBe(true);
  });

  it('distinguishes the halfway De Morgan error from the correct dual', () => {
    // The halfway misconception keeps the connective when distributing NOT:
    // NOT(A AND B) → (NOT A) AND (NOT B) [WRONG], vs the correct (NOT A) OR (NOT B).
    expect(equivalent('NOT (A AND B)', '(NOT A) AND (NOT B)')).toBe(false);
    expect(equivalent('NOT (A OR B)', '(NOT A) OR (NOT B)')).toBe(false);
  });
});

describe('Ast type export', () => {
  it('is usable as a type', () => {
    const ast: Ast = parse('A');
    expect(ast.kind).toBe('var');
  });
});

// ---------------------------------------------------------------------------
// parsePseudocode — F-04
// ---------------------------------------------------------------------------

describe('parsePseudocode', () => {
  // --- Basic structural equivalences ---

  it('parses a single lowercase variable (uppercases it)', () => {
    expect(parsePseudocode('a')).toEqual({ kind: 'var', name: 'A' });
  });

  it('parses a single uppercase variable', () => {
    expect(parsePseudocode('A')).toEqual({ kind: 'var', name: 'A' });
  });

  it('parses "a and b" — canonical L1 form', () => {
    const ast = parsePseudocode('a and b');
    expect(ast).toEqual({
      kind: 'and',
      left: { kind: 'var', name: 'A' },
      right: { kind: 'var', name: 'B' },
    });
  });

  it('parses "a or b"', () => {
    const ast = parsePseudocode('a or b');
    expect(ast).toEqual({
      kind: 'or',
      left: { kind: 'var', name: 'A' },
      right: { kind: 'var', name: 'B' },
    });
  });

  it('parses "not a"', () => {
    expect(parsePseudocode('not a')).toEqual({
      kind: 'not',
      operand: { kind: 'var', name: 'A' },
    });
  });

  it('parses "(a) and (b)" — equivalent to "a and b"', () => {
    const ast1 = parsePseudocode('a and b');
    const ast2 = parsePseudocode('(a) and (b)');
    // Both should produce the same AST
    expect(ast2).toEqual(ast1);
  });

  it('parses "(a and b)" — parens around whole expression', () => {
    expect(parsePseudocode('(a and b)')).toEqual(parsePseudocode('a and b'));
  });

  // --- if/then sugar ---

  it('parses "if a then b" as "(not a) or b" (implication)', () => {
    const ast = parsePseudocode('if a then b');
    // if P then Q === NOT P OR Q
    expect(equivalent(astToExpression(ast), '(NOT A) OR B')).toBe(true);
  });

  it('parses "if a and b then c" — precedence in condition and consequent', () => {
    const ast = parsePseudocode('if a and b then c');
    expect(equivalent(astToExpression(ast), '(NOT (A AND B)) OR C')).toBe(true);
  });

  // --- Precedence mirrors the canonical parse ---

  it('NOT binds tighter than AND in pseudocode', () => {
    // "not a and b" === "(not a) and b"
    const ast = parsePseudocode('not a and b');
    expect(ast).toEqual({
      kind: 'and',
      left: { kind: 'not', operand: { kind: 'var', name: 'A' } },
      right: { kind: 'var', name: 'B' },
    });
  });

  it('AND binds tighter than OR in pseudocode', () => {
    // "a or b and c" === "a or (b and c)"
    const ast = parsePseudocode('a or b and c');
    expect(ast).toEqual({
      kind: 'or',
      left: { kind: 'var', name: 'A' },
      right: {
        kind: 'and',
        left: { kind: 'var', name: 'B' },
        right: { kind: 'var', name: 'C' },
      },
    });
  });

  // --- Round-trip: every L1 target expression has ≥2 equivalent pseudocode forms ---

  it('round-trip: "A AND B" — two equivalent pseudocode forms', () => {
    const canonical = 'A AND B';
    const form1 = parsePseudocode('a and b');
    const form2 = parsePseudocode('(a) and (b)');
    expect(equivalent(astToExpression(form1), canonical)).toBe(true);
    expect(equivalent(astToExpression(form2), canonical)).toBe(true);
    // and they are equivalent to each other
    expect(equivalent(astToExpression(form1), astToExpression(form2))).toBe(true);
  });

  it('round-trip: "A OR B" — two equivalent pseudocode forms', () => {
    const canonical = 'A OR B';
    const form1 = parsePseudocode('a or b');
    const form2 = parsePseudocode('(a or b)');
    expect(equivalent(astToExpression(form1), canonical)).toBe(true);
    expect(equivalent(astToExpression(form2), canonical)).toBe(true);
  });

  it('round-trip: "NOT A" — two equivalent pseudocode forms', () => {
    const canonical = 'NOT A';
    const form1 = parsePseudocode('not a');
    const form2 = parsePseudocode('not (a)');
    expect(equivalent(astToExpression(form1), canonical)).toBe(true);
    expect(equivalent(astToExpression(form2), canonical)).toBe(true);
  });

  it('round-trip: "(A AND B) OR C" — two equivalent pseudocode forms', () => {
    const canonical = '(A AND B) OR C';
    const form1 = parsePseudocode('(a and b) or c');
    const form2 = parsePseudocode('((a) and (b)) or (c)');
    expect(equivalent(astToExpression(form1), canonical)).toBe(true);
    expect(equivalent(astToExpression(form2), canonical)).toBe(true);
  });

  it('round-trip: "NOT (A OR B)" — two equivalent pseudocode forms', () => {
    const canonical = 'NOT (A OR B)';
    const form1 = parsePseudocode('not (a or b)');
    const form2 = parsePseudocode('not ((a) or (b))');
    expect(equivalent(astToExpression(form1), canonical)).toBe(true);
    expect(equivalent(astToExpression(form2), canonical)).toBe(true);
  });

  // --- if/then round-trip ---

  it('round-trip: "if a then b" is equivalent to "(NOT A) OR B"', () => {
    const ast = parsePseudocode('if a then b');
    expect(equivalent(astToExpression(ast), '(NOT A) OR B')).toBe(true);
  });

  // --- Variable count cap ---

  it('throws when more than 10 distinct variables are used', () => {
    const expr = 'a and b and c and d and e and f and g and h and i and j and k';
    expect(() => parsePseudocode(expr)).toThrow(BooleanParseError);
  });

  it('accepts exactly 10 distinct variables', () => {
    // 10 variables: A-J
    const expr = 'a and b and c and d and e and f and g and h and i and j';
    expect(() => parsePseudocode(expr)).not.toThrow();
  });

  // --- Error cases ---

  it('throws BooleanParseError on empty input', () => {
    expect(() => parsePseudocode('')).toThrow(BooleanParseError);
    expect(() => parsePseudocode('   ')).toThrow(BooleanParseError);
  });

  it('throws on dangling operator', () => {
    expect(() => parsePseudocode('a and')).toThrow(BooleanParseError);
  });

  it('throws on unbalanced parentheses', () => {
    expect(() => parsePseudocode('(a and b')).toThrow(BooleanParseError);
  });

  it('throws on illegal character', () => {
    expect(() => parsePseudocode('a & b')).toThrow(BooleanParseError);
  });

  it('throws on multi-letter identifier (not a keyword)', () => {
    expect(() => parsePseudocode('foo and b')).toThrow(BooleanParseError);
  });

  it('throws on "if" without "then"', () => {
    expect(() => parsePseudocode('if a')).toThrow(BooleanParseError);
  });

  it('throws on "true" boolean literal', () => {
    expect(() => parsePseudocode('true')).toThrow(BooleanParseError);
  });

  it('throws on "false" boolean literal', () => {
    expect(() => parsePseudocode('false')).toThrow(BooleanParseError);
  });

  // --- DoS / stack-overflow guards (Fix 1 — adversarial review) ---

  it('throws BooleanParseError (not RangeError) for a source longer than 2000 chars', () => {
    // Build a valid-looking but absurdly long expression (e.g. "A or A or A …")
    // that exceeds the 2000-char limit before tokenization
    const longSrc = 'A or '.repeat(500); // 2500 chars
    expect(longSrc.length).toBeGreaterThan(2000);
    const err = (() => { try { parsePseudocode(longSrc); } catch (e) { return e; } })();
    expect(err).toBeInstanceOf(BooleanParseError);
    expect((err as BooleanParseError).message).toMatch(/too long/i);
  });

  it('throws BooleanParseError (not RangeError) for a deeply nested expression', () => {
    // Build a deeply nested expression: ((((…A…)))) with depth > 200
    const nested = '('.repeat(250) + 'A' + ')'.repeat(250);
    const err = (() => { try { parsePseudocode(nested); } catch (e) { return e; } })();
    expect(err).toBeInstanceOf(BooleanParseError);
    expect((err as BooleanParseError).message).toMatch(/nested|depth/i);
  });

  it('throws BooleanParseError (not RangeError) for a very long NOT chain', () => {
    // "not not not … A" — 250 nots — drives deep recursion in parseNot
    const notChain = 'not '.repeat(250) + 'A';
    const err = (() => { try { parsePseudocode(notChain); } catch (e) { return e; } })();
    expect(err).toBeInstanceOf(BooleanParseError);
    expect((err as BooleanParseError).message).toMatch(/nested|depth/i);
  });

  it('throws on trailing tokens (e.g., "a b")', () => {
    expect(() => parsePseudocode('a b')).toThrow(BooleanParseError);
  });

  it('throws on a leading operator as atom (e.g., "and a")', () => {
    expect(() => parsePseudocode('and a')).toThrow(BooleanParseError);
  });

  // --- astToExpression: AND with an OR on the right parenthesises correctly ---

  it('astToExpression parenthesises OR on the right side of AND', () => {
    // Build: a and (b or c) — the right child of AND is OR, must be parenthesised
    const ast: Ast = {
      kind: 'and',
      left: { kind: 'var', name: 'A' },
      right: {
        kind: 'or',
        left: { kind: 'var', name: 'B' },
        right: { kind: 'var', name: 'C' },
      },
    };
    const expr = astToExpression(ast);
    // Must parse back to the same structure
    const reParsed = parse(expr);
    expect(reParsed).toEqual(ast);
  });

  it('astToExpression parenthesises OR on the LEFT side of AND', () => {
    // Build: (a or b) and c — the left child of AND is OR, must be parenthesised
    const ast: Ast = {
      kind: 'and',
      left: {
        kind: 'or',
        left: { kind: 'var', name: 'A' },
        right: { kind: 'var', name: 'B' },
      },
      right: { kind: 'var', name: 'C' },
    };
    const expr = astToExpression(ast);
    const reParsed = parse(expr);
    expect(reParsed).toEqual(ast);
  });

  // --- Case-insensitive keywords ---

  it('accepts uppercase AND/OR/NOT keywords', () => {
    expect(parsePseudocode('A AND B')).toEqual(parsePseudocode('a and b'));
    expect(parsePseudocode('A OR B')).toEqual(parsePseudocode('a or b'));
    expect(parsePseudocode('NOT A')).toEqual(parsePseudocode('not a'));
  });

  it('accepts mixed-case keywords (e.g. "And")', () => {
    expect(parsePseudocode('a And b')).toEqual(parsePseudocode('a and b'));
  });

  // --- astToExpression produces a string parse() can re-parse ---

  it('astToExpression produces a string that parse() can round-trip', () => {
    const ast = parsePseudocode('not (a and b) or c');
    const expr = astToExpression(ast);
    const reParsed = parse(expr);
    // The re-parsed AST should evaluate identically
    expect(equivalent(astToExpression(reParsed), expr)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// property test: parsePseudocode → evaluate agrees with canonical form
// ---------------------------------------------------------------------------

describe('parsePseudocode property: evaluate agrees with canonical', () => {
  // These expressions are the L1 target expressions from the lesson
  const L1_EXPRESSIONS = [
    'A AND B',
    'A OR B',
    'NOT A',
    'NOT (A AND B)',
    'NOT (A OR B)',
    '(A AND B) OR C',
    '(A OR B) AND C',
    'NOT A AND NOT B',
    'A OR (B AND C)',
  ];

  for (const expr of L1_EXPRESSIONS) {
    it(`parsePseudocode of "${expr.toLowerCase()}" evaluates to the same table as parse("${expr}")`, () => {
      const pseudoForm = expr.toLowerCase().replace(/ and /g, ' and ').replace(/ or /g, ' or ').replace(/not /g, 'not ');
      const ast = parsePseudocode(pseudoForm);
      const canonical = parse(expr);
      const vars = [...new Set([...variables(ast), ...variables(canonical)])].sort();
      const n = vars.length;
      for (let mask = 0; mask < 1 << n; mask++) {
        const env: Record<string, boolean> = {};
        for (let bit = 0; bit < n; bit++) {
          env[vars[bit]!] = (mask & (1 << (n - 1 - bit))) !== 0;
        }
        expect(evaluate(ast, env)).toBe(evaluate(canonical, env));
      }
    });
  }
});
