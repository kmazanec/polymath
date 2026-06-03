import {
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
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

  // Change 7: the learner chooses each input's value (A, B, …) so they can watch
  // the same circuit behave differently across input combinations. Defaults to
  // all-true (the original pulse env). Toggling a value re-runs nothing on its
  // own — it just changes what the next "Test it" pulse propagates — but it does
  // clear the currently-lit path so the canvas isn't showing a stale assignment.
  const [inputValues, setInputValues] = useState<Record<string, boolean>>({});
  // Seed/extend the value map whenever the input variables change. Preserve any
  // value the learner already picked for a still-present variable.
  useEffect(() => {
    setInputValues((prev) => {
      const next: Record<string, boolean> = {};
      for (const v of inputVars) next[v] = prev[v] ?? true;
      return next;
    });
  }, [inputVars]);

  const [verdict, setVerdict] = useState<'correct' | 'incorrect' | null>(null);
  const [failing, setFailing] = useState<Record<string, boolean> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pulse = usePulseRunner();

  const toggleInput = useCallback(
    (name: string) => {
      setInputValues((prev) => ({ ...prev, [name]: !(prev[name] ?? true) }));
      // The lit path was computed for the old assignment — clear it.
      pulse.reset();
    },
    [pulse],
  );

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
  // Per-instance gate-id counter — keeps node ids unique within this workspace
  // without leaking a shared module-level counter across mounts/instances.
  const seqRef = useRef(0);
  const { screenToFlowPosition } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);

  const onConnect = useCallback(
    (c: Connection) => {
      setEdges((eds) => addEdge(c, eds));
      pulse.reset();
    },
    [setEdges, pulse],
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
      pulse.reset();
    },
    [setEdges, pulse],
  );

  // R2-5: "Clear wires" — start the wiring over without touching placed gates.
  const clearWires = useCallback(() => {
    setEdges([]);
    setVerdict(null);
    setFailing(null);
    setError(null);
    pulse.reset();
  }, [setEdges, pulse]);

  const addGate = useCallback(
    (gate: GateKind, position?: { x: number; y: number }) => {
      // BUG-06 fix: stagger each new gate so multiple gates never spawn on top of
      // each other (the old `{ x: 200, y: 40 + ns.length * 20 }` put every gate at
      // the same x with only a 20px y-step — and counted the fixed A/B/OUT nodes —
      // so 2+ gates piled into one illegible overlapping blob). Use the per-instance
      // gate counter (`seqRef`, which only ever counts gates) to lay them out in a
      // tidy column between the input column (x≈0) and the output (x=400), wrapping
      // to a second column after a few so they stay inside the canvas. Gates are
      // ~80px tall, so the vertical step is 100px (no overlap).
      // Change 6: when dropped from the palette, `position` is the flow-coords
      // drop point — place the gate exactly where the learner let go.
      const gateIndex = seqRef.current++;
      const id = `g-${gateIndex}`;
      const col = Math.floor(gateIndex / 3);
      const row = gateIndex % 3;
      const pos = position ?? { x: 180 + col * 90, y: 20 + row * 100 };
      setNodes((ns) => [...ns, { id, type: 'gate', position: pos, data: { gate } }]);
      // A new gate changes the topology — clear any stale verdict + lit path.
      setVerdict(null);
      setFailing(null);
      setError(null);
      pulse.reset();
    },
    [setNodes, pulse],
  );

  // Change 5: remove a placed gate. Drops the gate node AND every wire touching
  // it (an orphaned edge would otherwise dangle / mis-evaluate). Mirrors the
  // touch-friendly onEdgeClick removal — a ✕ affordance on the gate body.
  const deleteGate = useCallback(
    (id: string) => {
      setNodes((ns) => ns.filter((n) => n.id !== id));
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      setVerdict(null);
      setFailing(null);
      setError(null);
      pulse.reset();
    },
    [setNodes, setEdges, pulse],
  );

  // Change 6: drag a gate from the palette and drop it onto the canvas. The
  // palette button sets the gate kind on the dataTransfer; the canvas accepts the
  // drop and places the gate at the (screen→flow) drop point. Click-to-add stays
  // as the keyboard/fallback path, so this is purely additive.
  const onPaletteDragStart = useCallback((event: ReactDragEvent, gate: GateKind) => {
    event.dataTransfer.setData('application/polymath-gate', gate);
    event.dataTransfer.effectAllowed = 'copy';
  }, []);

  const onCanvasDragOver = useCallback((event: ReactDragEvent) => {
    if (event.dataTransfer.types.includes('application/polymath-gate')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const onCanvasDrop = useCallback(
    (event: ReactDragEvent) => {
      const raw = event.dataTransfer.getData('application/polymath-gate');
      if (!raw) return;
      event.preventDefault();
      const gate = raw as GateKind;
      // screenToFlowPosition maps the drop's client coords into canvas/flow
      // coords (accounting for pan + zoom) so the gate lands under the cursor.
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addGate(gate, position);
    },
    [screenToFlowPosition, addGate],
  );

  const runPulse = useCallback(() => {
    setError(null);
    const circuit = toCircuit(nodes, edges);
    const built = buildCircuit(circuit);
    if (!built.ok) {
      setError(built.message);
      return;
    }
    // Change 7: animate the learner's chosen input assignment (defaults all-true
    // until they toggle). This is what makes "watch the gate behave differently
    // for different inputs" work — the pulse env is the live inputValues map.
    const env: Record<string, boolean> = {};
    for (const v of inputVars) env[v] = inputValues[v] ?? true;
    const schedule = pulseSchedule(circuit, built, env);
    if (reduced) pulse.step(schedule);
    else pulse.start(schedule);
  }, [nodes, edges, inputVars, inputValues, reduced, pulse]);

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

  // The pulse lights every node the front has reached AND every wire it has
  // traversed — CUMULATIVELY. Each `PulseStep.fromEdges` names the edges feeding
  // the node lit at that step; we union the edges of EVERY step up to and
  // including the active one, so a wire the signal has already crossed stays lit
  // rather than dimming when the front moves on. Cleared on a new run / circuit
  // change (the runner resets activeStep to null).
  const activeEdgeKeys = useMemo(() => {
    const keys = new Set<string>();
    if (pulse.activeStep === null || !activeSchedule) return keys;
    for (let i = 0; i <= pulse.activeStep; i++) {
      const step = activeSchedule.steps[i];
      if (!step) continue;
      for (const e of step.fromEdges) keys.add(`${e.source}->${e.target}`);
    }
    return keys;
  }, [activeSchedule, pulse.activeStep]);

  const renderedEdges = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        animated: activeEdgeKeys.has(`${e.source}->${e.target}`),
      })),
    [edges, activeEdgeKeys],
  );

  // Decorate the live nodes with per-render interaction data WITHOUT mutating the
  // topology state `toCircuit` reads: inputs get their learner-chosen value + a
  // toggle (change 7); gates get a delete handler (change 5). Same pattern as
  // renderedEdges — derived, not stored.
  const renderedNodes = useMemo(
    () =>
      nodes.map((n) => {
        if (n.type === 'input') {
          const name = String(n.data?.name ?? n.id);
          return {
            ...n,
            data: { ...n.data, value: inputValues[name] ?? true, onToggle: () => toggleInput(name) },
          };
        }
        if (n.type === 'gate') {
          return { ...n, data: { ...n.data, onDelete: () => deleteGate(n.id) } };
        }
        return n;
      }),
    [nodes, inputValues, toggleInput, deleteGate],
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
              <button
                key={g}
                type="button"
                onClick={() => addGate(g)}
                draggable
                onDragStart={(e) => onPaletteDragStart(e, g)}
                data-gate={g}
                title={`Click to add, or drag onto the board, a ${g} gate`}
              >
                <GateShape kind={g} />
                Add {g} gate
              </button>
            ))}
        </div>

        <div
          ref={canvasRef}
          className="circuit-canvas"
          style={{ height: 320 }}
          onDragOver={onCanvasDragOver}
          onDrop={onCanvasDrop}
        >
          {/* `renderedNodes` decorates each node per render (input value+toggle,
              gate delete handler) without mutating the topology state toCircuit
              reads. Each node component still reads the active pulse step from
              PulseContext itself, so a pulse tick re-renders only the lit nodes,
              not the whole array. Edges are likewise remapped each step
              (`renderedEdges` lights the cumulative traversed path). */}
          <ReactFlow
            nodes={renderedNodes}
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
