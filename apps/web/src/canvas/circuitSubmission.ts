import { type Ast, parse, variables } from '@polymath/booleans';
import type { RepSubmission } from '@polymath/contract';
import { type Circuit, type CircuitError, type CircuitOk, buildCircuit } from './circuitModel.js';

/** Render a built AST into a canonical Boolean expression string the validator
 *  (and the agent's logging) accepts. Parenthesised to preserve the exact tree
 *  the learner wired, independent of precedence. */
export function astToExpression(ast: Ast): string {
  switch (ast.kind) {
    case 'var':
      return ast.name;
    case 'not':
      return `(NOT ${astToExpression(ast.operand)})`;
    case 'and':
      return `(${astToExpression(ast.left)} AND ${astToExpression(ast.right)})`;
    case 'or':
      return `(${astToExpression(ast.left)} OR ${astToExpression(ast.right)})`;
    case 'nand':
      return `(${astToExpression(ast.left)} NAND ${astToExpression(ast.right)})`;
    case 'nor':
      return `(${astToExpression(ast.left)} NOR ${astToExpression(ast.right)})`;
  }
}

/** Convenience: build + render in one call (returns null on a malformed circuit). */
export function circuitExpression(circuit: Circuit): string | null {
  const built = buildCircuit(circuit);
  return built.ok ? astToExpression(built.ast) : null;
}

export interface CircuitVerdict {
  ok: true;
  correct: boolean;
  /** Canonical expression the circuit computes — the `submission` wire string. */
  expression: string;
  /** When incorrect, the first input assignment where the circuit and target
   *  disagree (AC6 — the failing combination, surfaced for hints/logging). */
  failingAssignment: Record<string, boolean> | null;
  /** The optional rep-native submission payload (circuit branch). */
  repSubmission: Extract<RepSubmission, { rep: 'circuit' }>;
}

export type CircuitSubmission = CircuitVerdict | CircuitError;

/** First assignment over the union of vars where the two expressions differ, or
 *  null if equivalent. Enumerates 2^n like `equivalent`, but reports the witness. */
function firstDifference(aExpr: string, bExpr: string): Record<string, boolean> | null {
  const a = parse(aExpr);
  const b = parse(bExpr);
  const vars = [...new Set([...variables(a), ...variables(b)])].sort();
  const n = vars.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    const env: Record<string, boolean> = {};
    for (let bit = 0; bit < n; bit++) {
      env[vars[bit]!] = (mask & (1 << (n - 1 - bit))) !== 0;
    }
    if (evalAst(a, env) !== evalAst(b, env)) return env;
  }
  return null;
}

/** Local AST eval (avoids importing the internal evaluate for env-over-union). */
function evalAst(ast: Ast, env: Record<string, boolean>): boolean {
  switch (ast.kind) {
    case 'var':
      return env[ast.name] ?? false;
    case 'not':
      return !evalAst(ast.operand, env);
    case 'and':
      return evalAst(ast.left, env) && evalAst(ast.right, env);
    case 'or':
      return evalAst(ast.left, env) || evalAst(ast.right, env);
    case 'nand':
      return !(evalAst(ast.left, env) && evalAst(ast.right, env));
    case 'nor':
      return !(evalAst(ast.left, env) || evalAst(ast.right, env));
  }
}

/**
 * Decide a circuit submission against the target expression. Correctness is
 * computed CLIENT-SIDE (ADR-008: the verdict the learner sees never round-trips
 * through the agent). Returns the typed error for malformed circuits so the UI
 * shows stock copy, not a crash.
 */
export function evaluateSubmission(
  circuit: Circuit,
  targetExpression: string,
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[],
): CircuitSubmission {
  const built: CircuitOk | CircuitError = buildCircuit(circuit);
  if (!built.ok) return built;

  const expression = astToExpression(built.ast);

  // Guard the 2^n enumeration over the UNION of the circuit's and target's
  // variables (that union is what `equivalent`/`firstDifference` enumerate).
  const targetVars = variables(parse(targetExpression));
  const unionSize = new Set([...variables(built.ast), ...targetVars]).size;
  if (unionSize > 10) {
    return { ok: false, reason: 'too_many_variables', message: 'Too many distinct inputs (max 10).' };
  }

  const failingAssignment = firstDifference(expression, targetExpression);
  const correct = failingAssignment === null;
  return {
    ok: true,
    correct,
    expression,
    failingAssignment,
    repSubmission: { rep: 'circuit', expression, nodes, edges },
  };
}
