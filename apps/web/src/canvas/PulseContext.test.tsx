import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { type Circuit, buildCircuit, pulseSchedule } from './circuitModel.js';
import {
  PulseProvider,
  nodeLitState,
  pulseValue,
  usePulse,
} from './PulseContext.js';

const circuit: Circuit = {
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

function Probe(): React.ReactElement {
  const { activeStep, schedule, env } = usePulse();
  return (
    <div>
      <span data-testid="active">{activeStep === null ? 'none' : activeStep}</span>
      <span data-testid="len">{schedule.length}</span>
      <span data-testid="env">{JSON.stringify(env)}</span>
    </div>
  );
}

describe('PulseContext', () => {
  afterEach(cleanup);

  it('a subscriber outside any provider sees the empty (no-op) value', () => {
    render(<Probe />);
    expect(screen.getByTestId('active').textContent).toBe('none');
    expect(screen.getByTestId('len').textContent).toBe('0');
  });

  it('publishes the active step + schedule to subscribers', () => {
    const built = buildCircuit(circuit);
    if (!built.ok) throw new Error('expected ok');
    const schedule = pulseSchedule(circuit, built, { A: true, B: true });
    render(
      <PulseProvider value={pulseValue(schedule, 0)}>
        <Probe />
      </PulseProvider>,
    );
    expect(screen.getByTestId('active').textContent).toBe('0');
    expect(Number(screen.getByTestId('len').textContent)).toBe(schedule.steps.length);
    expect(screen.getByTestId('env').textContent).toBe(JSON.stringify({ A: true, B: true }));
  });

  it('pulseValue(null) collapses to the empty value', () => {
    const v = pulseValue(null, null);
    expect(v.activeStep).toBeNull();
    expect(v.schedule).toEqual([]);
  });

  describe('nodeLitState follows the logic (the current respects A/B values)', () => {
    // A AND NOT B — the user's case. Inputs feed a NOT(B) and an AND.
    const c: Circuit = {
      nodes: [
        { id: 'A', type: 'input', name: 'A' },
        { id: 'B', type: 'input', name: 'B' },
        { id: 'not', type: 'gate', gate: 'NOT' },
        { id: 'and', type: 'gate', gate: 'AND' },
        { id: 'out', type: 'output' },
      ],
      edges: [
        { source: 'B', target: 'not', targetPort: 'a' },
        { source: 'A', target: 'and', targetPort: 'a' },
        { source: 'not', target: 'and', targetPort: 'b' },
        { source: 'and', target: 'out', targetPort: 'a' },
      ],
    };

    function ctxAt(env: Record<string, boolean>) {
      const built = buildCircuit(c);
      if (!built.ok) throw new Error('expected ok');
      const schedule = pulseSchedule(c, built, env);
      // Active at the LAST step → whole path reached (cumulative hold).
      return pulseValue(schedule, schedule.steps.length - 1);
    }

    it('A=1,B=1: A is high, NOT(B)=0 low, AND=0 low, OUT=0 low', () => {
      const ctx = ctxAt({ A: true, B: true });
      expect(nodeLitState(ctx, 'A')).toBe('high');
      expect(nodeLitState(ctx, 'B')).toBe('high'); // the input B itself IS 1…
      expect(nodeLitState(ctx, 'not')).toBe('low'); // …but ¬1 = 0
      expect(nodeLitState(ctx, 'and')).toBe('low'); // 1 AND 0 = 0
      expect(nodeLitState(ctx, 'out')).toBe('low');
    });

    it('A=1,B=0: A high, NOT(B)=1 high, AND=1 high, OUT=1 high', () => {
      const ctx = ctxAt({ A: true, B: false });
      expect(nodeLitState(ctx, 'A')).toBe('high');
      expect(nodeLitState(ctx, 'B')).toBe('low'); // input B is 0
      expect(nodeLitState(ctx, 'not')).toBe('high'); // ¬0 = 1
      expect(nodeLitState(ctx, 'and')).toBe('high'); // 1 AND 1 = 1
      expect(nodeLitState(ctx, 'out')).toBe('high');
    });

    it('idle when no pulse is running', () => {
      const ctx = pulseValue(null, null);
      expect(nodeLitState(ctx, 'A')).toBe('idle');
      expect(nodeLitState(ctx, 'out')).toBe('idle');
    });
  });
});
