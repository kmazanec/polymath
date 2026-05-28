/**
 * CodeMirror 6 language extension for the Boolean pseudocode DSL (F-04).
 *
 * Uses CM6's StreamLanguage (a simpler alternative to Lezer grammars) with a
 * hand-written token stream — the grammar is small enough that Lezer is overkill
 * (per ADR Q7: "A hand-written tokenizer is fine if Lezer is overkill").
 *
 * Keyword tokens map to highlight tags so the HighlightStyle can colour them
 * distinctly from identifiers.
 */

import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

const KEYWORDS = new Set(['and', 'or', 'not', 'if', 'then', 'true', 'false']);

const booleanPseudoLang = StreamLanguage.define({
  name: 'boolean-pseudocode',
  token(stream) {
    // Skip whitespace
    if (stream.eatSpace()) return null;

    // Parentheses
    if (stream.eat('(') || stream.eat(')')) return 'paren';

    // Words: keywords or single-letter identifiers
    if (stream.match(/[A-Za-z]+/)) {
      const word = stream.current().toLowerCase();
      if (KEYWORDS.has(word)) return 'keyword';
      // Single letter = variable (already consumed by match)
      return 'variableName';
    }

    // Anything else — consume one character, mark as invalid
    stream.next();
    return 'invalid';
  },
});

/** Syntax highlighting: keywords in a distinct colour/weight, vars in default. */
const booleanHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#7c3aed', fontWeight: 'bold' },
  { tag: tags.variableName, color: '#1e3a5f' },
  { tag: tags.paren, color: '#6b7280' },
  { tag: tags.invalid, color: '#ef4444', textDecoration: 'underline' },
]);

/** The complete CM6 extension bundle for the pseudocode editor. */
export const booleanPseudocodeExtension: Extension = [
  booleanPseudoLang,
  syntaxHighlighting(booleanHighlightStyle),
];
