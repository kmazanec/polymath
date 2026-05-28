/**
 * Tests for PseudocodeChallenge (F-04).
 *
 * CodeMirror 6 uses a contenteditable div (role="textbox") as its editor.
 * We drive editor content through a controlled hidden-input (data-testid="source-input")
 * that syncs into CM6 state on change. Each test uses scoped queries from render()
 * to avoid global-screen accumulation between tests.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, cleanup, within, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ComponentSpec } from '@polymath/contract';
import { PseudocodeChallenge } from './PseudocodeChallenge.js';

type PseudocodeSpec = Extract<ComponentSpec, { kind: 'PseudocodeChallenge' }>;

const SPEC_AND: PseudocodeSpec = {
  kind: 'PseudocodeChallenge',
  targetExpression: 'A AND B',
  claimedTruthTable: [0, 0, 0, 1],
  visibleReps: ['pseudocode'],
};

const SPEC_OR: PseudocodeSpec = {
  kind: 'PseudocodeChallenge',
  targetExpression: 'A OR B',
  claimedTruthTable: [0, 1, 1, 1],
  visibleReps: ['pseudocode'],
};

afterEach(() => cleanup());

/** Drive the hidden sync input to set the current expression. */
function setSource(container: HTMLElement, value: string): void {
  const input = container.querySelector('[data-testid="source-input"]') as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
}

function submit(container: HTMLElement): void {
  const btn = within(container).getByRole('button', { name: /submit/i });
  fireEvent.click(btn);
}

