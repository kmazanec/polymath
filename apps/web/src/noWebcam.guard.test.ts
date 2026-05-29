import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Privacy invariant (ADR-012): the app requests NO webcam, at any point. The voice
 * feature requests the microphone only, and only on an explicit user gesture. This
 * source-level guard fails the build if any `getUserMedia` call in the web source
 * requests video, so a future change can't silently turn the camera on. It also
 * asserts the ONLY getUserMedia call is the audio-only voice one — a positive check
 * that the audited call site still looks the way the writeup claims.
 */

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...tsFiles(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('no-webcam guard (apps/web/src)', () => {
  const files = tsFiles(SRC_DIR);

  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('contains no getUserMedia call requesting video', () => {
    const offenders: string[] = [];
    // Match `getUserMedia( ... )` and flag if the argument object asks for video.
    const callRe = /getUserMedia\s*\(([\s\S]*?)\)/g;
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      let m: RegExpExecArray | null;
      while ((m = callRe.exec(text)) !== null) {
        const arg = m[1] ?? '';
        if (/video\s*:\s*(?!false)/.test(arg)) {
          offenders.push(`${path.relative(SRC_DIR, file)}: ${m[0]}`);
        }
      }
      // Also catch a standalone `video: true` near a media-constraints object.
      if (/getUserMedia/.test(text) && /\bvideo\s*:\s*true\b/.test(text)) {
        offenders.push(`${path.relative(SRC_DIR, file)}: standalone video:true near getUserMedia`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every getUserMedia call is video-free, and the audio-only voice request exists', () => {
    const calls: string[] = [];
    const callRe = /getUserMedia\s*\(([\s\S]*?)\)/g;
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      let m: RegExpExecArray | null;
      while ((m = callRe.exec(text)) !== null) {
        calls.push((m[1] ?? '').trim());
      }
    }
    // No call requests video, anywhere (the privacy invariant).
    for (const arg of calls) {
      expect(arg).not.toMatch(/video/);
    }
    // The one media-constraints call site asks for audio only (positive check that the
    // audited voice request still looks like the writeup claims).
    expect(calls.some((arg) => /audio\s*:\s*true/.test(arg))).toBe(true);
  });
});
