import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ComponentSpec } from '@polymath/contract';
import { renderComponent } from './registry.js';
import { LESSON_1_INTRO } from '../lessonIntroContent.js';

// react-flow (used by the CircuitBuilder case) needs ResizeObserver + matchMedia.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (q: string) => ({
        matches: false,
        media: q,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
      }),
    });
  }
});

afterEach(cleanup);

describe('renderComponent', () => {
  it('renders LessonIntro for real', () => {
    const { getByRole } = render(renderComponent(LESSON_1_INTRO));
    expect(getByRole('heading').textContent).toBe('Lesson 1 — Basic operators');
  });

  it('renders the TruthTable for real (no longer a TBD stub)', () => {
    const spec: ComponentSpec = {
      kind: 'TruthTablePractice',
      expression: 'A AND B',
      claimedTruthTable: [0, 0, 0, 1],
      visibleReps: ['truth_table'],
      // F-27 AC#7: prompt required — without it the registry renders PromptMissing.
      prompt: 'Fill in the truth table for A AND B.',
    };
    const { container, queryByRole } = render(renderComponent(spec));
    expect(queryByRole('note')).toBeNull();
    expect(container.querySelector('.truth-table')).not.toBeNull();
  });

  it('renders the CircuitBuilder for real (no longer a TBD stub)', () => {
    const spec: ComponentSpec = {
      kind: 'CircuitBuilder',
      targetExpression: 'A AND B',
      claimedTruthTable: [0, 0, 0, 1],
      allowedGates: ['AND', 'OR', 'NOT'],
      visibleReps: ['circuit'],
      prompt: 'Build A AND B using the circuit editor.',
    };
    const { container, queryByRole } = render(renderComponent(spec));
    // The real component renders a palette, not the TBD note.
    expect(queryByRole('note')).toBeNull();
    expect(container.querySelector('.circuit-builder')).not.toBeNull();
  });

  it('renders the PseudocodeChallenge for real (no longer a TBD stub)', () => {
    const spec: ComponentSpec = {
      kind: 'PseudocodeChallenge',
      targetExpression: 'A AND B',
      claimedTruthTable: [0, 0, 0, 1],
      visibleReps: ['pseudocode'],
      prompt: 'Write pseudocode for A AND B.',
    };
    const { container, queryByRole } = render(renderComponent(spec));
    expect(queryByRole('note')).toBeNull();
    expect(container.querySelector('[data-testid="source-input"]')).not.toBeNull();
  });

  it('hides a rep workspace when its rep is not in visibleReps (probe integrity)', () => {
    // A transfer probe mounts e.g. CircuitBuilder with visibleReps that exclude
    // circuit — the workspace must not render (would otherwise expose a hidden rep).
    const hiddenCircuit: ComponentSpec = {
      kind: 'CircuitBuilder',
      targetExpression: 'A AND B',
      claimedTruthTable: [0, 0, 0, 1],
      allowedGates: ['AND', 'OR', 'NOT'],
      visibleReps: ['truth_table'], // circuit NOT visible
    };
    expect(render(renderComponent(hiddenCircuit)).container.querySelector('.circuit-builder')).toBeNull();

    const hiddenTruthTable: ComponentSpec = {
      kind: 'TruthTablePractice',
      expression: 'A AND B',
      claimedTruthTable: [0, 0, 0, 1],
      visibleReps: ['circuit'], // truth_table NOT visible
    };
    expect(render(renderComponent(hiddenTruthTable)).container.querySelector('.truth-table')).toBeNull();

    const hiddenPseudo: ComponentSpec = {
      kind: 'PseudocodeChallenge',
      targetExpression: 'A AND B',
      claimedTruthTable: [0, 0, 0, 1],
      visibleReps: ['circuit'], // pseudocode NOT visible
    };
    expect(
      render(renderComponent(hiddenPseudo)).container.querySelector('[data-testid="source-input"]'),
    ).toBeNull();
  });

  it('renders AgentAnswer for real, flagging the topic classification (criteria 4,5)', () => {
    const onTopic: ComponentSpec = {
      kind: 'AgentAnswer',
      question: 'what does AND do?',
      answer: 'true only when both inputs are true',
      topicClassification: 'on_topic',
    };
    const { container, queryByRole } = render(renderComponent(onTopic));
    expect(queryByRole('note')).toBeNull();
    const section = container.querySelector('.agent-answer');
    expect(section?.getAttribute('data-topic')).toBe('on_topic');
    expect(section?.textContent).toContain('true only when both inputs are true');

    cleanup();
    const offTopic: ComponentSpec = {
      kind: 'AgentAnswer',
      question: 'book me a flight',
      answer: 'I can help with Boolean logic — Nerdy has other tutors for that.',
      topicClassification: 'off_topic',
    };
    expect(
      render(renderComponent(offTopic)).container.querySelector('.agent-answer')?.getAttribute('data-topic'),
    ).toBe('off_topic');
  });

  it('threads onSubmit to a rep so a learner submission is dispatchable', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const calls: { submission: string; correct: boolean }[] = [];
    const spec: ComponentSpec = {
      kind: 'TruthTablePractice',
      expression: 'NOT A',
      claimedTruthTable: [1, 0],
      visibleReps: ['truth_table'],
      // F-27 AC#7: prompt required.
      prompt: 'Fill in the truth table for NOT A.',
    };
    const { getByRole, getAllByRole } = render(
      renderComponent(spec, { onSubmit: (p) => calls.push({ submission: p.submission, correct: p.correct }) }),
    );
    // Output cells start as "?" and Submit is gated until every cell is set; set
    // each one (one click: ? → 0) so the submission is dispatchable.
    getAllByRole('button')
      .filter((b) => b.getAttribute('aria-pressed') !== null)
      .forEach((b) => fireEvent.click(b));
    fireEvent.click(getByRole('button', { name: /submit/i }));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.submission).toBe('NOT A');
  });

  it('renders HintCard for real (no longer a TBD stub)', () => {
    const spec: ComponentSpec = { kind: 'HintCard', level: 1, body: 'Look at the AND gate.' };
    const { container, queryByRole } = render(renderComponent(spec));
    // Must no longer have the data-tbd marker
    expect(queryByRole('note')?.getAttribute('data-tbd')).toBeNull();
    expect(container.querySelector('.hint-card')).not.toBeNull();
    expect(container.querySelector('.hint-card--level-1')).not.toBeNull();
  });

  // F-27 AC#7: prompt-on-every-challenge enforcement.
  describe('renderComponent AC#7 — prompt-less items render PromptMissing', () => {
    it('TruthTablePractice without prompt renders role="alert" error, not the table', () => {
      const spec: ComponentSpec = {
        kind: 'TruthTablePractice',
        expression: 'A AND B',
        claimedTruthTable: [0, 0, 0, 1],
        visibleReps: ['truth_table'],
        // No prompt — intentionally omitted to test AC#7.
      };
      const { container, getByRole } = render(renderComponent(spec));
      expect(getByRole('alert')).not.toBeNull();
      expect(container.querySelector('.truth-table')).toBeNull();
      expect(container.querySelector('[data-prompt-missing="TruthTablePractice"]')).not.toBeNull();
    });

    it('CircuitBuilder without prompt renders role="alert" error', () => {
      const spec: ComponentSpec = {
        kind: 'CircuitBuilder',
        targetExpression: 'A AND B',
        claimedTruthTable: [0, 0, 0, 1],
        allowedGates: ['AND', 'OR', 'NOT'],
        visibleReps: ['circuit'],
      };
      const { container, getByRole } = render(renderComponent(spec));
      expect(getByRole('alert')).not.toBeNull();
      expect(container.querySelector('.circuit-builder')).toBeNull();
    });

    it('PseudocodeChallenge without prompt renders role="alert" error', () => {
      const spec: ComponentSpec = {
        kind: 'PseudocodeChallenge',
        targetExpression: 'A AND B',
        claimedTruthTable: [0, 0, 0, 1],
        visibleReps: ['pseudocode'],
      };
      const { container, getByRole } = render(renderComponent(spec));
      expect(getByRole('alert')).not.toBeNull();
      expect(container.querySelector('[data-testid="source-input"]')).toBeNull();
    });

    it('TruthTablePractice WITH prompt renders the truth table normally', () => {
      const spec: ComponentSpec = {
        kind: 'TruthTablePractice',
        expression: 'A AND B',
        claimedTruthTable: [0, 0, 0, 1],
        visibleReps: ['truth_table'],
        prompt: 'Fill in the truth table for A AND B.',
      };
      const { container, queryByRole } = render(renderComponent(spec));
      expect(queryByRole('alert')).toBeNull();
      expect(container.querySelector('.truth-table')).not.toBeNull();
    });
  });
});
