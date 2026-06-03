import { createContext, useContext, type ReactNode } from 'react';
import type { PulseSchedule, PulseStep } from './circuitModel.js';

/**
 * PulseContext — the cross-representation pulse contract (ROADMAP cross-cutting
 * contracts; introduced by F-03). The Circuit's `Test it` pulse publishes the
 * currently-active step and the full schedule; the TruthTable (F-02) and
 * Pseudocode (F-04) representations *subscribe* to highlight the row/line that
 * matches the active step, in sync with the circuit animation.
 *
 * The shape is LOCKED here: `{ activeStep: number | null, schedule: PulseStep[] }`
 * (plus the resolved `vars`/`env` for subscribers that need the input assignment
 * to find their matching row). Subscribers read; only the producer (the Circuit's
 * PulseRenderer) writes. `activeStep` is an index into `schedule`, or null when no
 * pulse is running.
 */
export interface PulseContextValue {
  activeStep: number | null;
  schedule: PulseStep[];
  /** Variable order for the schedule's input assignment (MSB-first). */
  vars: string[];
  /** The input assignment the current schedule animates. */
  env: Record<string, boolean>;
}

const EMPTY: PulseContextValue = {
  activeStep: null,
  schedule: [],
  vars: [],
  env: {},
};

const PulseContext = createContext<PulseContextValue>(EMPTY);

/** Subscribe to the active pulse. Returns the empty value (no active step) when
 *  no provider is mounted, so a representation rendered outside a circuit pulse
 *  context is a no-op rather than a crash (F-02/F-04 acceptance criterion 8). */
export function usePulse(): PulseContextValue {
  return useContext(PulseContext);
}

/** True when this node has been lit by the pulse so far — i.e. the signal has
 *  already reached it. The pulse is CUMULATIVE: a node that the front has passed
 *  stays lit (it does not dim when the next node lights). A node is lit when it
 *  appears at any step index ≤ the active step. Returns false when no pulse is
 *  running so the canvas is dark at rest. */
export function isNodeLit(
  ctx: PulseContextValue,
  nodeId: string,
): boolean {
  if (ctx.activeStep === null) return false;
  for (let i = 0; i <= ctx.activeStep; i++) {
    if (ctx.schedule[i]?.nodeId === nodeId) return true;
  }
  return false;
}

export function PulseProvider({
  value,
  children,
}: {
  value: PulseContextValue;
  children: ReactNode;
}): ReactNode {
  return <PulseContext.Provider value={value}>{children}</PulseContext.Provider>;
}

/** Build a context value from a schedule + active index (producer-side helper). */
export function pulseValue(
  schedule: PulseSchedule | null,
  activeStep: number | null,
): PulseContextValue {
  if (!schedule) return EMPTY;
  return { activeStep, schedule: schedule.steps, vars: schedule.vars, env: schedule.env };
}
