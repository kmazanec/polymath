import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { axe } from 'jest-axe';
import type { ComponentSpec } from '@polymath/contract';
import { renderComponent } from './components/registry.js';
import { AboutSessionData } from './components/AboutSessionData.js';

/**
 * Automated accessibility audit over the jsdom-renderable surfaces (ADR-012 / AC#1):
 * every surface must return ZERO serious or critical axe-core violations. The two
 * richest widgets — react-flow (CircuitBuilder) and CodeMirror (PseudocodeChallenge)
 * — do not render meaningfully in jsdom, so they are covered by the Playwright axe
 * e2e against a real browser instead (jsdom-only would false-pass them).
 */

afterEach(cleanup);

/** axe-core severities we treat as build-failing. minor/moderate are logged but not
 *  gating (the audit fixes them opportunistically); serious/critical block. */
const GATING_IMPACTS = new Set(['serious', 'critical']);

async function expectNoSeriousViolations(node: HTMLElement): Promise<void> {
  const results = await axe(node);
  const gating = results.violations.filter((v) => v.impact && GATING_IMPACTS.has(v.impact));
  if (gating.length > 0) {
    const summary = gating
      .map((v) => `${v.impact}: ${v.id} — ${v.help} (${v.nodes.length} node[s])`)
      .join('\n');
    throw new Error(`axe found serious/critical violations:\n${summary}`);
  }
  expect(gating).toEqual([]);
}

const LESSON_INTRO: ComponentSpec = {
  kind: 'LessonIntro',
  title: 'Boolean logic',
  body: 'Welcome — you will learn AND, OR, and NOT.',
};

const HINT: ComponentSpec = { kind: 'HintCard', level: 2, body: 'Look at the AND gate first.' };

const AGENT_ANSWER: ComponentSpec = {
  kind: 'AgentAnswer',
  question: 'What does an AND gate do?',
  answer: 'It outputs 1 only when both inputs are 1.',
  topicClassification: 'on_topic',
};

const TT_PRACTICE: ComponentSpec = {
  kind: 'TruthTablePractice',
  expression: 'A AND B',
  claimedTruthTable: [0, 0, 0, 1],
  visibleReps: ['truth_table'],
};

const MASTERY: ComponentSpec = {
  kind: 'MasteryCelebration',
  conceptsMastered: ['AND', 'OR'],
  nextLessonId: 2,
};

describe('a11y axe audit (jsdom surfaces)', () => {
  it('LessonIntro has no serious/critical violations', async () => {
    const { container } = render(renderComponent(LESSON_INTRO));
    await expectNoSeriousViolations(container);
  });

  it('HintCard has no serious/critical violations', async () => {
    const { container } = render(renderComponent(HINT));
    await expectNoSeriousViolations(container);
  });

  it('AgentAnswer has no serious/critical violations', async () => {
    const { container } = render(renderComponent(AGENT_ANSWER));
    await expectNoSeriousViolations(container);
  });

  it('TruthTablePractice has no serious/critical violations', async () => {
    const { container } = render(renderComponent(TT_PRACTICE));
    await expectNoSeriousViolations(container);
  });

  it('MasteryCelebration has no serious/critical violations', async () => {
    const { container } = render(renderComponent(MASTERY));
    await expectNoSeriousViolations(container);
  });

  it('AboutSessionData (closed + open) has no serious/critical violations', async () => {
    const { container, getByRole } = render(<AboutSessionData />);
    await expectNoSeriousViolations(container);
    getByRole('button', { name: /about this session/i }).click();
    await expectNoSeriousViolations(container);
  });
});
