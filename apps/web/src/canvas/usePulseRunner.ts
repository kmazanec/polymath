import { useCallback, useEffect, useRef, useState } from 'react';
import type { PulseSchedule } from './circuitModel.js';

/**
 * Drives the pulse animation: advances `activeStep` through a schedule on a
 * timer (continuous mode) or one step per call (reduced-motion step-through).
 * Kept as a hook separate from the react-flow view so the timing/step logic is
 * unit-testable without a canvas.
 *
 * Total propagation is spread across 600–1200ms (ADR-004): the per-step interval
 * is `total / steps`, clamped so very small circuits still read as a deliberate
 * pulse rather than an instant flash.
 */
const TOTAL_MS = 900; // mid-band of the 600–1200ms budget
const MIN_STEP_MS = 150;

export interface PulseRunner {
  /** Index into the schedule's steps, or null when idle. */
  activeStep: number | null;
  /** True while a continuous pulse is mid-flight. */
  running: boolean;
  /** Begin a continuous pulse for the given schedule (one pulse per call). */
  start: (schedule: PulseSchedule) => void;
  /** Reduced-motion: advance exactly one step; returns the new step or null when
   *  the sequence is complete (then it resets to idle on the next call). */
  step: (schedule: PulseSchedule) => void;
  /** The schedule currently loaded for step-through, if any. */
  current: PulseSchedule | null;
  /** A human-readable announcement for the active step (screen-reader live region). */
  announcement: string;
}

function describeStep(schedule: PulseSchedule, index: number): string {
  const s = schedule.steps[index];
  if (!s) return '';
  return `Step ${index + 1} of ${schedule.steps.length}: node ${s.nodeId} evaluates to ${s.value ? 'true' : 'false'}.`;
}

export function usePulseRunner(): PulseRunner {
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<PulseSchedule | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const start = useCallback(
    (schedule: PulseSchedule) => {
      clearTimers();
      setCurrent(schedule);
      const n = schedule.steps.length;
      if (n === 0) {
        setActiveStep(null);
        setRunning(false);
        return;
      }
      setRunning(true);
      const interval = Math.max(MIN_STEP_MS, Math.round(TOTAL_MS / n));
      for (let i = 0; i < n; i++) {
        timers.current.push(
          setTimeout(() => {
            setActiveStep(i);
            setAnnouncement(describeStep(schedule, i));
          }, interval * i),
        );
      }
      // After the last step, hold briefly then go idle.
      timers.current.push(
        setTimeout(() => {
          setActiveStep(null);
          setRunning(false);
        }, interval * n + interval),
      );
    },
    [clearTimers],
  );

  const step = useCallback((schedule: PulseSchedule) => {
    setCurrent(schedule);
    setActiveStep((prev) => {
      const next = prev === null ? 0 : prev + 1;
      if (next >= schedule.steps.length) {
        setAnnouncement('Pulse complete.');
        return null;
      }
      setAnnouncement(describeStep(schedule, next));
      return next;
    });
  }, []);

  return { activeStep, running, start, step, current, announcement };
}
