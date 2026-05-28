import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkPreconditions } from './preconditions.js';
import { OpenAIExplainBackJudge } from './judge.js';
import type { ProsodyFeatures } from './prosody.js';

/**
 * F-11 AC#6 — the explain-back eval gate (the LangSmith ≥90%-agreement CI block).
 *
 * Two assertions, mirroring the F-05 inner-agent eval pattern:
 *   1. ALWAYS-ON, offline (no key): every fixture's deterministic preconditions
 *      must agree with its hand label. Keeps the labelled bank honest without a
 *      key and runs in the `verify` CI job. This is the structural anti-cheat —
 *      it cannot silently rot.
 *   2. KEY-GATED `liveIt`: the LLM judge runs over the fixtures whose preconditions
 *      PASS and must agree with the hand labels at ≥ AGREEMENT_THRESHOLD. Skipped
 *      without `OPENAI_API_KEY` (same skip-offline/run-on-key pattern as the
 *      inner-agent gate).
 *
 * Text-transcript stand-ins until the ~30 real recordings land (the approved
 * decision; they drop in without a code change). `evals/` is CI/test-only — NOT in
 * the Docker image.
 */

interface Fixture {
  id: string;
  transcript: string;
  durationMs: number;
  maxDurationSec: number;
  kcVocabulary: string[];
  itemTokens: string[];
  prosody?: ProsodyFeatures;
  expectPreconditionPass: boolean;
  expectFailedReason?: string;
  expectJudgePass?: boolean;
}

/** The CI hard-block agreement threshold (matches
 *  `lessons/1/mastery_config.json` `explainBackJudgeAgreementThreshold`). */
const AGREEMENT_THRESHOLD = 0.9;

const dir = path.dirname(fileURLToPath(import.meta.url));
// packages/graph/src/explainback → repo root is four levels up.
const fixturesPath = path.resolve(dir, '../../../../evals/explain_back/fixtures.json');
const fixtures: Fixture[] = JSON.parse(fs.readFileSync(fixturesPath, 'utf8')).fixtures;

describe('explain-back eval bank (AC#6)', () => {
  it('has a meaningful labelled bank (≥ ~30 fixtures, text stand-ins)', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(30);
  });

  // (1) Always-on offline gate: deterministic preconditions vs. hand labels.
  it('the deterministic preconditions agree with EVERY hand label (offline, no key)', () => {
    for (const f of fixtures) {
      const result = checkPreconditions({
        transcript: f.transcript,
        durationMs: f.durationMs,
        maxDurationSec: f.maxDurationSec,
        kcVocabulary: f.kcVocabulary,
        itemTokens: f.itemTokens,
        ...(f.prosody ? { prosody: f.prosody } : {}),
      });
      expect(result.passed, `precondition pass/fail disagreed on "${f.id}"`).toBe(
        f.expectPreconditionPass,
      );
      if (!f.expectPreconditionPass) {
        expect(result.failedReason, `wrong failed reason on "${f.id}"`).toBe(f.expectFailedReason);
      }
    }
  });

  // (2) Key-gated live judge gate: ≥ threshold agreement on precondition-passing
  // fixtures. Skipped without a key.
  const liveIt = process.env['OPENAI_API_KEY'] ? it : it.skip;
  liveIt(
    `the LLM judge agrees with hand labels at ≥${(AGREEMENT_THRESHOLD * 100).toString()}% (live gate)`,
    async () => {
      const judge = new OpenAIExplainBackJudge();
      const judged = fixtures.filter((f) => f.expectPreconditionPass && f.expectJudgePass !== undefined);
      let agree = 0;
      for (const f of judged) {
        const { passed } = await judge.judge({
          transcript: f.transcript,
          itemTokens: f.itemTokens,
          kcVocabulary: f.kcVocabulary,
          ...(f.prosody ? { prosody: f.prosody } : {}),
        });
        if (passed === f.expectJudgePass) agree++;
      }
      expect(agree / judged.length).toBeGreaterThanOrEqual(AGREEMENT_THRESHOLD);
    },
    120_000,
  );
});
