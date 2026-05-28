import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { type Circuit, buildCircuit, pulseSchedule } from './circuitModel.js';
import { usePulseRunner } from './usePulseRunner.js';

const circuit: Circuit = {
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

function schedule() {
  const built = buildCircuit(circuit);
  if (!built.ok) throw new Error('expected ok');
  return pulseSchedule(circuit, built, { A: true, B: false, C: true });
}

describe('usePulseRunner', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('advances through every step then returns to idle (continuous)', () => {
    const sched = schedule();
    const { result } = renderHook(() => usePulseRunner());
    expect(result.current.activeStep).toBeNull();

    act(() => result.current.start(sched));
    expect(result.current.running).toBe(true);

    const seen: (number | null)[] = [];
    // Step through all timers; record activeStep at each.
    for (let i = 0; i < sched.steps.length + 1; i++) {
      act(() => vi.advanceTimersByTime(300));
      seen.push(result.current.activeStep);
    }
    // We saw the final step index at some point...
    expect(seen).toContain(sched.steps.length - 1);
    // ...and the runner ends idle.
    expect(result.current.activeStep).toBeNull();
    expect(result.current.running).toBe(false);
  });

  it('reduced-motion step() advances exactly one step per call', () => {
    const sched = schedule();
    const { result } = renderHook(() => usePulseRunner());
    act(() => result.current.step(sched));
    expect(result.current.activeStep).toBe(0);
    act(() => result.current.step(sched));
    expect(result.current.activeStep).toBe(1);
    expect(result.current.announcement).toMatch(/Step 2 of/);
  });

  it('step() past the end resets to idle and announces completion', () => {
    const sched = schedule();
    const { result } = renderHook(() => usePulseRunner());
    for (let i = 0; i < sched.steps.length; i++) {
      act(() => result.current.step(sched));
    }
    // One more call walks off the end.
    act(() => result.current.step(sched));
    expect(result.current.activeStep).toBeNull();
    expect(result.current.announcement).toBe('Pulse complete.');
  });

  it('produces a screen-reader announcement naming the node and value', () => {
    const sched = schedule();
    const { result } = renderHook(() => usePulseRunner());
    act(() => result.current.step(sched));
    expect(result.current.announcement).toMatch(/node and evaluates to false/i);
  });
});
