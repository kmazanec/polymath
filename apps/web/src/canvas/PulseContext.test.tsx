import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { type Circuit, buildCircuit, pulseSchedule } from './circuitModel.js';
import { PulseProvider, pulseValue, usePulse } from './PulseContext.js';

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
});
