import { describe, expect, it } from 'vitest';
import { shouldAnimate } from './AnimateOrNot.js';

describe('shouldAnimate (motion budget)', () => {
  it('animates during practice when motion is allowed', () => {
    expect(shouldAnimate('practicing', false)).toBe(true);
  });

  it('never animates during a transfer probe', () => {
    expect(shouldAnimate('transferring', false)).toBe(false);
  });

  it('never animates when the user prefers reduced motion', () => {
    expect(shouldAnimate('practicing', true)).toBe(false);
    expect(shouldAnimate('introducing', true)).toBe(false);
  });
});
