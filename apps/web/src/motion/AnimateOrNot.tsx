import { type ReactNode, useEffect, useState } from 'react';
import type { PhaseName } from '@polymath/contract';

/**
 * Motion-budget wrapper (ADR-008 / ADR-004). Centralises the rule that animation
 * is suppressed (a) during transfer probes — the interface refuses to draw
 * attention away from the held-out assessment — and (b) when the user prefers
 * reduced motion. F-01 ships the gating logic; the actual animation primitives
 * (Framer/View Transitions/PulseRenderer) plug in with F-02/F-03.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function shouldAnimate(phase: PhaseName, reducedMotion: boolean): boolean {
  if (reducedMotion) return false;
  if (phase === 'transferring') return false;
  return true;
}

interface AnimateOrNotProps {
  phase: PhaseName;
  children: ReactNode;
}

export function AnimateOrNot({ phase, children }: AnimateOrNotProps): ReactNode {
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (): void => setReduced(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const animate = shouldAnimate(phase, reduced);
  return (
    <div data-animate={animate} data-phase={phase}>
      {children}
    </div>
  );
}
