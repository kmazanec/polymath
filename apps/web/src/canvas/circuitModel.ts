import { type Ast, evaluate, variables } from '@polymath/booleans';

/**
 * Pure circuit model: the topology the learner builds on the react-flow canvas,
 * independent of any rendering. A circuit is input source nodes + gate nodes +
 * one output sink, wired by edges. This module turns that topology into a
 * Boolean `Ast` (the truth-maker, handed to `@polymath/booleans.equivalent`) and
 * into a deterministic propagation `schedule` for the pulse animation.
 *
 * Kept rendering-free so it is unit-testable without a DOM and so the pulse
 * schedule's determinism (acceptance criterion 4) is a pure-function property.
 */

// Additive gate alphabet (ADR-012 stretch). NAND (L3) and NOR (L4-if-used) join
// the original AND/OR/NOT. Web-internal type, NOT the cross-package contract.
export type GateKind = 'AND' | 'OR' | 'NOT' | 'NAND' | 'NOR';

export type CircuitNode =
  | { id: string; type: 'input'; name: string }
  | { id: string; type: 'gate'; gate: GateKind }
  | { id: string; type: 'output' };

export interface CircuitEdge {
  /** Source node id. */
  source: string;
  /** Target node id. */
  target: string;
  /** Target input port: gates have ordered ports (NOT uses only 'a'). */
  targetPort: 'a' | 'b';
}

export interface Circuit {
  nodes: CircuitNode[];
  edges: CircuitEdge[];
}

/** A circuit that cannot be evaluated, reported to the learner as stock copy
 *  rather than thrown as a JS exception (acceptance criterion 7). */
export interface CircuitError {
  ok: false;
  reason: 'output_unwired' | 'cycle' | 'missing_input' | 'too_many_variables';
  message: string;
}

export interface CircuitOk {
  ok: true;
  ast: Ast;
  /** Gate/output node ids in topological (evaluation) order. */
  order: string[];
}

export type CircuitBuildResult = CircuitOk | CircuitError;

/** L1 expressions are ≤3 vars; cap well below the 2^n cliff (F-01 build note). */
const MAX_VARIABLES = 10;

/** The two-input gate kinds (everything except the unary NOT). */
type BinaryGateKind = Exclude<GateKind, 'NOT'>;

/** Build the AST for a two-input gate. Exhaustive over BinaryGateKind so adding
 *  a gate to GateKind without handling it here is a compile error. */
function binaryGateAst(gate: BinaryGateKind, left: Ast, right: Ast): Ast {
  switch (gate) {
    case 'AND':
      return { kind: 'and', left, right };
    case 'OR':
      return { kind: 'or', left, right };
    case 'NAND':
      return { kind: 'nand', left, right };
    case 'NOR':
      return { kind: 'nor', left, right };
  }
}

/** Evaluate a two-input gate's boolean output. Exhaustive over BinaryGateKind. */
function binaryGateValue(gate: BinaryGateKind, a: boolean, b: boolean): boolean {
  switch (gate) {
    case 'AND':
      return a && b;
    case 'OR':
      return a || b;
    case 'NAND':
      return !(a && b);
    case 'NOR':
      return !(a || b);
  }
}

/** Human-readable infix operator word for a two-input gate's a11y label. */
function binaryGateWord(gate: BinaryGateKind): string {
  switch (gate) {
    case 'AND':
      return 'and';
    case 'OR':
      return 'or';
    case 'NAND':
      return 'nand';
    case 'NOR':
      return 'nor';
  }
}

function incomingByPort(edges: CircuitEdge[], nodeId: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of edges) {
    if (e.target === nodeId) m.set(e.targetPort, e.source);
  }
  return m;
}

/**
 * Build the Boolean AST the circuit computes at its output, plus the topological
 * evaluation order. Returns a typed error (never throws) for the malformed cases
 * the UI must surface gracefully.
 */
export function buildCircuit(circuit: Circuit): CircuitBuildResult {
  const byId = new Map<string, CircuitNode>();
  for (const n of circuit.nodes) byId.set(n.id, n);

  const output = circuit.nodes.find((n) => n.type === 'output');
  if (!output) {
    return { ok: false, reason: 'output_unwired', message: 'Add an output and wire it first.' };
  }

  const order: string[] = [];
  const building = new Set<string>();
  const built = new Map<string, Ast>();

  const resolve = (nodeId: string): Ast | CircuitError => {
    const cached = built.get(nodeId);
    if (cached) return cached;
    if (building.has(nodeId)) {
      return { ok: false, reason: 'cycle', message: 'Your wiring loops back on itself — remove the cycle.' };
    }
    const node = byId.get(nodeId);
    if (!node) {
      return { ok: false, reason: 'output_unwired', message: 'Wire every gate input before testing.' };
    }
    if (node.type === 'input') {
      const ast: Ast = { kind: 'var', name: node.name };
      built.set(nodeId, ast);
      return ast;
    }

    building.add(nodeId);
    const incoming = incomingByPort(circuit.edges, nodeId);

    if (node.type === 'output') {
      const src = incoming.get('a');
      if (!src) {
        building.delete(nodeId);
        return { ok: false, reason: 'output_unwired', message: 'The output is not wired — connect a gate to it.' };
      }
      const inner = resolve(src);
      if ('ok' in inner) return inner;
      building.delete(nodeId);
      order.push(nodeId);
      built.set(nodeId, inner);
      return inner;
    }

    // gate
    const a = incoming.get('a');
    if (!a) {
      building.delete(nodeId);
      return { ok: false, reason: 'output_unwired', message: 'A gate input is unwired — connect every input.' };
    }
    const left = resolve(a);
    if ('ok' in left) return left;

    if (node.gate === 'NOT') {
      building.delete(nodeId);
      order.push(nodeId);
      const ast: Ast = { kind: 'not', operand: left };
      built.set(nodeId, ast);
      return ast;
    }

    const b = incoming.get('b');
    if (!b) {
      building.delete(nodeId);
      return { ok: false, reason: 'output_unwired', message: 'A gate input is unwired — connect every input.' };
    }
    const right = resolve(b);
    if ('ok' in right) return right;

    building.delete(nodeId);
    order.push(nodeId);
    const ast: Ast = binaryGateAst(node.gate, left, right);
    built.set(nodeId, ast);
    return ast;
  };

  const result = resolve(output.id);
  if ('ok' in result) return result;

  if (variables(result).length > MAX_VARIABLES) {
    return {
      ok: false,
      reason: 'too_many_variables',
      message: `Too many distinct inputs (max ${MAX_VARIABLES}).`,
    };
  }

  return { ok: true, ast: result, order };
}

