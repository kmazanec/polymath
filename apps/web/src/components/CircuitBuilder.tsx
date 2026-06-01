import { type MouseEvent as ReactMouseEvent, type ReactElement, useCallback, useMemo, useRef, useState } from 'react';
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
import { GateShape } from './gateShapes.js';

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

  // R2-5: tap an existing wire to remove it. iPad has no keyboard, so the
  // desktop Backspace/Delete-on-selected-edge path (onEdgesChange) is
  // unreachable on touch — onEdgeClick deletes the tapped edge directly, which
  // is the most touch-friendly affordance. Both paths mutate the SAME `edges`
  // state that toCircuit(nodes, edges) reads, so the circuit re-evaluates on the
  // next Test it / Submit. We stop the click so React Flow's own
  // select-the-edge default doesn't fight the removal.
  const onEdgeClick = useCallback(
    (event: ReactMouseEvent, edge: Edge) => {
      event.stopPropagation();
      setEdges((eds) => eds.filter((e) => e.id !== edge.id));
      // Clearing a wire invalidates the last verdict — the circuit changed.
      setVerdict(null);
      setFailing(null);
      setError(null);
    },
    [setEdges],
  );

  // R2-5: "Clear wires" — start the wiring over without touching placed gates.
  const clearWires = useCallback(() => {
    setEdges([]);
    setVerdict(null);
    setFailing(null);
    setError(null);
  }, [setEdges]);

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

  // The pulse lights the active node (via data-active) AND its incoming wires.
  // `PulseStep.fromEdges` names the edges feeding the node lit this step; we
  // decorate exactly those react-flow edges with `animated: true` so the
  // signal-green edge CSS fires only on the active propagation front.
  const activeEdgeKeys = useMemo(() => {
    const step =
      pulse.activeStep !== null ? activeSchedule?.steps[pulse.activeStep] : undefined;
    if (!step) return new Set<string>();
    return new Set(step.fromEdges.map((e) => `${e.source}->${e.target}`));
  }, [activeSchedule, pulse.activeStep]);

  const renderedEdges = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        animated: activeEdgeKeys.has(`${e.source}->${e.target}`),
      })),
    [edges, activeEdgeKeys],
  );

  return (
    <PulseProvider value={ctx}>
      <section
        className="circuit-builder"
        data-verdict={verdict ?? undefined}
        aria-label={`Build a circuit for ${spec.targetExpression}`}
        aria-describedby={spec.prompt ? 'cb-prompt' : undefined}
      >
        {/* F-27 AC#7: grounding prompt */}
        {spec.prompt && (
          <p id="cb-prompt" className="item-prompt">{spec.prompt}</p>
        )}
        <div className="circuit-palette" role="toolbar" aria-label="Gate palette">
          {spec.allowedGates
            .filter(
              (g): g is GateKind =>
                g === 'AND' || g === 'OR' || g === 'NOT' || g === 'NAND' || g === 'NOR',
            )
            .map((g) => (
              <button key={g} type="button" onClick={() => addGate(g)} data-gate={g}>
                <GateShape kind={g} />
                Add {g} gate
              </button>
            ))}
        </div>

        <div className="circuit-canvas" style={{ height: 320 }}>
          {/* Nodes are passed by stable reference; each node component reads the
              active pulse step from PulseContext itself, so a pulse tick re-renders
              only the lit node, not the whole node array. Edges, by contrast, ARE
              remapped each pulse step (`renderedEdges` decorates the active-path wires
              with `animated:true` from the step's `fromEdges`) — cheap for these small
              teaching circuits, and the wire animation is the point. */}
          <ReactFlow
            nodes={nodes}
            edges={renderedEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onEdgeClick={onEdgeClick}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
          </ReactFlow>
        </div>

        <div className="circuit-controls">
          {/* "Test it" / "Next gate" is a secondary preview action — ghost style. */}
          <button type="button" className="btn btn--ghost" onClick={runPulse} data-action="test-it">
            {reduced ? 'Next gate →' : 'Test it'}
          </button>
          {/* R2-5: touch-friendly wire reset. Tapping a single wire removes it
              (onEdgeClick); this clears them all to start the wiring over. */}
          <button
            type="button"
            className="btn btn--ghost"
            onClick={clearWires}
            data-action="clear-wires"
            disabled={edges.length === 0}
          >
            Clear wires
          </button>
          {/* Submit is the primary completion action — filled accent pill. */}
          <button type="button" className="btn btn--primary" onClick={submit} data-action="submit">
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
