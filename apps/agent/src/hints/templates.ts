import { parse, variables } from '@polymath/booleans';

/**
 * ADR-010 Layer 3 — Hint template library.
 *
 * L1/L2 hints are templated: typed slot enums filled from the item's
 * targetExpression. L3 is free-form (no template here; the provider supplies
 * canned prose in the heuristic path, LLM prose when a key is available).
 *
 * Slot vocabulary is derived directly from the item's parsed AST, so every
 * rendered hint references the item's actual gates and variables.
 */

// ---------------------------------------------------------------------------
// Slot types
// ---------------------------------------------------------------------------

/** Slot filler types for L1/L2 templates (ADR-010 Layer 3). */
export type GateSlot = 'AND' | 'OR' | 'NOT';
export type StateSlot = 'true' | 'false';
export type BoolSlot = 'true' | 'false';

/** Resolved slot values for a single item. */
export interface HintSlots {
  /** The primary gate in the expression (first operator found, left-first). */
  gate: GateSlot;
  /** A stable first variable (alphabetically first). */
  var1: string;
  /** A second variable if the expression has ≥2; falls back to var1. */
  var2: string;
  /** A sub-expression string for context (the full targetExpression for simplicity). */
  subExpression: string;
}

// ---------------------------------------------------------------------------
// Template strings
// ---------------------------------------------------------------------------

/** L1 template: light-touch directional hint. */
export type L1Template = (slots: HintSlots) => string;

/** L2 template: concrete guided-trace hint. */
export type L2Template = (slots: HintSlots) => string;

export const L1_TEMPLATES: readonly L1Template[] = [
  (s) => `Look at the ${s.gate} gate first. What does it output when both inputs are the same value?`,
  (s) => `Think about what ${s.gate} means. When is the output true?`,
  (s) => `Focus on the ${s.gate} operator. Try a single row of the truth table.`,
  (s) => `Start with variable ${s.var1}. What happens to the output as ${s.var1} changes?`,
  (s) => `The expression uses ${s.gate}. Can you recall the rule for that operator?`,
];

export const L2_TEMPLATES: readonly L2Template[] = [
  (s) =>
    `Try setting ${s.var1} to true and ${s.var2} to false. ` +
    `What is the output of ${s.subExpression}?`,
  (s) =>
    `Set ${s.var1} to false and ${s.var2} to true. ` +
    `Walk through ${s.subExpression} step by step.`,
  (s) =>
    `When both ${s.var1} and ${s.var2} are true, what does ${s.gate} give you? ` +
    `Fill that row in the table.`,
  (s) =>
    `Consider the case where ${s.var1} is false. ` +
    `What does ${s.subExpression} evaluate to for all values of ${s.var2}?`,
  (s) =>
    `Try every combination where ${s.var1} is true. ` +
    `Does ${s.gate} ever change the output in those rows?`,
];

// ---------------------------------------------------------------------------
// Slot extraction
// ---------------------------------------------------------------------------

/** Detect the primary gate kind from the expression string (simple heuristic:
 *  first keyword match, left-to-right). Falls back to 'AND'. */
function detectGate(expr: string): GateSlot {
  // Scan for NOT first (unary, higher precedence), then AND, then OR
  const upper = expr.toUpperCase();
  if (/\bNOT\b/.test(upper)) return 'NOT';
  if (/\bAND\b/.test(upper)) return 'AND';
  if (/\bOR\b/.test(upper)) return 'OR';
  return 'AND';
}

/**
 * Extract slot values for the given `targetExpression`.
 * Returns null if the expression cannot be parsed (callers fall back to
 * no_action in that case — defensive but unlikely for lesson content).
 */
export function extractSlots(targetExpression: string): HintSlots | null {
  try {
    const ast = parse(targetExpression);
    const vars = variables(ast); // sorted, de-duplicated
    const var1 = vars[0] ?? 'A';
    const var2 = vars[1] ?? var1;
    return {
      gate: detectGate(targetExpression),
      var1,
      var2,
      subExpression: targetExpression,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hint text generation
// ---------------------------------------------------------------------------

/** Pick a deterministic L1 or L2 template for the item. The index is derived
 *  from the expression so the same item always gets the same template. */
function templateIndex(expr: string, count: number): number {
  // Simple stable hash: sum of char codes mod count
  let sum = 0;
  for (let i = 0; i < expr.length; i++) sum += expr.charCodeAt(i);
  return sum % count;
}

/**
 * Generate an L1 hint body for the given targetExpression.
 * Returns null if slots cannot be extracted.
 */
export function generateL1(targetExpression: string): string | null {
  const slots = extractSlots(targetExpression);
  if (!slots) return null;
  const idx = templateIndex(targetExpression, L1_TEMPLATES.length);
  return L1_TEMPLATES[idx]!(slots);
}

/**
 * Generate an L2 hint body for the given targetExpression.
 * Returns null if slots cannot be extracted.
 */
export function generateL2(targetExpression: string): string | null {
  const slots = extractSlots(targetExpression);
  if (!slots) return null;
  const idx = templateIndex(targetExpression, L2_TEMPLATES.length);
  return L2_TEMPLATES[idx]!(slots);
}

/**
 * Canned L3 prose used by the heuristic (key-free) provider. In the real LLM
 * path, L3 would be free-form generated prose; here it gives a useful
 * deep-dive hint without requiring a key.
 */
export function generateL3Canned(targetExpression: string): string {
  const slots = extractSlots(targetExpression);
  if (!slots) {
    return `Let's work through the full truth table together. Fill in every row systematically, one at a time.`;
  }
  return (
    `Let's think this through. The expression is "${targetExpression}". ` +
    `The ${slots.gate} operator has a specific rule: ` +
    (slots.gate === 'AND'
      ? `it outputs true ONLY when BOTH inputs are true. For every other combination, the output is false.`
      : slots.gate === 'OR'
        ? `it outputs true when AT LEAST ONE input is true. It's only false when both inputs are false.`
        : `it flips the value — true becomes false, false becomes true.`) +
    ` Try building the full truth table row by row using that rule.`
  );
}
