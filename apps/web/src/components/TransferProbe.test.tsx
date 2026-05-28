import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ComponentSpec, Rep } from '@polymath/contract';
import { TransferProbe } from './TransferProbe.js';

// react-flow (CircuitBuilder target) needs ResizeObserver + matchMedia in jsdom.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }),
    });
  }
});
afterEach(cleanup);

function probe(targetRep: Rep, hiddenReps: Rep[]): Extract<ComponentSpec, { kind: 'TransferProbe' }> {
  return { kind: 'TransferProbe', expression: 'A AND B', targetRep, hiddenReps, itemId: 'L1-01-and' };
}

describe('TransferProbe', () => {
  it('shows the transfer-check banner', () => {
    const { container } = render(<TransferProbe spec={probe('truth_table', ['circuit', 'pseudocode'])} />);
    expect(container.querySelector('.transfer-probe__banner')?.textContent).toMatch(/transfer check/i);
  });

  it('mounts ONLY the target rep (truth_table) — hidden reps are absent from the DOM', () => {
    const { container } = render(<TransferProbe spec={probe('truth_table', ['circuit', 'pseudocode'])} />);
    expect(container.querySelector('.truth-table')).not.toBeNull();
    expect(container.querySelector('.circuit-builder')).toBeNull();
    expect(container.querySelector('[data-testid="source-input"]')).toBeNull();
  });

  it('mounts ONLY the circuit when targetRep is circuit; truth table is hidden', () => {
    const { container } = render(<TransferProbe spec={probe('circuit', ['truth_table', 'pseudocode'])} />);
    expect(container.querySelector('.circuit-builder')).not.toBeNull();
    expect(container.querySelector('.truth-table')).toBeNull();
    expect(container.querySelector('[data-testid="source-input"]')).toBeNull();
  });

  it('mounts ONLY the pseudocode editor when targetRep is pseudocode', () => {
    const { container } = render(<TransferProbe spec={probe('pseudocode', ['truth_table', 'circuit'])} />);
    expect(container.querySelector('[data-testid="source-input"]')).not.toBeNull();
    expect(container.querySelector('.truth-table')).toBeNull();
    expect(container.querySelector('.circuit-builder')).toBeNull();
  });
});
