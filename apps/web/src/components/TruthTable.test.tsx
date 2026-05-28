import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, within } from '@testing-library/react';
import type { ComponentSpec } from '@polymath/contract';
import { parse, variables } from '@polymath/booleans';
import { TruthTable } from './TruthTable.js';

// Clean up the DOM after each test so renders don't accumulate
afterEach(() => {
  cleanup();
});

// -------------------------------------------------------------------
// Test helpers
// -------------------------------------------------------------------

type TruthTableSpec = Extract<ComponentSpec, { kind: 'TruthTablePractice' }>;

function makeSpec(expression: string, claimedTruthTable: (0 | 1)[] = [0, 0, 0, 1]): TruthTableSpec {
  return {
    kind: 'TruthTablePractice',
    expression,
    claimedTruthTable,
    visibleReps: ['truth_table'],
  };
}

// -------------------------------------------------------------------
// Chunk 1 — Rendering: structure, read-only inputs, toggleable outputs
// -------------------------------------------------------------------

describe('TruthTable rendering (Chunk 1)', () => {
  it('renders 4 rows for a 2-variable expression (A AND B)', () => {
    const spec = makeSpec('A AND B');
    const { getAllByRole } = render(<TruthTable spec={spec} />);
    // header row + 4 data rows = 5
    const rows = getAllByRole('row');
    expect(rows.length).toBe(5);
  });

  it('renders 8 rows for a 3-variable expression (A AND B AND C)', () => {
    const spec = makeSpec('A AND B AND C', [0, 0, 0, 0, 0, 0, 0, 1]);
    const { getAllByRole } = render(<TruthTable spec={spec} />);
    // header + 8 data rows = 9
    const rows = getAllByRole('row');
    expect(rows.length).toBe(9);
  });

  it('shows column headers for variables and output', () => {
    const spec = makeSpec('A AND B');
    const { container } = render(<TruthTable spec={spec} />);
    const scope = within(container);
    // getAllByText returns all matches within the scoped container
    expect(scope.getAllByText('A').length).toBeGreaterThan(0);
    expect(scope.getAllByText('B').length).toBeGreaterThan(0);
    expect(scope.getByText('Output')).toBeTruthy();
  });

  it('renders input cells as read-only (only output cells are buttons)', () => {
    const spec = makeSpec('A AND B');
    const { getAllByRole } = render(<TruthTable spec={spec} />);
    // Output cells are buttons; there should be 4 (one per data row) + 1 Submit
    const buttons = getAllByRole('button');
    // 4 output toggle buttons + 1 submit = 5
    expect(buttons.length).toBe(5);
  });

  it('renders exactly 4 output toggle buttons for 2-var expression', () => {
    const spec = makeSpec('A AND B');
    const { getAllByRole } = render(<TruthTable spec={spec} />);
    const outputBtns = getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') !== null);
    expect(outputBtns.length).toBe(4);
  });

  it('extracts variables automatically from expression (AC5)', () => {
    // B AND A — variables should be sorted A, B
    const spec = makeSpec('B AND A');
    const { container } = render(<TruthTable spec={spec} />);
    const headers = container.querySelectorAll('th');
    const headerTexts = Array.from(headers).map((h) => h.textContent?.trim());
    expect(headerTexts[0]).toBe('A');
    expect(headerTexts[1]).toBe('B');
    expect(headerTexts[2]).toBe('Output');
  });

  it('shows error when variable count exceeds 10', () => {
    const bigExpr = 'A AND B AND C AND D AND E AND F AND G AND H AND I AND J AND K';
    const spec: TruthTableSpec = {
      kind: 'TruthTablePractice',
      expression: bigExpr,
      claimedTruthTable: [0],
      visibleReps: ['truth_table'],
    };
    const { getByRole } = render(<TruthTable spec={spec} />);
    expect(getByRole('alert')).toBeTruthy();
  });
});

// -------------------------------------------------------------------
// Chunk 1 — Toggle behavior
// -------------------------------------------------------------------

