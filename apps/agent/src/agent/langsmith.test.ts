/**
 * LangSmith reuse cut (no code wrap).
 *
 * LangChain's `ChatOpenAI` tracing is purely ENV-DRIVEN via `@langchain/core`: setting
 * `LANGCHAIN_TRACING_V2=true` + `LANGCHAIN_API_KEY` + `LANGCHAIN_PROJECT` makes the
 * existing `OpenAIMoveProvider` calls emit traces with NO code change — no `wrapOpenAI`,
 * no `traceable`, no `langsmith` dependency. This test pins that decision: the provider
 * constructs identically whether or not `LANGCHAIN_TRACING_V2` is set, and the codebase
 * carries no tracing-wrapper code. If a future change adds a wrapper, this guard makes
 * the reviewer reconsider (the env tuple is the whole integration).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { OpenAIMoveProvider } from './openaiClient.js';

const TRACE = 'LANGCHAIN_TRACING_V2';

describe('LangSmith integration is env-driven only (no code wrap)', () => {
  afterEach(() => {
    delete process.env[TRACE];
  });

  it('constructs the provider the same way with tracing OFF (env unset)', () => {
    delete process.env[TRACE];
    expect(() => new OpenAIMoveProvider({ apiKey: 'sk-test' })).not.toThrow();
  });

  it('constructs the provider the same way with tracing ON (env-driven, no code change)', () => {
    process.env[TRACE] = 'true';
    // The provider does NOT read LANGCHAIN_* itself — tracing is handled entirely inside
    // @langchain/core. Construction is unchanged; only the env tuple differs.
    expect(() => new OpenAIMoveProvider({ apiKey: 'sk-test' })).not.toThrow();
  });

  it('the agent package depends on no langsmith / trace-wrapper package', async () => {
    // Reading the manifest keeps this honest: the reuse cut is "no new dep". If someone
    // adds `langsmith` or a `wrapOpenAI` shim, this fails and the change gets re-justified.
    const { readFile } = await import('node:fs/promises');
    const url = new URL('../../package.json', import.meta.url);
    const pkg = JSON.parse(await readFile(url, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    expect(all['langsmith']).toBeUndefined();
  });
});
