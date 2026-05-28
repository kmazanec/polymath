import { describe, expect, it } from 'vitest';
import { equivalent } from '@polymath/booleans';
import { type Circuit } from './circuitModel.js';
import { astToExpression, evaluateSubmission } from './circuitSubmission.js';

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

describe('astToExpression', () => {
  it('renders a parsable, equivalent expression', () => {
    const expr = astToExpression(andCircuit);
    expect(expr).not.toBeNull();
    expect(equivalent(expr!, 'A AND B')).toBe(true);
  });
});

describe('evaluateSubmission', () => {
  it('marks a correct circuit correct and builds the circuit repSubmission', () => {
    const r = evaluateSubmission(andCircuit, 'A AND B', [{ id: 'A' }], [{ source: 'A' }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.correct).toBe(true);
    expect(r.repSubmission.rep).toBe('circuit');
    expect(r.repSubmission.expression).toBe(r.expression);
    expect(r.repSubmission.nodes).toEqual([{ id: 'A' }]);
  });

  it('marks an inequivalent circuit incorrect (OR built for an AND target)', () => {
    const orCircuit: Circuit = {
      ...andCircuit,
      nodes: andCircuit.nodes.map((n) =>
        n.id === 'g1' ? { id: 'g1', type: 'gate', gate: 'OR' } : n,
      ),
    };
    const r = evaluateSubmission(orCircuit, 'A AND B', [], []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.correct).toBe(false);
  });

  it('returns a typed error for an unwired output rather than throwing', () => {
    const broken: Circuit = { nodes: [{ id: 'out', type: 'output' }], edges: [] };
    const r = evaluateSubmission(broken, 'A AND B', [], []);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('output_unwired');
  });
});
