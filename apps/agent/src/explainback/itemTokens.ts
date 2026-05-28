import { parse, variables } from '@polymath/booleans';
import type { Lesson } from '../lessons/loader.js';

/**
 * Precondition #5's token deriver (server-side; the `@polymath/graph` pkg never
 * reads lessons). Resolves the just-probed item's "item-specific tokens" — its
 * variable names + the operator literals in its expression — from a `targetItemId`.
 * This is DISTINCT from the generic KC vocab (#4): #5 proves the explanation
 * references THIS problem, not a memorised template (ADR-010 §Tradeoffs).
 *
 * VAR-CAP (CLAUDE.md DoS invariant): a forged/wide `targetItemId` resolving to a
 * many-variable expression must NOT force a 2^n enumeration. We reuse the same
 * MAX_SUBMIT_VARS=10 cap the submit/transfer paths use — `variables(parse(...))`
 * is linear in expression size (no enumeration), but the cap keeps the resolved
 * token set bounded and rejects an absurd expression as "no tokens" (fail closed).
 *
 * Unknown/forged id, unparseable expression, or over-cap → EMPTY set → precondition
 * #5 fails CLOSED. A missing input is BLOCK, never a degraded pass.
 */

/** The distinct-variable cap shared with the submit/transfer correctness paths. */
const MAX_SUBMIT_VARS = 10;

/** Operator literals the L1 grammar recognizes (uppercase canonical form). The
 *  explanation referencing the operator THIS item used (e.g. "AND") is an
 *  item-specific reference. */
const OPERATORS: Record<string, string> = {
  AND: 'AND',
  OR: 'OR',
  NOT: 'NOT',
};

/** A minimal projection of a transfer-bank row for token resolution. */
export interface TransferBankItemRef {
  itemId: string;
  targetExpression: string;
}

/** Resolve the canonical expression for `targetItemId` from the lesson items first,
 *  then the supplied transfer-bank rows. Matches by itemId OR by targetExpression
 *  (the web names items by expression). Returns undefined for an unknown id. */
function resolveExpression(
  targetItemId: string,
  lesson: Lesson,
  transferItems: readonly TransferBankItemRef[],
): string | undefined {
  const lessonItem = lesson.content.items.find(
    (i) => i.itemId === targetItemId || i.targetExpression === targetItemId,
  );
  if (lessonItem) return lessonItem.targetExpression;
  const bankItem = transferItems.find(
    (b) => b.itemId === targetItemId || b.targetExpression === targetItemId,
  );
  return bankItem?.targetExpression;
}

/** Derive the item-specific tokens (vars + operators) for `targetItemId`. Empty on
 *  unknown id / unparseable / over-cap (all fail-closed). */
export function deriveItemTokens(
  targetItemId: string,
  lesson: Lesson,
  transferItems: readonly TransferBankItemRef[] = [],
): string[] {
  const expr = resolveExpression(targetItemId, lesson, transferItems);
  if (expr === undefined) return []; // unknown/forged id → fail closed
  try {
    const ast = parse(expr);
    const vars = variables(ast);
    if (vars.length > MAX_SUBMIT_VARS) return []; // var-cap → fail closed, no 2^n risk
    const tokens = new Set<string>(vars);
    // Add the operator literals present in the expression (case-insensitive scan).
    const upper = expr.toUpperCase();
    for (const op of Object.keys(OPERATORS)) {
      if (new RegExp(`\\b${op}\\b`).test(upper)) tokens.add(OPERATORS[op]!);
    }
    return [...tokens];
  } catch {
    return []; // unparseable → fail closed, never a throw
  }
}
