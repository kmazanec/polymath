import type { ReactElement } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { nodeLitState, usePulse } from '../canvas/PulseContext.js';
import { GateShape, type GateShapeKind } from './gateShapes.js';

/**
 * Custom react-flow node types for the circuit canvas. The pulse highlights the
 * active node with a blue fill + thick border (color-blind-safe: intensity +
 * shape, never red/green — ADR-004 / acceptance criterion 10). Each node reads
 * the active step from PulseContext itself and compares its own id — so a pulse
 * tick re-renders only the node that changed, not the whole node array (the
 * parent does not rebuild every node's `data` per tick).
 */

/** The node's pulse color state: 'idle' (not reached), 'high' (carries a true
 *  signal → glows), or 'low' (reached but false). This is CUMULATIVE and follows
 *  the LOGIC — a node only glows when it actually carries a 1 for the chosen
 *  inputs. Each node reads the context itself, so a tick re-renders only the
 *  nodes whose state flipped, not the whole array. */
function useLitState(nodeId: string): 'idle' | 'high' | 'low' {
  const ctx = usePulse();
  return nodeLitState(ctx, nodeId);
}

export function InputNode({ id, data }: NodeProps): ReactElement {
  const litState = useLitState(id);
  // Inputs carry a learner-chosen value (change 7). It's shown as a small badge
  // and toggled in the parent — here we just reflect it for the pulse semantics.
  const d = data as { name?: string; value?: boolean; onToggle?: () => void };
  const hasValue = typeof d.value === 'boolean';
  return (
    <div
      className="rf-node rf-node--io"
      data-node="input"
      data-active={litState === 'high'}
      data-lit={litState}
      data-value={hasValue ? (d.value ? '1' : '0') : undefined}
    >
      <span className="rf-node__label">{String(d.name ?? '?')}</span>
      {hasValue && (
        <button
          type="button"
          className="rf-input-toggle"
          data-value={d.value ? '1' : '0'}
          onClick={(e) => {
            e.stopPropagation();
            d.onToggle?.();
          }}
          // The node itself is draggable; stop the pointer from starting a drag
          // when the learner is toggling the input value.
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`Input ${d.name ?? ''} is ${d.value ? '1' : '0'} — tap to toggle`}
        >
          {d.value ? '1' : '0'}
        </button>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function GateNode({ id, data }: NodeProps): ReactElement {
  const d = data as { gate?: string; onDelete?: () => void };
  const litState = useLitState(id);
  const isNot = d.gate === 'NOT';
  return (
    <div
      className="rf-node rf-node--gate"
      data-node="gate"
      data-gate={d.gate}
      data-active={litState === 'high'}
      data-lit={litState}
      style={{ width: 51, height: 37 }}
    >
      <Handle type="target" position={Position.Left} id="a" style={{ top: isNot ? '50%' : '30%' }} />
      {!isNot && <Handle type="target" position={Position.Left} id="b" style={{ top: '70%' }} />}
      {/* The gate body glows only when the gate OUTPUTS a true (high) signal. */}
      <GateShape kind={(d.gate as GateShapeKind) ?? 'AND'} live={litState === 'high'} />
      <Handle type="source" position={Position.Right} />
      {/* Change 5: remove this gate from the board. Sits at the corner; stop the
          pointer so tapping ✕ never starts a node drag. */}
      {d.onDelete && (
        <button
          type="button"
          className="rf-gate-delete"
          onClick={(e) => {
            e.stopPropagation();
            d.onDelete?.();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`Remove ${d.gate ?? ''} gate`}
          title="Remove gate"
        >
          ×
        </button>
      )}
    </div>
  );
}

export function OutputNode({ id }: NodeProps): ReactElement {
  const litState = useLitState(id);
  return (
    <div
      className="rf-node rf-node--io"
      data-node="output"
      data-active={litState === 'high'}
      data-lit={litState}
    >
      <Handle type="target" position={Position.Left} id="a" />
      OUT
    </div>
  );
}
