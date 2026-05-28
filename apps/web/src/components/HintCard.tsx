import type { ReactElement } from 'react';
import type { ComponentSpec } from '@polymath/contract';

type HintCardSpec = Extract<ComponentSpec, { kind: 'HintCard' }>;

/**
 * Renders a levelled hint card. Three visual levels, each progressively more
 * prominent (ADR-010 Layer 3):
 *   L1 — light touch: muted styling, small text.
 *   L2 — concrete:    medium weight, visible callout.
 *   L3 — deep:        prominent, visually distinct.
 */
export function HintCard({ spec }: { spec: HintCardSpec }): ReactElement {
  return (
    <aside
      className={`hint-card hint-card--level-${spec.level.toString()}`}
      data-level={spec.level}
      aria-label={`Level ${spec.level.toString()} hint`}
      role="note"
    >
      <span className="hint-card__label">
        {spec.level === 1 ? 'Hint' : spec.level === 2 ? 'Hint (more detail)' : 'Deep hint'}
      </span>
      <p className="hint-card__body">{spec.body}</p>
    </aside>
  );
}
