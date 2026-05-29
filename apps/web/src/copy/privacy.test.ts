import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACCESSIBILITY_POSTURE_POINTS,
  PRIVACY_POSTURE_POINTS,
} from './privacy.js';

/**
 * The privacy/accessibility posture doc is the institutional-credibility artifact
 * (ADR-012): it must exist, stay at or under the ~200-word budget, and actually
 * cover the posture the running app implements. These assertions keep the doc from
 * drifting away from the canonical copy module it is written from.
 */

const DOC_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/privacy-and-accessibility.md',
);

function docText(): string {
  return readFileSync(DOC_PATH, 'utf8');
}

describe('privacy-and-accessibility.md', () => {
  it('exists and is non-empty', () => {
    expect(docText().trim().length).toBeGreaterThan(0);
  });

  it('is at or under the ~200-word budget (ADR-012)', () => {
    const words = docText()
      .replace(/[#*_`>-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 0);
    expect(words.length).toBeLessThanOrEqual(200);
  });

  it('covers every required privacy posture point', () => {
    const text = docText().toLowerCase();
    for (const needle of [
      'no webcam',
      'facial',
      'pii',
      'opaque',
      'microphone',
      'session replay',
      'off by default',
      'deleted',
      'grace',
    ]) {
      expect(text).toContain(needle);
    }
  });

  it('covers every required accessibility posture point', () => {
    const text = docText().toLowerCase();
    for (const needle of [
      'wcag 2.1 aa',
      'colour-blind-safe',
      'keyboard',
      'focus',
      'reduced motion',
      'screen-reader',
    ]) {
      expect(text).toContain(needle);
    }
  });

  it('keeps the canonical copy points non-empty (the doc is written from them)', () => {
    expect(PRIVACY_POSTURE_POINTS.length).toBeGreaterThan(0);
    expect(ACCESSIBILITY_POSTURE_POINTS.length).toBeGreaterThan(0);
    for (const p of [...PRIVACY_POSTURE_POINTS, ...ACCESSIBILITY_POSTURE_POINTS]) {
      expect(p.trim().length).toBeGreaterThan(0);
    }
  });
});
