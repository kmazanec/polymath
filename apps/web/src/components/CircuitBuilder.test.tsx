import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentSpec } from '@polymath/contract';
import { CircuitBuilder } from './CircuitBuilder.js';

type CircuitSpec = Extract<ComponentSpec, { kind: 'CircuitBuilder' }>;

const spec: CircuitSpec = {
  kind: 'CircuitBuilder',
  targetExpression: 'A AND B',
  claimedTruthTable: [0, 0, 0, 1],
  allowedGates: ['AND', 'OR', 'NOT'],
  visibleReps: ['circuit'],
};

// react-flow needs ResizeObserver + matchMedia in jsdom.
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
        dispatchEvent() {
          return false;
        },
      }),
    });
  }
});

afterEach(cleanup);

describe('CircuitBuilder', () => {
  it('renders a palette button per allowed gate (AC1)', () => {
    render(<CircuitBuilder spec={spec} />);
    expect(screen.getByRole('button', { name: /Add AND gate/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Add OR gate/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Add NOT gate/i })).toBeDefined();
  });

  it('exposes Test it and Submit controls', () => {
    render(<CircuitBuilder spec={spec} />);
    expect(screen.getByText('Test it')).toBeDefined();
    expect(screen.getByText('Submit')).toBeDefined();
  });

  it('renders a NAND palette button when allowedGates is NAND-only (Lesson 3, AC#3)', () => {
    const nandSpec: CircuitSpec = {
      kind: 'CircuitBuilder',
      targetExpression: 'NOT A',
      claimedTruthTable: [1, 0],
      allowedGates: ['NAND'],
      visibleReps: ['circuit'],
    };
    render(<CircuitBuilder spec={nandSpec} />);
    const nandBtn = screen.getByRole('button', { name: /Add NAND gate/i });
    expect(nandBtn).toBeDefined();
    expect(nandBtn.getAttribute('data-gate')).toBe('NAND');
    // A NAND-only workspace offers NO AND/OR/NOT palette buttons.
    expect(screen.queryByRole('button', { name: /Add AND gate/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add OR gate/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add NOT gate/i })).toBeNull();
  });

  it('renders nothing when its rep is hidden during a transfer probe (AC9)', () => {
    const { container } = render(<CircuitBuilder spec={spec} hiddenReps={['circuit']} />);
    expect(container.firstChild).toBeNull();
  });

  it('has a polite live region for pulse announcements (AC11)', () => {
    render(<CircuitBuilder spec={spec} />);
    const region = document.querySelector('[data-pulse-announce]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('aria-live')).toBe('polite');
  });

  it('shows the step-through label under reduced motion (AC8)', () => {
    (window.matchMedia as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockImplementation(
      (q: string) => ({
        matches: q.includes('reduce'),
        media: q,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
      }),
    );
    render(<CircuitBuilder spec={spec} />);
    expect(screen.getByText('Next gate →')).toBeDefined();
  });
});
