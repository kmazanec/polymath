/**
 * A live microphone level meter that reads from a MediaStream via Web Audio.
 *
 * Designed for the composer bar's fixed-dark surface (ADR-018: voice UI). The
 * meter uses Web Audio AnalyserNode + requestAnimationFrame to read frequency
 * data and renders a row of level bars. It is a pure presentational component —
 * all logic is encapsulated, no external state dependencies.
 *
 * React-correctness: the AudioContext + AnalyserNode are created inside a
 * useEffect that also cancels the rAF loop and closes the context on cleanup,
 * so no Audio objects outlive the component. The effect depends on `stream`; a
 * null stream renders nothing (guard for jsdom / pre-connected states).
 *
 * Testability: the component guards `typeof AudioContext` so it renders a
 * static placeholder in jsdom (where Web Audio is absent) without throwing.
 * Tests assert clean mount/unmount in the AudioContext-absent path.
 */

import { type ReactElement, useEffect, useRef, useState } from 'react';

interface MicLevelMeterProps {
  /** The live mic MediaStream. Null → renders nothing. */
  stream: MediaStream | null;
}

const BAR_COUNT = 5;

export function MicLevelMeter({ stream }: MicLevelMeterProps): ReactElement | null {
  const [levels, setLevels] = useState<number[]>(() => Array(BAR_COUNT).fill(0) as number[]);
  // Ref to the rAF handle so cleanup can cancel it without a closure-over-stale-id.
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!stream) return;

    // Guard: Web Audio unavailable in jsdom / server environments.
    type GlobalWithWebkit = typeof globalThis & { webkitAudioContext?: new (opts?: AudioContextOptions) => AudioContext };
    const g = globalThis as GlobalWithWebkit;
    const AudioContextCtor: (new (opts?: AudioContextOptions) => AudioContext) | null =
      typeof g.AudioContext !== 'undefined'
        ? g.AudioContext
        : typeof g.webkitAudioContext !== 'undefined'
        ? (g.webkitAudioContext ?? null)
        : null;

    if (!AudioContextCtor) {
      // No Web Audio: keep bars at zero (the static placeholder the test expects).
      return;
    }

    let ctx: AudioContext | null = null;

    try {
      ctx = new AudioContextCtor();
    } catch {
      // Construction can fail in restricted environments; degrade silently.
      return;
    }

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64; // small: 32 frequency bins, low CPU
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);

    const bufLen = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufLen);

    let cancelled = false;

    function tick(): void {
      if (cancelled) return;
      analyser.getByteFrequencyData(dataArray);

      // Map the first BAR_COUNT bins to [0, 1] level values.
      const binWidth = Math.floor(bufLen / BAR_COUNT);
      const next: number[] = Array.from({ length: BAR_COUNT }, (_, i) => {
        const start = i * binWidth;
        let sum = 0;
        for (let j = start; j < start + binWidth; j++) {
          sum += dataArray[j] ?? 0;
        }
        return Math.min(1, (sum / binWidth) / 255);
      });

      setLevels(next);
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      source.disconnect();
      void ctx?.close();
    };
  }, [stream]);

  if (!stream) return null;

  return (
    <span className="mic-level-meter" aria-hidden="true" role="presentation">
      {levels.map((level, i) => (
        <span
          key={i}
          className="mic-level-meter__bar"
          style={{ '--level': level.toFixed(3) } as React.CSSProperties}
        />
      ))}
    </span>
  );
}
