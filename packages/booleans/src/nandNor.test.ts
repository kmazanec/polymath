import { describe, expect, it } from 'vitest';
import {
  parse,
  evaluate,
  truthTable,
  equivalent,
  variables,
  parsePseudocode,
  astToExpression,
  type Ast,
} from './index.js';

/**
 * Stretch-grammar primitives (ADR-012): NAND at AND-precedence, NOR at
 * OR-precedence. The grammar landed as a frozen additive contract; these tests
 * pin its observable behaviour (AC#4: the package correctly evaluates NAND-only
 * circuits and confirms equivalence to non-NAND target expressions) and exercise
 * every NAND/NOR arm.
 */

function evalAll(ast: Ast, vars: string[]): boolean[] {
  const n = vars.length;
  const out: boolean[] = [];
  for (let mask = 0; mask < 1 << n; mask++) {
    const env: Record<string, boolean> = {};
    for (let bit = 0; bit < n; bit++) {
      env[vars[bit]!] = (mask & (1 << (n - 1 - bit))) !== 0;
    }
    out.push(evaluate(ast, env));
  }
  return out;
}

describe('NAND primitive', () => {
  it('parses to a nand AST node', () => {
    const ast = parse('A NAND B');
    expect(ast).toEqual({
      kind: 'nand',
      left: { kind: 'var', name: 'A' },
      right: { kind: 'var', name: 'B' },
    });
  });

  it('evaluates as !(l && r)', () => {
    expect(evalAll(parse('A NAND B'), ['A', 'B'])).toEqual([true, true, true, false]);
  });

  it('truthTable("A NAND B").out is MSB-first [1,1,1,0]', () => {
    const t = truthTable('A NAND B');
    expect(t.vars).toEqual(['A', 'B']);
    expect(t.out.map((v) => (v ? 1 : 0))).toEqual([1, 1, 1, 0]);
  });

  it('is equivalent to NOT (A AND B) (AC#4)', () => {
    expect(equivalent('A NAND B', 'NOT (A AND B)')).toBe(true);
  });

  it('A NAND A is equivalent to NOT A (NOT from NAND, the universality base case)', () => {
    expect(equivalent('A NAND A', 'NOT A')).toBe(true);
  });

  it('NAND sits at AND-precedence (left-assoc, binds tighter than OR)', () => {
    // A NAND B OR C parses as (A NAND B) OR C, not A NAND (B OR C).
    expect(equivalent('A NAND B OR C', '(A NAND B) OR C')).toBe(true);
    expect(equivalent('A NAND B OR C', 'A NAND (B OR C)')).toBe(false);
  });

  it('A NAND B NAND C is left-associative ((A NAND B) NAND C)', () => {
    expect(equivalent('A NAND B NAND C', '(A NAND B) NAND C')).toBe(true);
  });

  it('variables() walks both NAND operands', () => {
    expect(variables(parse('A NAND B'))).toEqual(['A', 'B']);
    expect(variables(parse('(A NAND B) NAND (C NAND A)'))).toEqual(['A', 'B', 'C']);
  });

  it('astToExpression round-trips a NAND expression', () => {
    const ast = parse('A NAND B');
    const round = astToExpression(ast);
    expect(equivalent(round, 'A NAND B')).toBe(true);
  });

  it('astToExpression parenthesises an OR-level NAND child so it re-parses identically', () => {
    // (A OR B) NAND C — the OR child must be parenthesised in the rendered form.
    const ast = parse('(A OR B) NAND C');
    const round = astToExpression(ast);
    expect(round).toContain('NAND');
    expect(equivalent(round, '(A OR B) NAND C')).toBe(true);
    // The re-parse must match the original tree, not (A OR (B NAND C)).
    expect(parse(round)).toEqual(ast);
  });

  it('round-trips RIGHT-nested NAND/NOR without re-association (MR !9 review)', () => {
    // NAND/NOR are NON-associative and the parser is left-associative, so a flat
    // render of a right-nested tree would re-parse to the WRONG grouping and
    // mis-score a learner's correct pseudocode. Each must survive parse→render→parse
    // structurally AND remain equivalent.
    for (const src of [
      'A NAND (B NAND C)',
      'A AND (B NAND C)',
      'A NOR (B NOR C)',
      'A OR (B NOR C)',
      'A NAND (B AND C)',
      '(A NAND B) NAND (C NAND D)',
    ]) {
      const ast = parse(src);
      const round = astToExpression(ast);
      expect(parse(round), `${src} → ${round} must re-parse to the same tree`).toEqual(ast);
      expect(equivalent(round, src), `${src} → ${round} must stay equivalent`).toBe(true);
    }
  });

  it('builds XOR from NAND only and matches the XOR truth table (AC#5)', () => {
    // XOR = (A NAND (A NAND B)) NAND (B NAND (A NAND B)) — the classic 4-NAND XOR.
    const xorFromNand = '(A NAND (A NAND B)) NAND (B NAND (A NAND B))';
    expect(truthTable(xorFromNand).out.map((v) => (v ? 1 : 0))).toEqual([0, 1, 1, 0]);
    expect(equivalent(xorFromNand, '(A AND NOT B) OR (NOT A AND B)')).toBe(true);
  });

  it('parsePseudocode accepts NAND', () => {
    expect(equivalent(astToExpression(parsePseudocode('a nand b')), 'A NAND B')).toBe(true);
  });
});

describe('NOR primitive', () => {
  it('parses to a nor AST node', () => {
    expect(parse('A NOR B')).toEqual({
      kind: 'nor',
      left: { kind: 'var', name: 'A' },
      right: { kind: 'var', name: 'B' },
    });
  });

  it('evaluates as !(l || r)', () => {
    expect(evalAll(parse('A NOR B'), ['A', 'B'])).toEqual([true, false, false, false]);
  });

  it('is equivalent to NOT (A OR B)', () => {
    expect(equivalent('A NOR B', 'NOT (A OR B)')).toBe(true);
  });

  it('NOR sits at OR-precedence (binds looser than AND)', () => {
    // A NOR B AND C parses as A NOR (B AND C).
    expect(equivalent('A NOR B AND C', 'A NOR (B AND C)')).toBe(true);
  });

  it('A NOR B NOR C is left-associative', () => {
    expect(equivalent('A NOR B NOR C', '(A NOR B) NOR C')).toBe(true);
  });

  it('variables() walks both NOR operands', () => {
    expect(variables(parse('(A NOR B) NOR C'))).toEqual(['A', 'B', 'C']);
  });

  it('astToExpression round-trips a NOR expression (flat OR-level shape)', () => {
    const ast = parse('A NOR B');
    expect(parse(astToExpression(ast))).toEqual(ast);
  });

  it('parsePseudocode accepts NOR', () => {
    expect(equivalent(astToExpression(parsePseudocode('a nor b')), 'A NOR B')).toBe(true);
  });
});
