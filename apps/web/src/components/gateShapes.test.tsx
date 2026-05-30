import { describe, expect, it, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { GateShape } from './gateShapes.js';

afterEach(() => cleanup());

describe('GateShape', () => {
  it('renders an svg with the gate kind as a data attribute', () => {
    const { container } = render(<GateShape kind="AND" />);
    const svg = container.querySelector('svg[data-gate-shape="AND"]');
    expect(svg).toBeTruthy();
  });
  it('renders an inversion bubble for NAND/NOR/NOT but not AND/OR', () => {
    for (const k of ['NOT', 'NAND', 'NOR'] as const) {
      const { container } = render(<GateShape kind={k} />);
      expect(container.querySelector('[data-bubble]'), `${k} has bubble`).toBeTruthy();
      cleanup();
    }
    for (const k of ['AND', 'OR'] as const) {
      const { container } = render(<GateShape kind={k} />);
      expect(container.querySelector('[data-bubble]'), `${k} no bubble`).toBeNull();
      cleanup();
    }
  });
  it('marks the body live when live=true', () => {
    const { container } = render(<GateShape kind="AND" live />);
    expect(container.querySelector('[data-live="true"]')).toBeTruthy();
  });
});
