import { describe, expect, it } from 'vitest';
import { mintShareToken, validateShareToken } from './shareToken.js';

describe('share token', () => {
  it('mints a long, unguessable hex token', () => {
    const t = mintShareToken();
    expect(t).toMatch(/^[0-9a-f]+$/);
    expect(t.length).toBeGreaterThanOrEqual(48); // 24 bytes -> 48 hex chars
  });

  it('mints a fresh token each call', () => {
    expect(mintShareToken()).not.toBe(mintShareToken());
  });

  it('validates a matching token (round-trip)', () => {
    const t = mintShareToken();
    expect(validateShareToken(t, t)).toBe(true);
  });

  it('rejects a non-matching token', () => {
    const a = mintShareToken();
    const b = mintShareToken();
    expect(validateShareToken(a, b)).toBe(false);
  });

  it('fails closed when the stored token is null/empty/undefined', () => {
    const given = mintShareToken();
    expect(validateShareToken(null, given)).toBe(false);
    expect(validateShareToken(undefined, given)).toBe(false);
    expect(validateShareToken('', given)).toBe(false);
  });

  it('fails closed when the presented token is empty', () => {
    const stored = mintShareToken();
    expect(validateShareToken(stored, '')).toBe(false);
  });

  it('rejects a length-mismatched token without throwing (constant-time guard)', () => {
    const stored = mintShareToken();
    expect(() => validateShareToken(stored, stored + 'extra')).not.toThrow();
    expect(validateShareToken(stored, stored + 'extra')).toBe(false);
  });
});
