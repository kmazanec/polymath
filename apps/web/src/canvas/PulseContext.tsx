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
  /** Value carried at every node (inputs + gates + output) for this assignment.
   *  HIGH/green coloring keys on this, so the lit signal follows the logic. */
  nodeValues: Record<string, boolean>;
}

const EMPTY: PulseContextValue = {
  activeStep: null,
  schedule: [],
  vars: [],
  env: {},
  nodeValues: {},
};

const PulseContext = createContext<PulseContextValue>(EMPTY);

/** Subscribe to the active pulse. Returns the empty value (no active step) when
 *  no provider is mounted, so a representation rendered outside a circuit pulse
 *  context is a no-op rather than a crash (F-02/F-04 acceptance criterion 8). */
export function usePulse(): PulseContextValue {
  return useContext(PulseContext);
}

/** True when the pulse has REACHED this node — the animation front has arrived
 *  and its value is now settled. The pulse is CUMULATIVE: a node the front has
 *  passed stays reached (it doesn't un-reach when the next node lights). Gates and
 *  the output appear as steps, so they're reached once their step index ≤ the
 *  active step. Inputs are NOT stepped (their value is known immediately), so an
 *  input is "reached" as soon as any pulse is running. Returns false at rest. */
export function isNodeReached(ctx: PulseContextValue, nodeId: string): boolean {
  if (ctx.activeStep === null) return false;
  // An input never appears in the step list; treat it as reached while running.
  const isStepped = ctx.schedule.some((s) => s.nodeId === nodeId);
  if (!isStepped) return true;
  for (let i = 0; i <= ctx.activeStep; i++) {
    if (ctx.schedule[i]?.nodeId === nodeId) return true;
  }
  return false;
}

/** True when this node carries a HIGH (true) signal for the active assignment. */
export function isNodeHigh(ctx: PulseContextValue, nodeId: string): boolean {
  return ctx.nodeValues[nodeId] === true;
}

/** The color state of a node for the renderer:
 *   - 'idle'  : the pulse hasn't reached it yet (or no pulse running)
 *   - 'high'  : reached AND carrying true → glows green (the "current")
 *   - 'low'   : reached but carrying false → evaluated, but not energized
 *  This is what makes the lit signal FOLLOW THE LOGIC: a wire/node only glows
 *  when it actually carries a 1 for the learner's chosen inputs. */
export function nodeLitState(
  ctx: PulseContextValue,
  nodeId: string,
): 'idle' | 'high' | 'low' {
  if (!isNodeReached(ctx, nodeId)) return 'idle';
  return isNodeHigh(ctx, nodeId) ? 'high' : 'low';
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
  return {
    activeStep,
    schedule: schedule.steps,
    vars: schedule.vars,
    env: schedule.env,
    nodeValues: schedule.nodeValues,
  };
}
