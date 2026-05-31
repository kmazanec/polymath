import { parse, variables, truthTable, BooleanParseError } from '@polymath/booleans';

/**
 * F-29: Engine-owned answer key (ADR-014 / ADR-010 Layer 2 extension).
 *
 * `computeItemKey` computes the canonical truth table for a generated expression.
 * It is called BEFORE `compileMove` for EVERY item-bearing move from EVERY provider
 * — the engine owns the key and the model's asserted claimedTruthTable is discarded.
 *
 * INVARIANTS (all derived from CLAUDE.md):
 *  - Var-capped at MAX_DISTINCT_VARS = 10 (same constant as layer2.ts).
 *    Over-cap → {ok:false}, NEVER enumerates (2^26 would block the event loop).
 *  - Unparseable → {ok:false}.
 *  - Layer-2 (validateLayer2) is BYTE-FOR-BYTE UNCHANGED. The engine-owns-key
 *    overwrite means Layer-2 always sees the correct table, so a "wrong-key" case
 *    at Layer-2 is impossible-by-construction. The adversarial test asserts the
 *    OVERWRITE (the mounted spec carries the computed key), not a Layer-2 rejection.
 *
 * Lives in apps/agent (NOT @polymath/booleans) to avoid touching the 100%-coverage-
 * gated package.
 */

/** Guard: same cap as layer2.ts. */
const MAX_DISTINCT_VARS = 10;

export type ComputeKeyResult =
  | { ok: true; table: (0 | 1)[] }
  | { ok: false; detail: string };

/**
 * Compute the MSB-first truth table for `expression`, var-capped.
 *
 * Returns `{ok:true, table}` on success, `{ok:false, detail}` for any of:
 *  - unparseable expression
 *  - more than MAX_DISTINCT_VARS (10) distinct variables (never enumerates)
 */
export function computeItemKey(expression: string): ComputeKeyResult {
  // Step 1: parse first (fast, no enumeration)
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(expression);
  } catch (err) {
    const why = err instanceof BooleanParseError ? err.message : String(err);
    return { ok: false, detail: `unparseable expression "${expression}": ${why}` };
  }

  // Step 2: var-cap check BEFORE any enumeration
  const varCount = variables(ast).length;
  if (varCount > MAX_DISTINCT_VARS) {
    return {
      ok: false,
      detail: `expression "${expression}" has ${String(varCount)} distinct variables (> ${String(MAX_DISTINCT_VARS)} cap) — rejected without enumeration`,
    };
  }

  // Step 3: compute the truth table (2^varCount rows — bounded by cap above)
  const table = truthTable(expression).out.map((v): 0 | 1 => (v ? 1 : 0));
  return { ok: true, table };
}
