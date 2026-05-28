/**
 * Prosody features (ADR-010 Layer 4b, F-11 AC#10): disfluency signals pulled off
 * the Realtime transcript stream that help the judge distinguish thinking-while-
 * speaking from reading-from-elsewhere. These are CAPTURED in `apps/agent`'s voice
 * path (the `explain_back`-phase bridge) and fed to the judge; the deterministic
 * preconditions do NOT depend on them (a missing prosody object never blocks).
 *
 * The shape is deliberately small and provider-agnostic: the seam (`RealtimeSession`)
 * yields transcript chunks with timing, and the capture derives these aggregates.
 */
export interface ProsodyFeatures {
  /** Count of filled pauses ("um", "uh", "er", …) detected in the transcript. */
  filledPauses: number;
  /** Count of mid-utterance silences (gaps between chunks above a threshold). */
  midUtteranceSilences: number;
  /** Count of self-restarts / repaired words ("the— the AND gate"). */
  restarts: number;
}

/** A neutral default for a turn with no captured prosody (the bridge was absent or
 *  produced nothing). Not a pass/fail signal on its own — fed to the judge as-is. */
export const EMPTY_PROSODY: ProsodyFeatures = {
  filledPauses: 0,
  midUtteranceSilences: 0,
  restarts: 0,
};
