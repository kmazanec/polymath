import { truthTable, variables, parse, BooleanParseError } from '@polymath/booleans';
import type { Action } from '@polymath/contract';

/**
 * ADR-010 Layer 2: the server independently recomputes the truth table of any
 * agent-generated item and confirms it matches the agent's `claimedTruthTable`
 * *before* the Action crosses the wire. The validator does not trust the agent;
 * a mismatch (or an unparseable expression) is a rejection, which drives the
 * one-retry-then-fallback path in the agent loop.
 *
 * Only the three item-generating `mount` variants carry a `claimedTruthTable`;
 * every other Action passes Layer 2 trivially (nothing to recompute).
 */

/** Guard against pathological expressions: 2^n enumeration over the booleans
 *  grammar's 26 permitted variables would be 2^26 rows. Lessons use ≤4 vars; cap
 *  well above real use but far below an abuse threshold. */
const MAX_DISTINCT_VARS = 10;

export type Layer2Result =
  | { ok: true }
  | { ok: false; detail: string };

const ITEM_KINDS = new Set(['TruthTablePractice', 'CircuitBuilder', 'PseudocodeChallenge']);

function expressionOf(component: { kind: string } & Record<string, unknown>): string | null {
  if (component.kind === 'TruthTablePractice') return component.expression as string;
  if (component.kind === 'CircuitBuilder' || component.kind === 'PseudocodeChallenge') {
    return component.targetExpression as string;
  }
  return null;
}

/** Recompute and compare. Returns `{ok:true}` for non-item Actions. */
export function validateLayer2(action: Action): Layer2Result {
  if (action.type !== 'mount') return { ok: true };
  const component = action.component;
  if (!ITEM_KINDS.has(component.kind)) return { ok: true };

  const expression = expressionOf(component);
  if (expression === null) return { ok: true };
  const claimed = (component as { claimedTruthTable?: unknown }).claimedTruthTable;
  if (!Array.isArray(claimed)) {
    return { ok: false, detail: `${component.kind} is missing claimedTruthTable` };
  }

  let varCount: number;
  try {
    varCount = variables(parse(expression)).length;
  } catch (err) {
    const why = err instanceof BooleanParseError ? err.message : String(err);
    return { ok: false, detail: `unparseable targetExpression "${expression}": ${why}` };
  }
  if (varCount > MAX_DISTINCT_VARS) {
    return {
      ok: false,
      detail: `targetExpression has ${varCount} variables (> ${MAX_DISTINCT_VARS} cap)`,
    };
  }

  const computed = truthTable(expression).out.map((v) => (v ? 1 : 0));
  if (JSON.stringify(computed) !== JSON.stringify(claimed)) {
    return {
      ok: false,
      detail:
        `claimedTruthTable ${JSON.stringify(claimed)} disagrees with the validator ` +
        `(computed ${JSON.stringify(computed)} for "${expression}")`,
    };
  }
  return { ok: true };
}
