import { describe, expect, it } from 'vitest';
import {
  parse,
  evaluate,
  truthTable,
  equivalent,
  variables,
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

describe('Ast type export', () => {
  it('is usable as a type', () => {
    const ast: Ast = parse('A');
    expect(ast.kind).toBe('var');
  });
});