describe('PseudocodeChallenge', () => {
  describe('mount and structure', () => {
    it('renders a Submit button', () => {
      const { container } = render(<PseudocodeChallenge spec={SPEC_AND} />);
      expect(within(container).getByRole('button', { name: /submit/i })).toBeTruthy();
    });

    it('renders the CodeMirror editor container', () => {
      const { container } = render(<PseudocodeChallenge spec={SPEC_AND} />);
      expect(container.querySelector('.cm-editor')).toBeTruthy();
    });

    it('AC1: editor placeholder text is present on mount', () => {
      const { container } = render(<PseudocodeChallenge spec={SPEC_AND} />);
      // CM6 placeholder() renders a .cm-placeholder element with the placeholder text
      const placeholderEl = container.querySelector('.cm-placeholder');
      expect(placeholderEl).toBeTruthy();
      expect(placeholderEl?.textContent).toContain('write your expression here');
    });

    it('has a section with aria-labelledby', () => {
      const { container } = render(<PseudocodeChallenge spec={SPEC_AND} />);
      const section = container.querySelector('section[aria-labelledby]');
      expect(section).toBeTruthy();
    });

    it('shows the target expression in the heading', () => {
      const { container } = render(<PseudocodeChallenge spec={SPEC_AND} />);
      expect(container.textContent).toContain('A AND B');
    });

    it('the hidden source-input element is present', () => {
      const { container } = render(<PseudocodeChallenge spec={SPEC_AND} />);
      expect(container.querySelector('[data-testid="source-input"]')).toBeTruthy();
    });
  });

  describe('submit with correct expression', () => {
    it('calls onSubmit with correct: true for an equivalent expression', async () => {
      const onSubmit = vi.fn();
      const { container } = render(
        <PseudocodeChallenge spec={SPEC_AND} onSubmit={onSubmit} />,
      );
      setSource(container, 'a and b');
      submit(container);
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({ correct: true }),
        );
      });
    });

    it('calls onSubmit with repSubmission.rep === "pseudocode"', async () => {
      const onSubmit = vi.fn();
      const { container } = render(
        <PseudocodeChallenge spec={SPEC_AND} onSubmit={onSubmit} />,
      );
      setSource(container, 'a and b');
      submit(container);
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            repSubmission: expect.objectContaining({ rep: 'pseudocode' }),
          }),
        );
      });
    });

    it('repSubmission includes source and expression', async () => {
      const onSubmit = vi.fn();
      const { container } = render(
        <PseudocodeChallenge spec={SPEC_AND} onSubmit={onSubmit} />,
      );
      setSource(container, 'a and b');
      submit(container);
      await waitFor(() => {
        const payload = onSubmit.mock.calls[0]?.[0] as { repSubmission: { source: string; expression: string } };
        expect(payload?.repSubmission?.source).toBe('a and b');
        expect(typeof payload?.repSubmission?.expression).toBe('string');
      });
    });

    it('submission is a non-empty canonical expression string', async () => {
      const onSubmit = vi.fn();
      const { container } = render(
        <PseudocodeChallenge spec={SPEC_AND} onSubmit={onSubmit} />,
      );
      setSource(container, '(a) and (b)');
      submit(container);
      await waitFor(() => {
        const payload = onSubmit.mock.calls[0]?.[0] as { submission: string };
        expect(typeof payload?.submission).toBe('string');
        expect(payload?.submission.length).toBeGreaterThan(0);
      });
    });
  });

  describe('submit with incorrect expression', () => {
    it('calls onSubmit with correct: false for non-equivalent expression', async () => {
      const onSubmit = vi.fn();
      const { container } = render(
        <PseudocodeChallenge spec={SPEC_AND} onSubmit={onSubmit} />,
      );
      setSource(container, 'a or b');
      submit(container);
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({ correct: false }),
        );
      });
    });
  });

  describe('submit with syntax error', () => {
    it('shows an error message and does NOT call onSubmit when expression is invalid', async () => {
      const onSubmit = vi.fn();
      const { container } = render(
        <PseudocodeChallenge spec={SPEC_AND} onSubmit={onSubmit} />,
      );
      setSource(container, 'a and');
      submit(container);
      await waitFor(() => {
        expect(container.querySelector('[role="alert"]')).toBeTruthy();
      });
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('alert text describes the parse error', async () => {
      const { container } = render(<PseudocodeChallenge spec={SPEC_AND} />);
      setSource(container, 'a &&&');
      submit(container);
      await waitFor(() => {
        const alert = container.querySelector('[role="alert"]');
        expect(alert?.textContent).toMatch(/parse|error|invalid|illegal|character/i);
      });
    });

    it('AC5: alert text includes the error position for illegal characters', async () => {
      const { container } = render(<PseudocodeChallenge spec={SPEC_AND} />);
      // 'a &' — illegal char at position 2
      setSource(container, 'a &');
      submit(container);
      await waitFor(() => {
        const alert = container.querySelector('[role="alert"]');
        // The tokenizer emits "Illegal character … at position N" — position should appear
        expect(alert?.textContent).toMatch(/position\s+\d+/i);
      });
    });
  });

  describe('submit with empty expression', () => {
    it('shows an error message for empty submit', async () => {
      const { container } = render(<PseudocodeChallenge spec={SPEC_AND} />);
      // Don't set any source — submit empty
      submit(container);
      await waitFor(() => {
        expect(container.querySelector('[role="alert"]')).toBeTruthy();
      });
    });
  });

  describe('verdict display', () => {
    it('shows "correct" feedback text after correct submission', async () => {
      const { container } = render(<PseudocodeChallenge spec={SPEC_OR} />);
      setSource(container, 'a or b');
      submit(container);
      await waitFor(() => {
        expect(container.textContent?.toLowerCase()).toContain('correct');
      });
    });

    it('shows "incorrect" feedback text after incorrect submission', async () => {
      const { container } = render(<PseudocodeChallenge spec={SPEC_OR} />);
      setSource(container, 'a and b');
      submit(container);
      await waitFor(() => {
        expect(container.textContent?.toLowerCase()).toMatch(/incorrect|not equivalent|wrong/);
      });
    });
  });

  describe('accessibility', () => {
    it('the Submit button is not removed from tab order (tabindex !== -1)', () => {
      const { container } = render(<PseudocodeChallenge spec={SPEC_AND} />);
      const button = within(container).getByRole('button', { name: /submit/i });
      expect(button.getAttribute('tabindex')).not.toBe('-1');
    });

    it('aria-labelledby on the section points to an existing element', () => {
      const { container } = render(<PseudocodeChallenge spec={SPEC_AND} />);
      const section = container.querySelector('section[aria-labelledby]') as HTMLElement;
      expect(section).toBeTruthy();
      const labelId = section.getAttribute('aria-labelledby')!;
      expect(container.querySelector(`#${labelId}`)).toBeTruthy();
    });

    it('CM6 editor content div has aria-labelledby', () => {
      const { container } = render(<PseudocodeChallenge spec={SPEC_AND} />);
      const cmContent = container.querySelector('.cm-content');
      expect(cmContent?.getAttribute('aria-labelledby')).toBeTruthy();
    });
  });
});
