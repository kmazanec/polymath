import type { ReactElement } from 'react';

export type GateShapeKind = 'AND' | 'OR' | 'NOT' | 'NAND' | 'NOR';

/** Canonical ANSI distinctive-shape gate symbols. Drawn in a 100x70 viewBox.
 *  The inversion bubble (a small circle at the output) is the reusable "NOT" token:
 *  NAND = AND + bubble, NOR = OR + bubble, NOT = triangle + bubble. */
function bodyPath(kind: GateShapeKind): string {
  switch (kind) {
    case 'AND':  return 'M18 8 H48 A27 27 0 0 1 48 62 H18 Z';
    case 'NAND': return 'M18 8 H44 A27 27 0 0 1 44 62 H18 Z';
    case 'OR':   return 'M16 8 Q40 35 16 62 Q52 62 80 35 Q52 8 16 8 Z';
    case 'NOR':  return 'M16 8 Q40 35 16 62 Q50 62 76 35 Q50 8 16 8 Z';
    case 'NOT':  return 'M20 8 L20 62 L70 35 Z';
  }
}
function bubbleCx(kind: GateShapeKind): number | null {
  switch (kind) { case 'NOT': return 76; case 'NAND': return 78; case 'NOR': return 84; default: return null; }
}

export function GateShape({ kind, live = false }: { kind: GateShapeKind; live?: boolean }): ReactElement {
  const cx = bubbleCx(kind);
  return (
    <svg viewBox="0 0 100 70" data-gate-shape={kind} className="gate-shape" style={{ overflow: 'visible' }}>
      <path d={bodyPath(kind)} className="gate-shape__body" data-live={live} />
      {cx !== null && <circle cx={cx} cy="35" r="6" className="gate-shape__bubble" data-bubble data-live={live} />}
    </svg>
  );
}