/** One animation beat: a node lights up with its computed value for the current
 *  input assignment. Consumed by the PulseRenderer and by F-02/F-04 subscribers. */
export interface PulseStep {
  nodeId: string;
  /** The boolean value latched at this node for the active input assignment. */
  value: boolean;
  /** Edge ids (source→target) that animate into this node, for the renderer. */
  fromEdges: { source: string; target: string }[];
  /** Screen-reader sentence in gate semantics, e.g.
   *  "AND gate evaluates: true and false equals false." (acceptance criterion 11). */
  label: string;
}

/** The full pulse schedule + the input assignment it was computed for. */
export interface PulseSchedule {
  /** Variable names in @polymath/booleans sorted order (MSB-first table order). */
  vars: string[];
  /** The input assignment this schedule animates. */
  env: Record<string, boolean>;
  steps: PulseStep[];
}

/**
 * Compute the deterministic pulse schedule for a built circuit at one input
 * assignment. Deterministic given (circuit, env): the same topology + inputs
 * always yields the identical step array (acceptance criterion 4) because it
 * walks the fixed topological `order`.
 */
export function pulseSchedule(
  circuit: Circuit,
  built: CircuitOk,
  env: Record<string, boolean>,
): PulseSchedule {
  const byId = new Map<string, CircuitNode>();
  for (const n of circuit.nodes) byId.set(n.id, n);

  // Index incoming edges once (O(E)) so per-node lookups during evaluation are
  // O(1) rather than re-scanning every edge per node.
  const incomingPorts = new Map<string, Map<string, string>>();
  const incomingEdges = new Map<string, { source: string; target: string }[]>();
  for (const e of circuit.edges) {
    let ports = incomingPorts.get(e.target);
    if (!ports) {
      ports = new Map();
      incomingPorts.set(e.target, ports);
    }
    ports.set(e.targetPort, e.source);
    const list = incomingEdges.get(e.target) ?? [];
    list.push({ source: e.source, target: e.target });
    incomingEdges.set(e.target, list);
  }

  // Evaluate each node by re-deriving it from the topological order, memoised in
  // `value`. `built` is the result of buildCircuit on this same circuit, so every
  // gate input is wired — but we still resolve missing sources to `false` rather
  // than assert non-null, so a stale/mismatched argument degrades to a safe value
  // instead of crashing.
  const value = new Map<string, boolean>();
  const valueOf = (nodeId: string | undefined): boolean => {
    if (nodeId === undefined) return false;
    const cached = value.get(nodeId);
    if (cached !== undefined) return cached;
    const node = byId.get(nodeId);
    if (!node) return false;
    if (node.type === 'input') {
      const v = env[node.name] ?? false;
      value.set(nodeId, v);
      return v;
    }
    const incoming = incomingPorts.get(nodeId);
    if (node.type === 'output') {
      const v = valueOf(incoming?.get('a'));
      value.set(nodeId, v);
      return v;
    }
    if (node.gate === 'NOT') {
      const v = !valueOf(incoming?.get('a'));
      value.set(nodeId, v);
      return v;
    }
    const a = valueOf(incoming?.get('a'));
    const b = valueOf(incoming?.get('b'));
    const v = binaryGateValue(node.gate, a, b);
    value.set(nodeId, v);
    return v;
  };

  const bool = (b: boolean): string => (b ? 'true' : 'false');
  const describe = (nodeId: string, value: boolean): string => {
    const node = byId.get(nodeId);
    if (!node) return '';
    if (node.type === 'input') return `Input ${node.name} is ${bool(value)}.`;
    if (node.type === 'output') return `Output latches ${bool(value)}.`;
    const ports = incomingPorts.get(nodeId);
    const a = valueOf(ports?.get('a'));
    if (node.gate === 'NOT') {
      return `NOT gate evaluates: not ${bool(a)} equals ${bool(value)}.`;
    }
    const b = valueOf(ports?.get('b'));
    const op = binaryGateWord(node.gate);
    return `${node.gate} gate evaluates: ${bool(a)} ${op} ${bool(b)} equals ${bool(value)}.`;
  };

  const steps: PulseStep[] = built.order.map((nodeId) => {
    const value = valueOf(nodeId);
    return {
      nodeId,
      value,
      fromEdges: incomingEdges.get(nodeId) ?? [],
      label: describe(nodeId, value),
    };
  });

  const vars = variables(built.ast);
  return { vars, env, steps };
}

/** Convenience: assert pulse output matches the validator for an assignment
 *  (used by the pulse-correctness test). */
export function outputValue(built: CircuitOk, env: Record<string, boolean>): boolean {
  return evaluate(built.ast, env);
}