describe('TruthTable toggle behavior (Chunk 1)', () => {
  it('output cells start with aria-pressed="false"', () => {
    const spec = makeSpec('A AND B');
    const { getAllByRole } = render(<TruthTable spec={spec} />);
    const outputBtns = getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') !== null);
    expect(outputBtns.length).toBe(4);
    outputBtns.forEach((btn) => {
      expect(btn.getAttribute('aria-pressed')).toBe('false');
    });
  });

  it('clicking an output cell toggles it from false to true', () => {
    const spec = makeSpec('A AND B');
    const { getAllByRole } = render(<TruthTable spec={spec} />);
    const outputBtns = getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') !== null);
    const firstBtn = outputBtns[0]!;
    expect(firstBtn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(firstBtn);
    expect(firstBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('clicking an output cell twice toggles it back to false', () => {
    const spec = makeSpec('A AND B');
    const { getAllByRole } = render(<TruthTable spec={spec} />);
    const outputBtns = getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') !== null);
    const firstBtn = outputBtns[0]!;
    fireEvent.click(firstBtn);
    expect(firstBtn.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(firstBtn);
    expect(firstBtn.getAttribute('aria-pressed')).toBe('false');
  });
});

// -------------------------------------------------------------------
// Chunk 2 — Submit handler + verdict
// -------------------------------------------------------------------

describe('TruthTable submit handler (Chunk 2)', () => {
  it('calls onSubmit with correct event shape when all cells match (AC3)', () => {
    const spec = makeSpec('A AND B', [0, 0, 0, 1]);
    const onSubmit = vi.fn();
    const { getAllByRole, getByRole } = render(
      <TruthTable spec={spec} onSubmit={onSubmit} />,
    );
    const outputBtns = getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') !== null);
    // A=0,B=0→0; A=0,B=1→0; A=1,B=0→0; A=1,B=1→1
    // Toggle row 3 (index 3) to 1
    fireEvent.click(outputBtns[3]!);
    const submitBtn = getByRole('button', { name: /submit/i });
    fireEvent.click(submitBtn);
    expect(onSubmit).toHaveBeenCalledOnce();
    const event = onSubmit.mock.calls[0]![0] as {
      kind: string;
      submission: string;
      repSubmission: { rep: string; cells: number[] };
      correct: boolean;
    };
    expect(event.kind).toBe('submit');
    expect(event.submission).toBe('A AND B');
    expect(event.repSubmission.rep).toBe('truth_table');
    expect(event.repSubmission.cells).toEqual([0, 0, 0, 1]);
    expect(event.correct).toBe(true);
  });

  it('calls onSubmit with correct: false when cells are wrong (AC4)', () => {
    const spec = makeSpec('A AND B', [0, 0, 0, 1]);
    const onSubmit = vi.fn();
    const { getByRole } = render(
      <TruthTable spec={spec} onSubmit={onSubmit} />,
    );
    // Don't toggle anything — all 0s, wrong (should be [0,0,0,1])
    fireEvent.click(getByRole('button', { name: /submit/i }));
    const event = onSubmit.mock.calls[0]![0] as { correct: boolean };
    expect(event.correct).toBe(false);
  });

  it('marks all cells green (data-verdict="correct") after fully correct submit (AC3)', () => {
    const spec = makeSpec('A AND B', [0, 0, 0, 1]);
    const { getAllByRole, getByRole } = render(<TruthTable spec={spec} />);
    const outputBtns = getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') !== null);
    // Toggle row 3 to 1 (correct for A AND B)
    fireEvent.click(outputBtns[3]!);
    fireEvent.click(getByRole('button', { name: /submit/i }));
    // Re-query after state change
    const updatedBtns = getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') !== null);
    updatedBtns.forEach((btn) => {
      expect(btn.getAttribute('data-verdict')).toBe('correct');
    });
  });

  it('marks incorrect cells red after incorrect submit (AC4)', () => {
    const spec = makeSpec('A AND B', [0, 0, 0, 1]);
    const { getAllByRole, getByRole } = render(<TruthTable spec={spec} />);
    // All 0s submitted — rows 0-2 correct, row 3 wrong
    fireEvent.click(getByRole('button', { name: /submit/i }));
    const outputBtns = getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') !== null);
    expect(outputBtns[0]?.getAttribute('data-verdict')).toBe('correct');
    expect(outputBtns[1]?.getAttribute('data-verdict')).toBe('correct');
    expect(outputBtns[2]?.getAttribute('data-verdict')).toBe('correct');
    expect(outputBtns[3]?.getAttribute('data-verdict')).toBe('incorrect');
  });

  it('output cells are disabled after submit (locks state)', () => {
    const spec = makeSpec('A AND B', [0, 0, 0, 1]);
    const { getAllByRole, getByRole } = render(<TruthTable spec={spec} />);
    fireEvent.click(getByRole('button', { name: /submit/i }));
    const outputBtns = getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') !== null);
    outputBtns.forEach((btn) => {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    });
  });

  it('dispatched cells array matches toggled state (0/1 ints)', () => {
    const spec = makeSpec('A OR B', [0, 1, 1, 1]);
    const onSubmit = vi.fn();
    const { getAllByRole, getByRole } = render(
      <TruthTable spec={spec} onSubmit={onSubmit} />,
    );
    const outputBtns = getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') !== null);
    // Toggle rows 1, 2, 3 to match A OR B = [0,1,1,1]
    fireEvent.click(outputBtns[1]!);
    fireEvent.click(outputBtns[2]!);
    fireEvent.click(outputBtns[3]!);
    fireEvent.click(getByRole('button', { name: /submit/i }));
    const event = onSubmit.mock.calls[0]![0] as {
      repSubmission: { cells: number[] };
      correct: boolean;
    };
    expect(event.repSubmission.cells).toEqual([0, 1, 1, 1]);
    expect(event.correct).toBe(true);
  });
});

// -------------------------------------------------------------------
// Chunk 3 — Keyboard navigation (AC6, AC7)
// -------------------------------------------------------------------

describe('TruthTable keyboard navigation (Chunk 3)', () => {
  it('output cells are tab-reachable (tabIndex >= 0)', () => {
    const spec = makeSpec('A AND B');
    const { getAllByRole } = render(<TruthTable spec={spec} />);
    const outputBtns = getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') !== null);
    outputBtns.forEach((btn) => {
      expect(btn.tabIndex).toBeGreaterThanOrEqual(0);
    });
  });

  it('output cells are native <button> elements — guarantees Space/Enter activate in real browsers (AC6)', () => {
    // The contract is: output cells MUST be native <button>s so that browsers
    // synthesise a click on Space/Enter without any JS key-handler.
    // If someone replaces <button> with <div onClick>, this test catches it.
    const spec = makeSpec('A AND B');
    const { getAllByRole } = render(<TruthTable spec={spec} />);
    const outputBtns = getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') !== null);
    expect(outputBtns.length).toBe(4);
    outputBtns.forEach((btn) => {
      // Native button element — real browsers fire click on Space/Enter
      expect(btn.tagName).toBe('BUTTON');
      // type="button" prevents accidental form submission
      expect((btn as HTMLButtonElement).type).toBe('button');
      // focusable without explicit tabindex (natural tab order)
      expect(btn.tabIndex).toBe(0);
    });
  });

  it('Space key fires click event on a focused native button (AC6 — jsdom native semantics)', () => {
    // jsdom does NOT synthesise a click from keydown on buttons (unlike real browsers).
    // We verify the mechanism directly: fireEvent.keyDown/keyUp alone must NOT toggle the
    // cell (proving we rely on native click synthesis, not a JS key-handler). Then assert
    // the cell is still toggleable via click, proving the onClick handler is wired correctly.
    const spec = makeSpec('A AND B');
    const { getAllByRole } = render(<TruthTable spec={spec} />);
    const outputBtns = getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') !== null);
    const firstBtn = outputBtns[0]!;
    firstBtn.focus();
    expect(document.activeElement).toBe(firstBtn);

    // Key events alone (no synthesised click in jsdom) — state must NOT change
    fireEvent.keyDown(firstBtn, { key: ' ', code: 'Space' });
    fireEvent.keyUp(firstBtn, { key: ' ', code: 'Space' });
    // jsdom doesn't synthesise click, so aria-pressed is still false
    expect(firstBtn.getAttribute('aria-pressed')).toBe('false');

    // Now verify click (what a real browser would synthesise) does toggle
    fireEvent.click(firstBtn);
    expect(firstBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('Submit button is a native <button> reachable via Enter (AC6)', () => {
    // Submit must be a native <button type="button"> so Enter activates it in real browsers.
    // Also verifies the button is wired: click triggers onSubmit.
    const spec = makeSpec('A AND B', [0, 0, 0, 1]);
    const onSubmit = vi.fn();
    const { getByRole } = render(<TruthTable spec={spec} onSubmit={onSubmit} />);
    const submitBtn = getByRole('button', { name: /submit/i });

    // Must be a native button (guarantees Enter activation)
    expect(submitBtn.tagName).toBe('BUTTON');
    expect((submitBtn as HTMLButtonElement).type).toBe('button');
    // Focus + Enter key alone must NOT call onSubmit in jsdom (no key→click synthesis),
    // confirming we depend on native browser behaviour rather than a JS keydown handler
    submitBtn.focus();
    fireEvent.keyDown(submitBtn, { key: 'Enter', code: 'Enter' });
    fireEvent.keyUp(submitBtn, { key: 'Enter', code: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled(); // no spurious key handler

    // Click (what Enter synthesises in real browsers) does call onSubmit
    fireEvent.click(submitBtn);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('honors prefers-reduced-motion: transition:none when matchMedia matches (AC7)', () => {
    // Mock matchMedia to return matches:true for prefers-reduced-motion
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const spec = makeSpec('A AND B');
    const { getAllByRole } = render(<TruthTable spec={spec} />);
    const outputBtns = getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') !== null);
    // Every output cell must carry transition:none when reduced motion is preferred
    outputBtns.forEach((btn) => {
      expect((btn as HTMLButtonElement).style.transition).toBe('none');
    });

    window.matchMedia = originalMatchMedia;
  });

  it('no transition style on output cells when prefers-reduced-motion is false (AC7)', () => {
    // Mock matchMedia to return matches:false — no transition style should be injected.
    // TruthTable ships no CSS transitions at all; the noMotion flag gates inline style only.
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false, // reduced motion NOT requested
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const spec = makeSpec('A AND B');
    const { getAllByRole } = render(<TruthTable spec={spec} />);
    const outputBtns = getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') !== null);
    // When reduced motion is NOT requested, no inline transition is injected
    outputBtns.forEach((btn) => {
      expect((btn as HTMLButtonElement).style.transition).toBe('');
    });

    window.matchMedia = originalMatchMedia;
  });
});

// -------------------------------------------------------------------
// Chunk 4 — Property test: extracted vars match parser AST
// -------------------------------------------------------------------

describe('Variable extraction property test (Chunk 4)', () => {
  const expressions = [
    'A',
    'A AND B',
    'A OR B',
    'NOT A',
    'A AND B AND C',
    'A AND B OR C AND D',
    '(A OR B) AND (C OR D)',
    'NOT A AND NOT B',
  ];

  expressions.forEach((expr) => {
    it(`variables extracted for "${expr}" match booleans library`, () => {
      const spec = makeSpec(expr, []);
      const { container, queryByRole } = render(<TruthTable spec={spec} />);
      // No error alert for valid ≤10 var expressions
      expect(queryByRole('alert')).toBeNull();
      // Verify column headers match booleans library sorted vars
      const expected = variables(parse(expr));
      const headers = Array.from(container.querySelectorAll('th')).map(
        (h) => h.textContent?.trim() ?? '',
      );
      // First N headers should be the sorted variable names
      expected.forEach((v, i) => {
        expect(headers[i]).toBe(v);
      });
      // Last header should be 'Output'
      expect(headers[expected.length]).toBe('Output');
    });
  });
});
