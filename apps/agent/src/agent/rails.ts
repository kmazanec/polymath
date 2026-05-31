import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, variables, type Ast } from '@polymath/booleans';
import { computeItemKey } from './key.js';
import type { AgentInput } from './client.js';

/**
 * F-29: Generation rails enforcement.
 *
 * A generated item is valid if and only if:
 *  1. The expression parses and stays within MAX_DISTINCT_VARS (10).
 *  2. All operators in the expression are in the allowed alphabet for the current
 *     lesson (operators from authored expressions in lessons 1..currentLessonId).
 *  3. Variable count ≤ lesson max (the max var count in any authored item for the
 *     current lesson).
 *  4. prompt is present and non-empty (non-whitespace).
 *
 * On success, returns the engine-computed key (never the model's asserted key).
 * On failure, returns {ok:false, detail} — caller must regenerate or fall back.
 */

/** Repo-root `lessons/` directory. */
const lessonsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../lessons',
);

/** Collect all operators present in an AST, returned as uppercase strings. */
function collectOperators(ast: Ast): Set<string> {
  const ops = new Set<string>();
  function walk(node: Ast): void {
    switch (node.kind) {
      case 'var':
        return;
      case 'not':
        ops.add('NOT');
        walk(node.operand);
        return;
      case 'and':
        ops.add('AND');
        walk(node.left);
        walk(node.right);
        return;
      case 'or':
        ops.add('OR');
        walk(node.left);
        walk(node.right);
        return;
      case 'nand':
        ops.add('NAND');
        walk(node.left);
        walk(node.right);
        return;
      case 'nor':
        ops.add('NOR');
        walk(node.left);
        walk(node.right);
        return;
    }
  }
  walk(ast);
  return ops;
}

/** Load and parse the lesson's content.json for its `items`. Fail-soft (returns
 *  empty array) so a missing/corrupt file degrades gracefully. */
function loadLessonItems(
  lessonId: number,
): Array<{ targetExpression: string; variables?: string[] }> {
  try {
    const file = path.join(lessonsRoot, String(lessonId), 'content.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      items?: Array<{ targetExpression?: string; variables?: string[] }>;
    };
    return (raw.items ?? []).filter(
      (i): i is { targetExpression: string; variables?: string[] } =>
        typeof i.targetExpression === 'string',
    );
  } catch {
    return [];
  }
}

/** The union of all operators that appear in authored expressions for lessons
 *  1 through `currentLessonId`. Cached per lesson boundary (lessons don't change
 *  at runtime). Content-derived: no new contract field needed. */
const alphabetCache = new Map<number, ReadonlySet<string>>();

export function allowedOperatorAlphabet(currentLessonId: number): ReadonlySet<string> {
  const cached = alphabetCache.get(currentLessonId);
  if (cached) return cached;

  const ops = new Set<string>();
  for (let id = 1; id <= currentLessonId; id++) {
    const items = loadLessonItems(id);
    for (const item of items) {
      try {
        const ast = parse(item.targetExpression);
        for (const op of collectOperators(ast)) ops.add(op);
      } catch {
        // ignore unparseable authored expressions (shouldn't happen; loader validates)
      }
    }
  }

  alphabetCache.set(currentLessonId, ops);
  return ops;
}

/** The maximum number of distinct variables in any authored item for the current
 *  lesson. Bounded by MAX_DISTINCT_VARS (10). Fail-soft: returns 2 (the minimum
 *  useful default) if no items are found. */
const maxVarsCache = new Map<number, number>();

export function lessonMaxVars(currentLessonId: number): number {
  const cached = maxVarsCache.get(currentLessonId);
  if (cached !== undefined) return cached;

  const items = loadLessonItems(currentLessonId);
  let max = 2; // default (at least 2 vars for any meaningful expression)
  for (const item of items) {
    try {
      const ast = parse(item.targetExpression);
      const count = variables(ast).length;
      if (count > max) max = count;
    } catch {
      // ignore
    }
  }

  maxVarsCache.set(currentLessonId, max);
  return max;
}

// ---------------------------------------------------------------------------
// checkGeneratedItem — the validation gate
// ---------------------------------------------------------------------------

export interface GeneratedItemCandidate {
  expression: string;
  prompt: string | undefined;
}

export type GenerationValidity =
  | { ok: true; table: (0 | 1)[] }
  | { ok: false; detail: string };

/**
 * Validate a generated item against the generation rails and return the engine-
 * computed key on success.
 *
 * Checks in order (fail-fast):
 *  1. Prompt presence — prompt-less is invalid (generates a bare workspace).
 *  2. Parse + var-cap (computeItemKey handles both).
 *  3. Operator alphabet — only operators from taught concepts allowed.
 *  4. Variable count ≤ lesson max.
 */
export function checkGeneratedItem(
  candidate: GeneratedItemCandidate,
  input: AgentInput,
): GenerationValidity {
  const { expression, prompt } = candidate;
  const currentLessonId = input.lesson.content.lessonId;

  // Rule 1: prompt must be present and non-empty (non-whitespace)
  if (!prompt || prompt.trim().length === 0) {
    return {
      ok: false,
      detail: 'generated item has no prompt — a workspace must never be bare',
    };
  }

  // Rule 2: parse + var-cap (computeItemKey is the single source for this)
  const keyResult = computeItemKey(expression);
  if (!keyResult.ok) {
    return { ok: false, detail: keyResult.detail };
  }

  // Rule 3: operator alphabet check (operator must be taught in ≤ currentLessonId)
  const alpha = allowedOperatorAlphabet(currentLessonId);
  let ast: Ast;
  try {
    ast = parse(expression);
  } catch {
    return { ok: false, detail: `expression "${expression}" is unparseable` };
  }
  const usedOps = collectOperators(ast);
  for (const op of usedOps) {
    if (!alpha.has(op)) {
      return {
        ok: false,
        detail: `operator "${op}" is not in the allowed alphabet for lesson ${String(currentLessonId)} — alphabet is {${[...alpha].join(', ')}}`,
      };
    }
  }

  // Rule 4: variable count ≤ lesson max
  const varCount = variables(ast).length;
  const maxVars = lessonMaxVars(currentLessonId);
  if (varCount > maxVars) {
    return {
      ok: false,
      detail: `expression "${expression}" uses ${String(varCount)} variables (> lesson max of ${String(maxVars)})`,
    };
  }

  return { ok: true, table: keyResult.table };
}
