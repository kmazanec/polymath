import { z } from 'zod';

/**
 * The locked intra-lesson phase shape (ADR-003 / ADR-005). New phases require a
 * new ADR; downstream lessons reuse these by parameterisation, not extension.
 *
 *   introducing → practicing → {hint, transferring} → assessed → {mastered, remediating}
 */
export const PhaseName = z.enum([
  'introducing',
  'practicing',
  'hint',
  'transferring',
  'assessed',
  'mastered',
  'remediating',
]);
export type PhaseName = z.infer<typeof PhaseName>;
