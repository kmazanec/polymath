import type { ReactElement } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { usePulse } from '../canvas/PulseContext.js';

/**
 * Custom react-flow node types for the circuit canvas. The pulse highlights the
 * active node with a blue fill + thick border (color-blind-safe: intensity +
 * shape, never red/green — ADR-004 / acceptance criterion 10). Each node reads
 * the active step from PulseContext itself and compares its own id — so a pulse
 * tick re-renders only the node that changed, not the whole node array (the
 * parent does not rebuild every node's `data` per tick).
 */

/** True when this node id is the one the pulse is currently lighting up. */
function useIsActive(nodeId: string): boolean {
  const { activeStep, schedule } = usePulse();
  return activeStep !== null && schedule[activeStep]?.nodeId === nodeId;
}

const activeStyle = (active: boolean): React.CSSProperties => ({
  borderWidth: active ? 3 : 1,
  borderStyle: 'solid',
  borderColor: active ? '#2563eb' /* blue-600 */ : '#9ca3af' /* gray-400 */,
  background: active ? '#dbeafe' /* blue-100 */ : '#f9fafb',
  borderRadius: 6,
  padding: '6px 10px',
  fontFamily: 'monospace',
  fontSize: 12,
});

export function InputNode({ id, data }: NodeProps): ReactElement {
  const active = useIsActive(id);
  return (
    <div style={activeStyle(active)} data-node="input" data-active={active}>
      {String((data as { name?: string }).name ?? '?')}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function GateNode({ id, data }: NodeProps): ReactElement {
  const d = data as { gate?: string };
  const active = useIsActive(id);
  const isNot = d.gate === 'NOT';
  return (
    <div style={activeStyle(active)} data-node="gate" data-gate={d.gate} data-active={active}>
      <Handle type="target" position={Position.Left} id="a" style={{ top: isNot ? '50%' : '30%' }} />
      {!isNot && <Handle type="target" position={Position.Left} id="b" style={{ top: '70%' }} />}
      {d.gate}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function OutputNode({ id }: NodeProps): ReactElement {
  const active = useIsActive(id);
  return (
    <div style={activeStyle(active)} data-node="output" data-active={active}>
      <Handle type="target" position={Position.Left} id="a" />
      OUT
    </div>
  );
}
