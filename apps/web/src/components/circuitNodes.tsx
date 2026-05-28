import type { ReactElement } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

/**
 * Custom react-flow node types for the circuit canvas. The pulse highlights the
 * active node with a blue fill + thick border (color-blind-safe: intensity +
 * shape, never red/green — ADR-004 / acceptance criterion 10). The `active` flag
 * is set by the PulseRenderer as the schedule advances.
 */

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

export function InputNode({ data }: NodeProps): ReactElement {
  const active = Boolean((data as { active?: boolean }).active);
  return (
    <div style={activeStyle(active)} data-node="input" data-active={active}>
      {String((data as { name?: string }).name ?? '?')}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function GateNode({ data }: NodeProps): ReactElement {
  const d = data as { gate?: string; active?: boolean };
  const active = Boolean(d.active);
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

export function OutputNode({ data }: NodeProps): ReactElement {
  const active = Boolean((data as { active?: boolean }).active);
  return (
    <div style={activeStyle(active)} data-node="output" data-active={active}>
      <Handle type="target" position={Position.Left} id="a" />
      OUT
    </div>
  );
}
