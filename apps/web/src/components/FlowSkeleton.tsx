/**
 * F-31 — Flow skeleton sidebar rail.
 *
 * VIEW-ONLY: reads `LESSON_PHASES` from the statechart and the live `PhaseName`
 * from App state; never writes to the spine or triggers any side effects.
 *
 * Display model (D8 — curated mainline + branches):
 *   Mainline:  introducing → practicing → assessed → mastered
 *   Branches:  hint / transferring / remediating
 *
 * "Completed" = furthest-mainline-phase reached (monotonic). A dip from `hint`
 * back to `practicing` never un-completes `practicing` — the rail is a stable
 * orientation aid, not a progress bar.
 *
 * Semantics: <nav aria-label> + role="list" + aria-current="step" on the live phase.
 * NEVER role="progressbar" (no "N of 7", no linear-path implication — ADR-015).
 *
 * Reduced-motion + contrast: highlight transitions go through the existing
 * `@media (prefers-reduced-motion)` block in global.css.
 */
import type { ReactElement } from 'react';
import type { PhaseName } from '@polymath/contract';

/** Ordered mainline phases — the non-branching spine the skeleton displays. */
export const MAINLINE: readonly PhaseName[] = [
  'introducing',
  'practicing',
  'assessed',
  'mastered',
] as const;

/** Branch phases that appear as an "active detour" marker, not mainline steps. */
export const BRANCH_PHASES: ReadonlySet<PhaseName> = new Set<PhaseName>([
  'hint',
  'transferring',
  'remediating',
]);

/** Human-readable label for each phase shown in the skeleton. */
const PHASE_LABEL: Record<PhaseName, string> = {
  introducing:  'Introduction',
  practicing:   'Practice',
  hint:         'Getting a hint',
  transferring: 'Transfer check',
  assessed:     'Assessment',
  mastered:     'Mastered',
  remediating:  'Extra practice',
};

/** Returns the furthest mainline phase that has been reached (monotonic). */
function furthestMainlineIndex(phase: PhaseName): number {
  const idx = MAINLINE.indexOf(phase);
  // If the current phase is a branch, find the mainline step it hangs off:
  // hint/remediating hang off practicing (idx=1), transferring hangs off assessed (idx=2).
  if (idx !== -1) return idx;
  if (phase === 'hint' || phase === 'remediating') return 1; // practicing
  if (phase === 'transferring') return 2; // assessed
  return 0;
}

export interface FlowSkeletonProps {
  /** The current live phase from the XState spine. */
  phase: PhaseName;
  /**
   * The full set of phases the skeleton may show. Defaults to MAINLINE.
   * F-31 spec frozen contract: `phases?: readonly PhaseName[]`
   */
  phases?: readonly PhaseName[];
}

export function FlowSkeleton({ phase, phases = MAINLINE }: FlowSkeletonProps): ReactElement {
  const isBranch = BRANCH_PHASES.has(phase);
  const mainlineReached = furthestMainlineIndex(phase);

  return (
    <nav
      className="flow-skeleton"
      aria-label="Lesson progress"
      data-testid="flow-skeleton"
    >
      <ul className="flow-skeleton__list" role="list">
        {(phases as PhaseName[]).map((p, i) => {
          const isLive = p === phase;
          const isCompleted = i < mainlineReached;
          // The mainline step we're AT (but currently on a branch) counts as "in progress"
          const isCurrentMainline = !isBranch && isLive;
          const isBranchParent = isBranch && i === mainlineReached;

          return (
            <li
              key={p}
              className={[
                'flow-skeleton__step',
                isLive || isBranchParent ? 'flow-skeleton__step--active' : '',
                isCompleted ? 'flow-skeleton__step--completed' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-current={isCurrentMainline || (isBranch && isBranchParent) ? 'step' : undefined}
              data-phase={p}
            >
              <span className="flow-skeleton__dot" aria-hidden="true" />
              <span className="flow-skeleton__label">{PHASE_LABEL[p]}</span>

              {/* Branch marker: shown inline when the current phase is a branch off this step */}
              {isBranchParent && (
                <span
                  className="flow-skeleton__branch"
                  data-testid="flow-skeleton-branch"
                  aria-label={`Currently: ${PHASE_LABEL[phase]}`}
                >
                  {PHASE_LABEL[phase]}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
