import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACCESSIBILITY_POSTURE_POINTS,
  PRIVACY_POSTURE_POINTS,
} from './privacy.js';

/**
 * The privacy/accessibility posture writeup (AC#10 of the privacy + accessibility
 * audit): ≤200 words, and aligned to ADR-012's posture commitments. The doc is the
 * source the in-app "About this session's data" affordance mirrors, so this also
 * guards that the doc keeps covering each commitment by keyword.
 */
const DOC_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/privacy-and-accessibility.md',
);

function readDoc(): string {
  return readFileSync(DOC_PATH, 'utf8');
}

/** Body words: strip Markdown headings/bullets/emphasis markers, count whitespace-
 *  separated tokens. Matches the `wc -w` spirit while ignoring structural syntax. */
function bodyWordCount(md: string): number {
  return md
    .replace(/[#*_`>-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

describe('docs/privacy-and-accessibility.md', () => {
  it('is at most 200 words (ADR-012 ~200-word posture, AC#10)', () => {
    const count = bodyWordCount(readDoc());
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(200);
  });

  it("covers ADR-012's privacy + accessibility commitments by keyword", () => {
    const doc = readDoc().toLowerCase();
    for (const needle of [
      'webcam',
      'facial',
      'session id',
      'microphone',
      'off by default',
      'deleted',
      'grace',
      'wcag 2.1 aa',
      'colour-blind', // British spelling matches the doc + copy module
      'keyboard',
      'reduced motion',
      'screen-reader',
    ]) {
      expect(doc).toContain(needle);
    }
  });

  it('does not claim certified compliance (posture, not certification — ADR-012 risk note)', () => {
    const doc = readDoc().toLowerCase();
    expect(doc).not.toContain('ferpa-compliant');
    expect(doc).not.toContain('wcag-certified');
    expect(doc).not.toContain('fully compliant');
  });

  it('the in-app posture bullets are non-empty (the modal mirrors the doc)', () => {
    expect(PRIVACY_POSTURE_POINTS.length).toBeGreaterThan(0);
    expect(ACCESSIBILITY_POSTURE_POINTS.length).toBeGreaterThan(0);
  });
});
