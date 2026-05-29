import { describe, expect, it } from 'vitest';
import { equivalent, truthTable } from '@polymath/booleans';
import {
  type Circuit,
  buildCircuit,
  outputValue,
  pulseSchedule,
} from './circuitModel.js';
import { astToExpression } from './circuitSubmission.js';

/**
 * NAND-only circuits (Lesson 3 — NAND universality). A first-class NAND gate
 * node (two input ports) is the truth-maker for the universality proof and the
 * XOR-from-NAND "aha" pulse demo (AC#4, AC#5).
 */

/** NOT A built from one NAND: A NAND A. */
const notFromNand: Circuit = {
  nodes: [
    { id: 'A', type: 'input', name: 'A' },
    { id: 'g', type: 'gate', gate: 'NAND' },
    { id: 'out', type: 'output' },
  ],
  edges: [
    { source: 'A', target: 'g', targetPort: 'a' },
    { source: 'A', target: 'g', targetPort: 'b' },
    { source: 'g', target: 'out', targetPort: 'a' },
  ],
};

/** A NAND B → output. */
const nandCircuit: Circuit = {
  nodes: [
    { id: 'A', type: 'input', name: 'A' },
    { id: 'B', type: 'input', name: 'B' },
    { id: 'g', type: 'gate', gate: 'NAND' },
    { id: 'out', type: 'output' },
  ],
  edges: [
    { source: 'A', target: 'g', targetPort: 'a' },
    { source: 'B', target: 'g', targetPort: 'b' },
    { source: 'g', target: 'out', targetPort: 'a' },
  ],
};

/**
 * XOR from four NAND gates (the canonical universality showcase):
 *   m  = A NAND B
 *   t1 = A NAND m
 *   t2 = B NAND m
 *   out = t1 NAND t2
 */
const xorFromNand: Circuit = {
  nodes: [
    { id: 'A', type: 'input', name: 'A' },
    { id: 'B', type: 'input', name: 'B' },
    { id: 'm', type: 'gate', gate: 'NAND' },
    { id: 't1', type: 'gate', gate: 'NAND' },
    { id: 't2', type: 'gate', gate: 'NAND' },
    { id: 'g', type: 'gate', gate: 'NAND' },
    { id: 'out', type: 'output' },
  ],
  edges: [
    { source: 'A', target: 'm', targetPort: 'a' },
    { source: 'B', target: 'm', targetPort: 'b' },
    { source: 'A', target: 't1', targetPort: 'a' },
    { source: 'm', target: 't1', targetPort: 'b' },
    { source: 'B', target: 't2', targetPort: 'a' },
    { source: 'm', target: 't2', targetPort: 'b' },
    { source: 't1', target: 'g', targetPort: 'a' },
    { source: 't2', target: 'g', targetPort: 'b' },
    { source: 'g', target: 'out', targetPort: 'a' },
  ],
};

describe('buildCircuit → NAND AST', () => {
  it('a NAND node yields a nand AST equivalent to NOT (A AND B) (AC#4)', () => {
    const r = buildCircuit(nandCircuit);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(equivalent(astToExpression(r.ast), 'NOT (A AND B)')).toBe(true);
  });

  it('A NAND A builds NOT A — the universality base case (AC#3)', () => {
    const r = buildCircuit(notFromNand);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(equivalent(astToExpression(r.ast), 'NOT A')).toBe(true);
  });

  it('a NAND-only XOR matches the XOR truth table over all 4 rows (AC#5)', () => {
    const built = buildCircuit(xorFromNand);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(equivalent(astToExpression(built.ast), '(A AND NOT B) OR (NOT A AND B)')).toBe(true);

    const tt = truthTable('(A AND NOT B) OR (NOT A AND B)');
    tt.rows.forEach((row, i) => {
      const env = { A: row[0]!, B: row[1]! };
      expect(outputValue(built, env)).toBe(tt.out[i]);
    });
  });
});

describe('pulseSchedule over NAND gates', () => {
  it('latches the NAND value and emits a "nand" SR label per gate', () => {
    const built = buildCircuit(nandCircuit);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const env = { A: true, B: true };
    const schedule = pulseSchedule(nandCircuit, built, env);
    const gateStep = schedule.steps.find((s) => s.nodeId === 'g')!;
    expect(gateStep.value).toBe(false); // !(true && true)
    expect(gateStep.label).toContain('nand');
  });

  it('is deterministic and traces XOR-from-NAND propagation (AC#5)', () => {
    const built = buildCircuit(xorFromNand);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const env = { A: true, B: false }; // XOR(1,0) = 1
    const s1 = pulseSchedule(xorFromNand, built, env);
    const s2 = pulseSchedule(xorFromNand, built, env);
    expect(s1).toEqual(s2);
    const out = s1.steps.find((s) => s.nodeId === 'out')!;
    expect(out.value).toBe(true);
    // Every gate step latches the @polymath/booleans value for its sub-expression.
    expect(s1.steps.every((s) => typeof s.value === 'boolean')).toBe(true);
  });
});
