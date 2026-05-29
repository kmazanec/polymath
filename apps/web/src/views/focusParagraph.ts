/**
 * Deterministic "suggested next-session focus" paragraph builder.
 *
 * Pure function — no LLM, no network. Produces a teacher-facing paragraph
 * that names which KCs need more practice (stuck KCs) or congratulates
 * the learner on being ready to advance.
 */

/**
 * Build a suggested next-session focus paragraph for the teacher report.
 *
 * @param stuckKcs - KCs the learner is stuck on (repeated misses / below threshold).
 *   If empty, the learner has mastered all KCs encountered this session.
 * @returns A human-readable paragraph (deterministic — same input → same output).
 */
export function buildNextSessionFocus(stuckKcs: readonly string[]): string {
  if (stuckKcs.length === 0) {
    return (
      'The learner has mastered all knowledge components covered in this session ' +
      'and is ready to advance to the next concept. Consider introducing a new topic ' +
      'or reinforcing mastery with novel transfer problems.'
    );
  }

  const list = formatKcList(stuckKcs);

  if (stuckKcs.length === 1) {
    return (
      `Focus next session on reinforcing ${list}. ` +
      'The learner struggled with this concept — try varied representations ' +
      '(truth table, circuit diagram, and pseudocode) to build robust understanding. ' +
      'Avoid advancing to compound expressions until this gate is cleared.'
    );
  }

  return (
    `Focus next session on the following knowledge components where the learner struggled: ${list}. ` +
    'Work through each concept in isolation before combining them. ' +
    'Use varied representations (truth table, circuit diagram, and pseudocode) ' +
    'and ensure the learner can explain their reasoning aloud before moving on.'
  );
}

/** Format a list of KC names into a human-readable string. */
function formatKcList(kcs: readonly string[]): string {
  if (kcs.length === 1) return kcs[0]!;
  if (kcs.length === 2) return `${kcs[0]!} and ${kcs[1]!}`;
  const last = kcs[kcs.length - 1]!;
  const rest = kcs.slice(0, -1).join(', ');
  return `${rest}, and ${last}`;
}
