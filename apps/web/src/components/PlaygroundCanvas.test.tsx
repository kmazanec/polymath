import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import type { ComponentSpec } from '@polymath/contract';
import { PlaygroundCanvas } from './PlaygroundCanvas.js';

// react-flow (the composed CircuitBuilder) needs ResizeObserver + matchMedia.
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

const SPEC: Extract<ComponentSpec, { kind: 'PlaygroundCanvas' }> = {
  kind: 'PlaygroundCanvas',
  visibleReps: ['truth_table', 'circuit', 'pseudocode'],
};

function setTarget(getByLabelText: ReturnType<typeof render>['getByLabelText'], getByRole: ReturnType<typeof render>['getByRole'], expr: string): void {
  fireEvent.change(getByLabelText(/target expression/i), { target: { value: expr } });
  fireEvent.click(getByRole('button', { name: /set target/i }));
}

describe('PlaygroundCanvas (ADR-013 free-build capstone)', () => {
  it('AC#2: starts by asking the learner to propose a target expression', () => {
    const { getByLabelText, getByRole, queryByText } = render(<PlaygroundCanvas spec={SPEC} />);
    expect(getByLabelText(/target expression/i)).toBeTruthy();
    expect(getByRole('button', { name: /set target/i })).toBeTruthy();
    // The rep editors are not shown until a target is set.
    expect(queryByText(/build your target across all three/i)).toBeNull();
  });

  it('AC#3: once a target is set, all three rep editors become available simultaneously', () => {
    const { getByLabelText, getByRole, getAllByText, container } = render(<PlaygroundCanvas spec={SPEC} />);
    setTarget(getByLabelText, getByRole, 'A AND B');
    // The target echoes in the playground header (and in each rep editor's prompt).
    expect(getAllByText('A AND B').length).toBeGreaterThan(0);
    // truth table (a <table>), circuit (react-flow region), pseudocode (CM6 region) all present.
    expect(container.querySelector('table')).toBeTruthy();
    expect(getByRole('region', { name: /write a boolean expression/i })).toBeTruthy();
  });

  it('refuses an unparseable / empty target (stays in proposing)', () => {
    const { getByLabelText, getByRole, queryByText } = render(<PlaygroundCanvas spec={SPEC} />);
    fireEvent.click(getByRole('button', { name: /set target/i })); // empty
    expect(queryByText(/build your target/i)).toBeNull();
    setTarget(getByLabelText, getByRole, ')(garbage');
    expect(queryByText(/build your target/i)).toBeNull();
    // an error is surfaced
    expect(getByRole('alert')).toBeTruthy();
  });

  it('AC#4: pressing Submit fires onPlaygroundSubmit with the target + the reps the learner built', () => {
    const onPlaygroundSubmit = vi.fn();
    const { getByLabelText, getByRole, getByTestId } = render(
      <PlaygroundCanvas spec={SPEC} onPlaygroundSubmit={onPlaygroundSubmit} />,
    );
    setTarget(getByLabelText, getByRole, 'A OR B');
    // Author an equivalent pseudocode rep, then submit it within its own editor.
    fireEvent.change(getByTestId('source-input'), { target: { value: 'B or A' } });
    const pseudoRegion = getByRole('region', { name: /write a boolean expression/i });
    fireEvent.click(within(pseudoRegion).getByRole('button', { name: /^submit$/i }));
    // Now the unified playground Submit.
    fireEvent.click(getByRole('button', { name: /^check my work$/i }));
    expect(onPlaygroundSubmit).toHaveBeenCalledTimes(1);
    const payload = onPlaygroundSubmit.mock.calls[0][0];
    expect(payload.targetExpression).toBe('A OR B');
    expect(payload.submissions.pseudocode).toMatchObject({ rep: 'pseudocode', expression: expect.any(String) });
    // client-side per-rep verdict: pseudocode equivalent → true
    expect(payload.verdict.byKey.pseudocode).toBe(true);
  });

  it('AC#4: a non-equivalent rep shows a mismatch badge and allEquivalent is false', () => {
    const onPlaygroundSubmit = vi.fn();
    const { getByLabelText, getByRole, getByTestId } = render(
      <PlaygroundCanvas spec={SPEC} onPlaygroundSubmit={onPlaygroundSubmit} />,
    );
    setTarget(getByLabelText, getByRole, 'A AND B');
    fireEvent.change(getByTestId('source-input'), { target: { value: 'A or B' } }); // wrong
    const pseudoRegion = getByRole('region', { name: /write a boolean expression/i });
    fireEvent.click(within(pseudoRegion).getByRole('button', { name: /^submit$/i }));
    fireEvent.click(getByRole('button', { name: /^check my work$/i }));
    const payload = onPlaygroundSubmit.mock.calls[0][0];
    expect(payload.verdict.byKey.pseudocode).toBe(false);
    expect(payload.verdict.allEquivalent).toBe(false);
    expect(getByRole('status', { name: /playground verdict/i }).textContent).toMatch(
      /not equivalent|mismatch|keep/i,
    );
  });

  it('AC#5: a Request-scaffold button fires onRequestScaffold (agent does not direct)', () => {
    const onRequestScaffold = vi.fn();
    const { getByLabelText, getByRole } = render(
      <PlaygroundCanvas spec={SPEC} onRequestScaffold={onRequestScaffold} />,
    );
    setTarget(getByLabelText, getByRole, 'A AND B');
    fireEvent.click(getByRole('button', { name: /request a hint|request scaffold/i }));
    expect(onRequestScaffold).toHaveBeenCalledTimes(1);
    expect(onRequestScaffold.mock.calls[0][0].targetExpression).toBe('A AND B');
  });

  it('AC#6: a Finish button fires onExitPlayground', () => {
    const onExitPlayground = vi.fn();
    const { getByLabelText, getByRole } = render(
      <PlaygroundCanvas spec={SPEC} onExitPlayground={onExitPlayground} />,
    );
    setTarget(getByLabelText, getByRole, 'A AND B');
    fireEvent.click(getByRole('button', { name: /finish/i }));
    expect(onExitPlayground).toHaveBeenCalledTimes(1);
  });

  it('probe-integrity: honors visibleReps — a rep not in visibleReps is not rendered', () => {
    const ttOnly: Extract<ComponentSpec, { kind: 'PlaygroundCanvas' }> = {
      kind: 'PlaygroundCanvas',
      visibleReps: ['truth_table'],
    };
    const { getByLabelText, getByRole, queryByRole, container } = render(<PlaygroundCanvas spec={ttOnly} />);
    setTarget(getByLabelText, getByRole, 'A AND B');
    expect(container.querySelector('table')).toBeTruthy(); // truth table visible
    // pseudocode region absent (its rep not visible)
    expect(queryByRole('region', { name: /write a boolean expression/i })).toBeNull();
  });
});
