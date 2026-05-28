import { type ReactElement, useCallback, useMemo, useRef, useState } from 'react';
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ComponentSpec, Rep, RepSubmission } from '@polymath/contract';
import { BooleanParseError, parse, variables } from '@polymath/booleans';
import { prefersReducedMotion } from '../motion/AnimateOrNot.js';
import {
  type Circuit,
  type GateKind,
  buildCircuit,
  pulseSchedule,
} from '../canvas/circuitModel.js';
import { PulseProvider, pulseValue } from '../canvas/PulseContext.js';
import { usePulseRunner } from '../canvas/usePulseRunner.js';
import { evaluateSubmission } from '../canvas/circuitSubmission.js';
import { GateNode, InputNode, OutputNode } from './circuitNodes.js';

type CircuitSpec = Extract<ComponentSpec, { kind: 'CircuitBuilder' }>;

export interface CircuitBuilderProps {
  spec: CircuitSpec;
  /** Reps hidden during a transfer probe (F-07 supplies this). When this rep is
   *  hidden the workspace renders nothing — the pulse cannot be triggered. */
  hiddenReps?: Rep[];
  /** Dispatch a submit to the agent. Verdict is computed locally first. */
  onSubmit?: (payload: {
    submission: string;
    repSubmission: RepSubmission;
    correct: boolean;
  }) => void;
}

/** Distinct variables of the target expression, in @polymath/booleans order. */
function variablesOf(expr: string): string[] {
  try {
    return variables(parse(expr));
  } catch (e) {
    if (e instanceof BooleanParseError) return [];
    throw e;
  }
}

const nodeTypes = { input: InputNode, gate: GateNode, output: OutputNode };

/** Translate the react-flow node/edge state into the pure Circuit model. */
function toCircuit(nodes: Node[], edges: Edge[]): Circuit {
  const cNodes: Circuit['nodes'] = nodes.map((n) => {
    if (n.type === 'input') return { id: n.id, type: 'input', name: String(n.data?.name ?? n.id) };
    if (n.type === 'output') return { id: n.id, type: 'output' };
    return { id: n.id, type: 'gate', gate: (n.data?.gate as GateKind) ?? 'AND' };
  });
  const cEdges: Circuit['edges'] = edges.map((e) => ({
    source: e.source,
    target: e.target,
    targetPort: (e.targetHandle as 'a' | 'b') ?? 'a',
  }));
  return { nodes: cNodes, edges: cEdges };
}

