/**
 * @polymath/bkt — Bayesian Knowledge Tracing (Corbett & Anderson 1995), pure TS.
 *
 * Per knowledge component we track P(L) = P(the learner has mastered the skill).
 * Each observation (a correct/incorrect attempt) Bayes-updates P(L) given the
 * guess/slip parameters, then applies the learning-transition probability. The
 * parameters are the per-lesson `mastery_config.json` values (ADR-011):
 *   P(L0)  prior mastery, P(T) transition, P(G) guess, P(S) slip, threshold.
 *
 * No dependencies; fully deterministic; the probability is provably kept in [0,1].
 */

export interface BKTConfig {
  /** P(L0): prior probability the skill is already mastered. */
  prior: number;
  /** P(T): probability of learning the skill on an attempt (if not yet known). */
  transition: number;
  /** P(G): probability of a correct answer by guessing (skill not known). */
  guess: number;
  /** P(S): probability of an incorrect answer by slipping (skill known). */
  slip: number;
}

/** Per-KC BKT state: the current posterior P(mastered). */
export interface BKTParams {
  /** P(L): current probability the KC is mastered, in [0, 1]. */
  pMastered: number;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The initial BKT state for a KC (P(L) = P(L0)). */
export function initBKT(config: BKTConfig): BKTParams {
  return { pMastered: clamp01(config.prior) };
}

/**
 * One Corbett-Anderson update. Given the prior P(L) and whether the attempt was
 * correct, compute the posterior given the observation, then apply the learning
 * transition. Returns the new P(L), always in [0, 1].
 */
export function updateBKT(prior: BKTParams, correct: boolean, config: BKTConfig): BKTParams {
  const pL = clamp01(prior.pMastered);
  const { guess: g, slip: s, transition: t } = config;

  // P(L | observation) via Bayes.
  let posterior: number;
  if (correct) {
    const num = pL * (1 - s);
    const den = pL * (1 - s) + (1 - pL) * g;
    posterior = den === 0 ? pL : num / den;
  } else {
    const num = pL * s;
    const den = pL * s + (1 - pL) * (1 - g);
    posterior = den === 0 ? pL : num / den;
  }

  // Apply the learning transition: an unmastered skill may become mastered.
  const pNext = posterior + (1 - posterior) * t;
  return { pMastered: clamp01(pNext) };
}

/** Fold a sequence of observations into a final BKT state (oldest first). */
export function updateBKTSequence(
  config: BKTConfig,
  observations: boolean[],
  start: BKTParams = initBKT(config),
): BKTParams {
  return observations.reduce((acc, correct) => updateBKT(acc, correct, config), start);
}

/** Whether the KC is mastered at the given probability threshold (ADR-011: 0.95). */
export function isMastered(params: BKTParams, threshold: number): boolean {
  return params.pMastered >= threshold;
}
