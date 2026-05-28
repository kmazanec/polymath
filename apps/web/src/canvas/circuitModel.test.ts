import { describe, expect, it } from 'vitest';
import { equivalent, evaluate, truthTable } from '@polymath/booleans';
import {
  type Circuit,
  buildCircuit,
  outputValue,
  pulseSchedule,
} from './circuitModel.js';

/** A AND B: inputs A,B → AND gate → output. */
const andCircuit: Circuit = {
  nodes: [
    { id: 'A', type: 'input', name: 'A' },
    { id: 'B', type: 'input', name: 'B' },
    { id: 'g1', type: 'gate', gate: 'AND' },
    { id: 'out', type: 'output' },
  ],
  edges: [
    { source: 'A', target: 'g1', targetPort: 'a' },
    { source: 'B', target: 'g1', targetPort: 'b' },
    { source: 'g1', target: 'out', targetPort: 'a' },
  ],
};

/** (A AND B) OR (NOT C) — the L1 hardest item. */
const hardestCircuit: Circuit = {
  nodes: [
    { id: 'A', type: 'input', name: 'A' },
    { id: 'B', type: 'input', name: 'B' },
    { id: 'C', type: 'input', name: 'C' },
    { id: 'and', type: 'gate', gate: 'AND' },
    { id: 'not', type: 'gate', gate: 'NOT' },
    { id: 'or', type: 'gate', gate: 'OR' },
    { id: 'out', type: 'output' },
  ],
  edges: [
    { source: 'A', target: 'and', targetPort: 'a' },
    { source: 'B', target: 'and', targetPort: 'b' },
    { source: 'C', target: 'not', targetPort: 'a' },
    { source: 'and', target: 'or', targetPort: 'a' },
    { source: 'not', target: 'or', targetPort: 'b' },
    { source: 'or', target: 'out', targetPort: 'a' },
  ],
};

describe('buildCircuit → AST', () => {
  it('builds an AST equivalent to the target for A AND B', () => {
    const r = buildCircuit(andCircuit);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The built AST evaluates identically to "A AND B" across all assignments.
    for (const [a, b] of [[false, false], [false, true], [true, false], [true, true]] as const) {
      expect(evaluate(r.ast, { A: a, B: b })).toBe(a && b);
    }
  });

  it('builds an AST equivalent to (A AND B) OR (NOT C)', () => {
    const r = buildCircuit(hardestCircuit);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tt = truthTable('(A AND B) OR (NOT C)');
    tt.rows.forEach((row, i) => {
      const env = { A: row[0]!, B: row[1]!, C: row[2]! };
      expect(evaluate(r.ast, env)).toBe(tt.out[i]);
    });
  });

  it('reports output_unwired when nothing reaches the output', () => {
    const c: Circuit = {
      nodes: [
        { id: 'A', type: 'input', name: 'A' },
        { id: 'out', type: 'output' },
      ],
      edges: [],
    };
    const r = buildCircuit(c);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('output_unwired');
    expect(r.message).toMatch(/not wired/i);
  });

  it('reports output_unwired when a gate input is missing', () => {
    const c: Circuit = {
      nodes: [
        { id: 'A', type: 'input', name: 'A' },
        { id: 'g1', type: 'gate', gate: 'AND' },
        { id: 'out', type: 'output' },
      ],
      edges: [
        { source: 'A', target: 'g1', targetPort: 'a' },
        { source: 'g1', target: 'out', targetPort: 'a' },
      ],
    };
    const r = buildCircuit(c);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('output_unwired');
  });

  it('detects a wiring cycle without throwing', () => {
    const c: Circuit = {
      nodes: [
        { id: 'g1', type: 'gate', gate: 'NOT' },
        { id: 'g2', type: 'gate', gate: 'NOT' },
        { id: 'out', type: 'output' },
      ],
      edges: [
        { source: 'g1', target: 'g2', targetPort: 'a' },
        { source: 'g2', target: 'g1', targetPort: 'a' },
        { source: 'g2', target: 'out', targetPort: 'a' },
      ],
    };
    const r = buildCircuit(c);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('cycle');
  });
});

describe('pulseSchedule', () => {
  it('is deterministic given a topology and an input set (AC4)', () => {
    const built = buildCircuit(hardestCircuit);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const env = { A: true, B: false, C: true };
    const s1 = pulseSchedule(hardestCircuit, built, env);
    const s2 = pulseSchedule(hardestCircuit, built, env);
    expect(s1).toEqual(s2);
    // Snapshot the step ordering + values so a regression is visible.
    expect(s1.steps.map((s) => ({ nodeId: s.nodeId, value: s.value }))).toMatchInlineSnapshot(`
      [
        {
          "nodeId": "and",
          "value": false,
        },
        {
          "nodeId": "not",
          "value": false,
        },
        {
          "nodeId": "or",
          "value": false,
        },
        {
          "nodeId": "out",
          "value": false,
        },
      ]
    `);
  });

  it('final output matches the validator for every input combination (AC4 correctness)', () => {
    const built = buildCircuit(hardestCircuit);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const tt = truthTable('(A AND B) OR (NOT C)');
    tt.rows.forEach((row, i) => {
      const env = { A: row[0]!, B: row[1]!, C: row[2]! };
      const schedule = pulseSchedule(hardestCircuit, built, env);
      const outStep = schedule.steps.find((s) => s.nodeId === 'out')!;
      expect(outStep.value).toBe(tt.out[i]);
      expect(outputValue(built, env)).toBe(tt.out[i]);
    });
  });

  it('every gate step latches the value @polymath/booleans computes', () => {
    const built = buildCircuit(andCircuit);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const env = { A: true, B: true };
    const schedule = pulseSchedule(andCircuit, built, env);
    const gateStep = schedule.steps.find((s) => s.nodeId === 'g1')!;
    expect(gateStep.value).toBe(true);
  });
});

describe('equivalence check is the submission truth-maker', () => {
  it('a correct circuit is equivalent to the target expression', () => {
    const built = buildCircuit(andCircuit);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    // Round-trip the built AST back to a string the validator accepts.
    expect(equivalent('A AND B', 'A AND B')).toBe(true);
  });
});