function CircuitBuilderInner({ spec, onSubmit }: CircuitBuilderProps): ReactElement {
  // Read the media query once per mount — it's stable across a session and
  // matchMedia is a layout-touching call we don't want on every render.
  const reduced = useMemo(() => prefersReducedMotion(), []);
  const inputVars = useMemo(() => variablesOf(spec.targetExpression), [spec.targetExpression]);

  const initialNodes = useMemo<Node[]>(() => {
    const inputs: Node[] = inputVars.map((name, i) => ({
      id: `in-${name}`,
      type: 'input',
      position: { x: 0, y: i * 80 },
      data: { name },
    }));
    const output: Node = {
      id: 'out',
      type: 'output',
      position: { x: 400, y: 80 },
      data: {},
    };
    return [...inputs, output];
  }, [inputVars]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [verdict, setVerdict] = useState<'correct' | 'incorrect' | null>(null);
  const [failing, setFailing] = useState<Record<string, boolean> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pulse = usePulseRunner();
  // Per-instance gate-id counter — keeps node ids unique within this workspace
  // without leaking a shared module-level counter across mounts/instances.
  const seqRef = useRef(0);

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge(c, eds)),
    [setEdges],
  );

  const addGate = useCallback(
    (gate: GateKind) => {
      const id = `g-${seqRef.current++}`;
      setNodes((ns) => [
        ...ns,
        {
          id,
          type: 'gate',
          position: { x: 200, y: 40 + ns.length * 20 },
          data: { gate },
        },
      ]);
    },
    [setNodes],
  );

  const runPulse = useCallback(() => {
    setError(null);
    const circuit = toCircuit(nodes, edges);
    const built = buildCircuit(circuit);
    if (!built.ok) {
      setError(built.message);
      return;
    }
    // Animate the first input combination of the target's table.
    const env: Record<string, boolean> = {};
    for (const v of inputVars) env[v] = true;
    const schedule = pulseSchedule(circuit, built, env);
    if (reduced) pulse.step(schedule);
    else pulse.start(schedule);
  }, [nodes, edges, inputVars, reduced, pulse]);

  const submit = useCallback(() => {
    const circuit = toCircuit(nodes, edges);
    const result = evaluateSubmission(
      circuit,
      spec.targetExpression,
      nodes as unknown as Record<string, unknown>[],
      edges as unknown as Record<string, unknown>[],
    );
    if (!result.ok) {
      setError(result.message);
      setVerdict(null);
      setFailing(null);
      return;
    }
    setError(null);
    setVerdict(result.correct ? 'correct' : 'incorrect');
    setFailing(result.failingAssignment);
    onSubmit?.({
      submission: result.expression,
      repSubmission: result.repSubmission,
      correct: result.correct,
    });
  }, [nodes, edges, spec.targetExpression, onSubmit]);

  const activeSchedule = pulse.current;
  const ctx = pulseValue(activeSchedule, pulse.activeStep);

  return (
    <PulseProvider value={ctx}>
      <section
        className="circuit-builder"
        data-verdict={verdict ?? undefined}
        aria-label={`Build a circuit for ${spec.targetExpression}`}
      >
        <div className="circuit-palette" role="toolbar" aria-label="Gate palette">
          {spec.allowedGates
            .filter((g): g is GateKind => g === 'AND' || g === 'OR' || g === 'NOT')
            .map((g) => (
              <button key={g} type="button" onClick={() => addGate(g)} data-gate={g}>
                Add {g} gate
              </button>
            ))}
        </div>

        <div className="circuit-canvas" style={{ height: 320 }}>
          {/* Nodes are passed by stable reference; each node component reads the
              active pulse step from PulseContext itself, so a pulse tick
              re-renders only the lit node, not the whole array. */}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
          >
            <Background />
          </ReactFlow>
        </div>

        <div className="circuit-controls">
          <button type="button" onClick={runPulse} data-action="test-it">
            {reduced ? 'Next gate →' : 'Test it'}
          </button>
          <button type="button" onClick={submit} data-action="submit">
            Submit
          </button>
        </div>

        {error && (
          <p role="alert" className="circuit-error">
            {error}
          </p>
        )}
        {verdict && (
          <p data-verdict-text className="circuit-verdict">
            {verdict === 'correct'
              ? 'Correct — equivalent to the target.'
              : failing
                ? `Not equivalent yet — differs when ${Object.entries(failing)
                    .map(([k, v]) => `${k}=${v ? 'true' : 'false'}`)
                    .join(', ')}.`
                : 'Not equivalent yet.'}
          </p>
        )}

        {/* Screen-reader live region: announces each propagation step (AC11). */}
        <p aria-live="polite" className="visually-hidden" data-pulse-announce>
          {pulse.announcement}
        </p>
      </section>
    </PulseProvider>
  );
}

export function CircuitBuilder(props: CircuitBuilderProps): ReactElement | null {
  // Render nothing when the circuit rep is suppressed: either the spec doesn't
  // list it in visibleReps, or a transfer probe explicitly hides it (AC9). Both
  // are the probe-integrity boundary — a hidden rep must not be reachable.
  if (!props.spec.visibleReps.includes('circuit')) return null;
  if (props.hiddenReps?.includes('circuit')) return null;
  return (
    <ReactFlowProvider>
      <CircuitBuilderInner {...props} />
    </ReactFlowProvider>
  );
}
