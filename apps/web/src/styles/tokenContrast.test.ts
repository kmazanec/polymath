import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Token contrast regression (MR !8 review). tokens.css claims WCAG 2.1 AA; this guards
 * that the STATUS colours (pass/fail/warn) actually clear AA body-text contrast (4.5:1)
 * against BOTH the page background and the card surface, in light AND dark themes.
 * The fail token regressed once: #c2570a was 4.50:1 on white but only 4.13:1 on the
 * #f4f5f7 surface, so verdict text inside cards was below AA. Now #b3500a.
 */

const TOKENS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  './tokens.css',
);

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Parse the `--name: #hex;` declarations from a single :root-style block. */
function parseBlock(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[m[1]!] = m[2]!.toLowerCase();
  }
  return out;
}

const css = readFileSync(TOKENS_PATH, 'utf8');
// The light theme is the first :root block; the dark theme is inside the
// prefers-color-scheme media query. Split on the media query to read each.
const darkIdx = css.indexOf('@media (prefers-color-scheme: dark)');
const lightTokens = parseBlock(css.slice(0, darkIdx === -1 ? css.length : darkIdx));
const darkTokens = parseBlock(darkIdx === -1 ? '' : css.slice(darkIdx));

const AA = 4.5;
const STATUS = ['--color-pass', '--color-fail', '--color-warn'] as const;

describe('design-token contrast (WCAG 2.1 AA)', () => {
  for (const [theme, tokens] of [
    ['light', lightTokens],
    ['dark', darkTokens],
  ] as const) {
    const bg = tokens['--color-bg'];
    const surface = tokens['--color-surface'];

    it(`${theme}: --color-bg and --color-surface are defined`, () => {
      expect(bg, `${theme} --color-bg`).toBeTruthy();
      expect(surface, `${theme} --color-surface`).toBeTruthy();
    });

    for (const token of STATUS) {
      it(`${theme}: ${token} clears AA against bg AND surface`, () => {
        const color = tokens[token];
        expect(color, `${theme} ${token} defined`).toBeTruthy();
        expect(
          contrastRatio(color!, bg!),
          `${theme} ${token} (${color}) vs bg (${bg})`,
        ).toBeGreaterThanOrEqual(AA);
        expect(
          contrastRatio(color!, surface!),
          `${theme} ${token} (${color}) vs surface (${surface})`,
        ).toBeGreaterThanOrEqual(AA);
      });
    }
  }
});
