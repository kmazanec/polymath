import type { MetricResult } from './types.js';
import { MIN_N, type MetricSubjectRow } from './inputs.js';

/**
 * Metric 5 — COHEN'S κ between the explain-back rubric verdict and the held-out
 * transfer verdict (ADR-011). The two independent integrity gates should classify
 * the same learners the same way; a low κ means one gate is noise.
 *
 * Computed on subjects carrying BOTH a `explainBackPassed` and a `transferPassed`
 * verdict (the complete 2×2 pairs). Fails closed:
 *  - N < MIN_N (=5) complete pairs ⇒ `insufficient_data` (value/pass null).
 *  - A DEGENERATE single-class table (every pair lands in one cell, or one rater is
 *    constant) makes the chance-agreement `p_e` = 1 → κ's denominator `1 - p_e` = 0.
 *    Guard it ⇒ `insufficient_data`, NEVER a NaN or a misleading κ = 1.0.
 *
 * `pass` = κ ≥ threshold (0.6, "substantial agreement", Landis & Koch).
 */
const KAPPA_THRESHOLD = 0.6;

export function computeRubricTransferKappa(subjects: MetricSubjectRow[]): MetricResult {
  const pairs = subjects.filter(
    (s) => typeof s.explainBackPassed === 'boolean' && typeof s.transferPassed === 'boolean',
  );
  const sampleN = pairs.length;
  const base = {
    id: 'rubric_transfer_kappa',
    label: 'Rubric ↔ transfer agreement (Cohen κ)',
    threshold: KAPPA_THRESHOLD,
    unit: 'κ',
    sampleN,
    source: 'experiment subjects: explain-back rubric vs held-out transfer verdict',
  } as const;

  if (sampleN < MIN_N) {
    return {
      ...base,
      value: null,
      pass: null,
      state: 'insufficient_data',
      note: `need ≥${MIN_N} subjects with BOTH verdicts (have ${sampleN})`,
    };
  }

  // 2×2 confusion counts: rater A = explain-back, rater B = transfer.
  let bothPass = 0;
  let bothFail = 0;
  let aOnly = 0; // explain-back pass, transfer fail
  let bOnly = 0; // explain-back fail, transfer pass
  for (const s of pairs) {
    if (s.explainBackPassed && s.transferPassed) bothPass++;
    else if (!s.explainBackPassed && !s.transferPassed) bothFail++;
    else if (s.explainBackPassed && !s.transferPassed) aOnly++;
    else bOnly++;
  }

  const n = sampleN;
  const po = (bothPass + bothFail) / n; // observed agreement
  // Marginal probabilities for each rater saying "pass".
  const aPass = (bothPass + aOnly) / n;
  const bPass = (bothPass + bOnly) / n;
  const pe = aPass * bPass + (1 - aPass) * (1 - bPass); // chance agreement

  const denom = 1 - pe;
  // Degenerate table (a constant rater / a single-class collapse) ⇒ denom == 0.
  // Fail closed rather than emit NaN or a vacuous κ.
  if (denom <= 1e-12) {
    return {
      ...base,
      value: null,
      pass: null,
      state: 'insufficient_data',
      note: 'degenerate agreement table (single class) — κ undefined',
    };
  }

  const kappa = (po - pe) / denom;
  if (!Number.isFinite(kappa)) {
    return { ...base, value: null, pass: null, state: 'insufficient_data', note: 'κ not finite' };
  }
  const pass = kappa >= KAPPA_THRESHOLD;
  return { ...base, value: kappa, pass, state: pass ? 'pass' : 'fail' };
}
