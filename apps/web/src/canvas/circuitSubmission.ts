import { equivalent, variables } from '@polymath/booleans';
import type { RepSubmission } from '@polymath/contract';
import { type Circuit, type CircuitError, buildCircuit } from './circuitModel.js';

/** Render the built AST back into a canonical Boolean expression string the
 *  validator (and the agent's logging) accepts. Parenthesised to preserve the
 *  exact tree the learner wired, independent of precedence. */
export function astToExpression(circuit: Circuit): string | null {
  const built = buildCircuit(circuit);
  if (!built.ok) return null;
  const render = (ast: typeof built.ast): string => {
    switch (ast.kind) {
      case 'var':
        return ast.name;
      case 'not':
        return `(NOT ${render(ast.operand)})`;
      case 'and':
        return `(${render(ast.left)} AND ${render(ast.right)})`;
      case 'or':
        return `(${render(ast.left)} OR ${render(ast.right)})`;
    }
  };
  return render(built.ast);
}

export interface CircuitVerdict {
  ok: true;
  correct: boolean;
  /** Canonical expression the circuit computes — the `submission` wire string. */
  expression: string;
  /** The optional rep-native submission payload (circuit branch). */
  repSubmission: Extract<RepSubmission, { rep: 'circuit' }>;
}

export type CircuitSubmission = CircuitVerdict | CircuitError;

/**
 * Decide a circuit submission against the target expression. Correctness is
 * computed CLIENT-SIDE via `@polymath/booleans.equivalent` (ADR-008: the verdict
 * the learner sees never round-trips through the agent). Returns the typed error
 * for malformed circuits so the UI shows stock copy, not a crash.
 */
export function evaluateSubmission(
  circuit: Circuit,
  targetExpression: string,
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[],
): CircuitSubmission {
  const built = buildCircuit(circuit);
  if (!built.ok) return built;

  const expression = astToExpression(circuit);
  if (expression === null) {
    return { ok: false, reason: 'output_unwired', message: 'Wire the circuit to its output first.' };
  }

  // Guard the 2^n enumeration over the union of variables (F-01 build note).
  if (variables(built.ast).length > 10) {
    return { ok: false, reason: 'too_many_variables', message: 'Too many distinct inputs (max 10).' };
  }

  const correct = equivalent(expression, targetExpression);
  return {
    ok: true,
    correct,
    expression,
    repSubmission: { rep: 'circuit', expression, nodes, edges },
  };
}
