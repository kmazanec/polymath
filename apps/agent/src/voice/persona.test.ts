import { describe, expect, it } from 'vitest';
import { buildVoiceSystemPrompt, voiceCacheKey, VOICE_PERSONA } from './persona.js';
import type { PersonaInput } from './persona.js';

const base: PersonaInput = {
  lessonId: 1,
  lessonTitle: 'AND, OR, NOT',
  phase: 'assessed',
};

describe('buildVoiceSystemPrompt', () => {
  it('is deterministic — same input yields a byte-identical string', () => {
    expect(buildVoiceSystemPrompt(base)).toBe(buildVoiceSystemPrompt({ ...base }));
  });

  it('leads with the byte-identical stable persona block as a prefix', () => {
    const prompt = buildVoiceSystemPrompt(base);
    expect(prompt.startsWith(VOICE_PERSONA)).toBe(true);
  });

  it('keeps the stable persona prefix invariant across volatile-field changes', () => {
    // Cache-friendliness contract: the large persona/rules block must be a
    // byte-identical prefix regardless of the volatile lesson-state tail, so a
    // provider prompt cache hits across turns within a session.
    const a = buildVoiceSystemPrompt({ ...base, phase: 'practicing', lessonTitle: 'X' });
    const b = buildVoiceSystemPrompt({ ...base, phase: 'transferring', lessonTitle: 'Y' });
    expect(a.startsWith(VOICE_PERSONA)).toBe(true);
    expect(b.startsWith(VOICE_PERSONA)).toBe(true);
  });

  it('reflects the volatile lesson context in the (non-prefix) tail', () => {
    const prompt = buildVoiceSystemPrompt(base);
    expect(prompt).toContain('AND, OR, NOT');
    expect(prompt).toContain('assessed');
  });

  it('voices a Boolean-logic-only, Socratic, explain-back persona', () => {
    expect(VOICE_PERSONA).toMatch(/Boolean/);
    expect(VOICE_PERSONA.toLowerCase()).toMatch(/explain/);
  });
});

describe('voiceCacheKey', () => {
  it('is stable for the same stable inputs', () => {
    expect(voiceCacheKey(base)).toBe(voiceCacheKey({ ...base }));
  });

  it('ignores volatile fields not part of the stable prefix', () => {
    // lessonTitle is rendered in the volatile tail, not the cached prefix, so it
    // must not change the cache key.
    expect(voiceCacheKey({ ...base, lessonTitle: 'totally different' })).toBe(voiceCacheKey(base));
  });

  it('differs when lessonId differs', () => {
    expect(voiceCacheKey({ ...base, lessonId: 2 })).not.toBe(voiceCacheKey(base));
  });

  it('differs when phase differs', () => {
    expect(voiceCacheKey({ ...base, phase: 'practicing' })).not.toBe(voiceCacheKey(base));
  });
});
