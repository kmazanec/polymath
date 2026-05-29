/**
 * F-17 CSV export (AC#5). The column shape is FROZEN — F-21 reads it — and is
 * built in-memory from the Postgres tables (CSVs do NOT persist to disk under the
 * release-symlink deploy; the export is a streaming GET endpoint).
 *
 * Frozen 9-column order:
 *   subject_id, condition_order, pre_test_score, polymath_session_id,
 *   polymath_post_score, baseline_session_id, baseline_post_score,
 *   followup_score, qualitative_notes
 *
 * Scores are 0.0–1.0 (fraction correct); a phase with no recorded results yields
 * an EMPTY string (missing ≠ 0.0 — F-21 must distinguish "not run" from "all
 * wrong"). A null session id / null notes is likewise the empty string.
 */

/** The frozen header, in order. Exported so a test asserts the exact shape. */
export const CSV_COLUMNS = [
  'subject_id',
  'condition_order',
  'pre_test_score',
  'polymath_session_id',
  'polymath_post_score',
  'baseline_session_id',
  'baseline_post_score',
  'followup_score',
  'qualitative_notes',
] as const;

/** The per-subject aggregate the CSV row is built from. Scores are pre-computed
 *  fractions (or `null` for "phase not run"). */
export interface SubjectCsvRow {
  subjectId: string;
  conditionOrder: string;
  preTestScore: number | null;
  polymathSessionId: string | null;
  polymathPostScore: number | null;
  baselineSessionId: string | null;
  baselinePostScore: number | null;
  followupScore: number | null;
  qualitativeNotes: string | null;
}

/** Fraction-correct (0.0–1.0) of a result set, or `null` when the set is empty
 *  ("phase not run"). Kept as a helper so every phase scores identically. */
export function fractionCorrect(results: { correct: boolean }[]): number | null {
  if (results.length === 0) return null;
  const n = results.filter((r) => r.correct).length;
  return n / results.length;
}

/** RFC-4180 field escaping: quote when the value contains a comma, quote, CR or
 *  LF, doubling any embedded quote. A free-text `qualitative_notes` is the field
 *  that needs it. */
function escapeField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function scoreCell(score: number | null): string {
  // Empty string when missing (F-21 distinguishes "not run" from 0.0); otherwise
  // a fixed 0.0–1.0 with a stable precision so the column is parseable.
  return score === null ? '' : String(score);
}

/** Build the full CSV text (header + one row per subject) from pre-aggregated
 *  rows, in the FROZEN column order. Streaming the result is the caller's job
 *  (the route writes this string). */
export function buildCsv(rows: SubjectCsvRow[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) {
    const cells = [
      r.subjectId,
      r.conditionOrder,
      scoreCell(r.preTestScore),
      r.polymathSessionId ?? '',
      scoreCell(r.polymathPostScore),
      r.baselineSessionId ?? '',
      scoreCell(r.baselinePostScore),
      scoreCell(r.followupScore),
      r.qualitativeNotes ?? '',
    ].map((c) => escapeField(String(c)));
    lines.push(cells.join(','));
  }
  // Trailing newline so appending/concatenation is well-formed.
  return lines.join('\n') + '\n';
}
