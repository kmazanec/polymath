/**
 * @polymath/booleans — the single source of truth for Boolean-logic correctness.
 *
 * Locked public API (the contract; the supported gate alphabet may grow in later
 * lessons, but these signatures do not change):
 *   parse(expr)            -> Ast
 *   evaluate(ast, env)     -> boolean
 *   variables(ast)         -> string[]   (sorted, de-duplicated)
 *   truthTable(expr)       -> { vars, rows, out }
 *   equivalent(a, b)       -> boolean
 *
 * L1 grammar: uppercase variables, NOT/AND/OR (case-insensitive on input,
 * canonicalised to uppercase), parentheses. Precedence: NOT > AND > OR.
 */

export class BooleanParseError extends Error {
  override name = 'BooleanParseError';
}

export type Ast =
  | { kind: 'var'; name: string }
  | { kind: 'not'; operand: Ast }
  | { kind: 'and'; left: Ast; right: Ast }
  | { kind: 'or'; left: Ast; right: Ast }
  // Additive primitives (ADR-012 stretch grammar): NAND sits at AND-precedence,
  // NOR at OR-precedence. Strictly additive — the locked signatures
  // (parse/evaluate/variables/truthTable/equivalent) are unchanged.
  | { kind: 'nand'; left: Ast; right: Ast }
  | { kind: 'nor'; left: Ast; right: Ast };

type Token =
  | { type: 'var'; name: string }
  | { type: 'not' }
  | { type: 'and' }
  | { type: 'or' }
  | { type: 'nand' }
  | { type: 'nor' }
  | { type: 'lparen' }
  | { type: 'rparen' };

const KEYWORDS: Record<string, Token['type']> = {
  NOT: 'not',
  AND: 'and',
  OR: 'or',
  NAND: 'nand',
  NOR: 'nor',
};

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i++;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let word = '';
      while (i < input.length && /[A-Za-z]/.test(input[i]!)) {
        word += input[i]!;
        i++;
      }
      const upper = word.toUpperCase();
      const keyword = KEYWORDS[upper];
      if (keyword) {
        tokens.push({ type: keyword } as Token);
      } else if (upper.length === 1) {
        tokens.push({ type: 'var', name: upper });
      } else {
        throw new BooleanParseError(
          `Unexpected identifier "${word}" — variables are single letters and the only keywords are NOT, AND, OR`,
        );
      }
      continue;
    }
    throw new BooleanParseError(`Illegal character "${ch}" at position ${i}`);
  }
  return tokens;
}

/** Recursive-descent parser. Grammar (lowest to highest precedence):
 *   or   := and ( 'OR' and )*
 *   and  := not ( 'AND' not )*
 *   not  := 'NOT' not | atom
 *   atom := var | '(' or ')'
 */
class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Ast {
    if (this.tokens.length === 0) {
      throw new BooleanParseError('Empty expression');
    }
    const ast = this.parseOr();
    if (this.pos < this.tokens.length) {
      throw new BooleanParseError('Unexpected trailing tokens');
    }
    return ast;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private parseOr(): Ast {
    let left = this.parseAnd();
    let tok = this.peek()?.type;
    // NOR shares OR-precedence (ADR-012 additive grammar).
    while (tok === 'or' || tok === 'nor') {
      this.pos++;
      const right = this.parseAnd();
      left = tok === 'nor' ? { kind: 'nor', left, right } : { kind: 'or', left, right };
      tok = this.peek()?.type;
    }
    return left;
  }

  private parseAnd(): Ast {
    let left = this.parseNot();
    let tok = this.peek()?.type;
    // NAND shares AND-precedence (ADR-012 additive grammar).
    while (tok === 'and' || tok === 'nand') {
      this.pos++;
      const right = this.parseNot();
      left = tok === 'nand' ? { kind: 'nand', left, right } : { kind: 'and', left, right };
      tok = this.peek()?.type;
    }
    return left;
  }

  private parseNot(): Ast {
    if (this.peek()?.type === 'not') {
      this.pos++;
      return { kind: 'not', operand: this.parseNot() };
    }
    return this.parseAtom();
  }

  private parseAtom(): Ast {
    const tok = this.peek();
    if (!tok) {
      throw new BooleanParseError('Unexpected end of expression — operand expected');
    }
    if (tok.type === 'var') {
      this.pos++;
      return { kind: 'var', name: tok.name };
    }
    if (tok.type === 'lparen') {
      this.pos++;
      const inner = this.parseOr();
      const close = this.peek();
      if (close?.type !== 'rparen') {
        throw new BooleanParseError('Unbalanced parentheses — expected ")"');
      }
      this.pos++;
      return inner;
    }
    throw new BooleanParseError(`Unexpected token "${tok.type}" — operand expected`);
  }
}

export function parse(expr: string): Ast {
  return new Parser(tokenize(expr)).parse();
}

export function evaluate(ast: Ast, env: Record<string, boolean>): boolean {
  switch (ast.kind) {
    case 'var': {
      const value = env[ast.name];
      if (value === undefined) {
        throw new BooleanParseError(`Variable "${ast.name}" is not in the environment`);
      }
      return value;
    }
    case 'not':
      return !evaluate(ast.operand, env);
    case 'and':
      return evaluate(ast.left, env) && evaluate(ast.right, env);
    case 'or':
      return evaluate(ast.left, env) || evaluate(ast.right, env);
    case 'nand':
      return !(evaluate(ast.left, env) && evaluate(ast.right, env));
    case 'nor':
      return !(evaluate(ast.left, env) || evaluate(ast.right, env));
  }
}

export function variables(ast: Ast): string[] {
  const found = new Set<string>();
  const walk = (node: Ast): void => {
    switch (node.kind) {
      case 'var':
        found.add(node.name);
        return;
      case 'not':
        walk(node.operand);
        return;
      case 'and':
      case 'or':
      case 'nand':
      case 'nor':
        walk(node.left);
        walk(node.right);
        return;
    }
  };
  walk(ast);
  return [...found].sort();
}

export interface TruthTable {
  vars: string[];
  rows: boolean[][];
  out: boolean[];
}

/** Enumerate all 2^n assignments over `vars` (first variable is the most
 *  significant bit), evaluating `ast` at each. */
function tableOver(ast: Ast, vars: string[]): boolean[] {
  const n = vars.length;
  const out: boolean[] = [];
  for (let mask = 0; mask < 1 << n; mask++) {
    const env: Record<string, boolean> = {};
    for (let bit = 0; bit < n; bit++) {
      // first variable is the MSB
      env[vars[bit]!] = (mask & (1 << (n - 1 - bit))) !== 0;
    }
    out.push(evaluate(ast, env));
  }
  return out;
}

export function truthTable(expr: string): TruthTable {
  const ast = parse(expr);
  const vars = variables(ast);
  const n = vars.length;
  const rows: boolean[][] = [];
  const out: boolean[] = [];
  // Single pass: build each input row and evaluate it together, rather than
  // enumerating once for `out` and re-deriving `rows` from the mask afterwards.
  for (let mask = 0; mask < 1 << n; mask++) {
    const env: Record<string, boolean> = {};
    const row: boolean[] = [];
    for (let bit = 0; bit < n; bit++) {
      // first variable is the MSB
      const value = (mask & (1 << (n - 1 - bit))) !== 0;
      env[vars[bit]!] = value;
      row.push(value);
    }
    rows.push(row);
    out.push(evaluate(ast, env));
  }
  return { vars, rows, out };
}

/** Two expressions are equivalent iff they produce the same output over every
 *  assignment of the *union* of their variables. Variables that appear in only
 *  one side are still enumerated on both, so tautological no-ops compare equal. */
export function equivalent(a: string, b: string): boolean {
  const astA = parse(a);
  const astB = parse(b);
  const vars = [...new Set([...variables(astA), ...variables(astB)])].sort();
  const outA = tableOver(astA, vars);
  const outB = tableOver(astB, vars);
  return outA.every((v, i) => v === outB[i]);
}

// ---------------------------------------------------------------------------
// F-04 additions — strictly additive; existing API is unchanged.
// ---------------------------------------------------------------------------

/**
 * Convert an Ast back to a canonical Boolean expression string that `parse()`
 * accepts. Used internally by `parsePseudocode` round-trip tests and exported
 * so the web component can populate `submission` / `repSubmission.expression`.
 *
 * Parenthesises sub-expressions conservatively so the output is always
 * unambiguous when re-parsed.
 */
export function astToExpression(ast: Ast): string {
  switch (ast.kind) {
    case 'var':
      return ast.name;
    case 'not':
      return `NOT (${astToExpression(ast.operand)})`;
    case 'and':
    case 'nand': {
      // AND-level (and/nand share precedence, left-associative). The LEFT child
      // needs parens only if it is OR-level (lower precedence). The RIGHT child
      // needs parens if it is ANY binary op at this level or below (and/nand/or/nor):
      // because the operators are LEFT-associative, an unparenthesised same-level
      // right child would re-parse as `(a OP b) OP c` — and NAND is NON-associative,
      // so `A NAND (B NAND C)` ≠ `(A NAND B) NAND C`. (MR !9 review: round-trip bug.)
      const op = ast.kind === 'and' ? 'AND' : 'NAND';
      const l = parenIfOrLevel(ast.left);
      const r = parenIfBinary(ast.right);
      return `${l} ${op} ${r}`;
    }
    case 'or':
    case 'nor': {
      // OR-level (or/nor share precedence, left-associative, the lowest level).
      // The LEFT child never needs parens. The RIGHT child needs parens if it is
      // itself OR-level (or/nor) — same left-associativity / non-associativity
      // argument: `A NOR (B NOR C)` ≠ `(A NOR B) NOR C`. (MR !9 review.)
      const op = ast.kind === 'or' ? 'OR' : 'NOR';
      const r = parenIfOrLevel(ast.right);
      return `${astToExpression(ast.left)} ${op} ${r}`;
    }
  }
}

/** Parenthesise a child when it is an OR-precedence node (`or`/`nor`), so an
 *  AND-precedence parent re-parses to the same tree. */
function parenIfOrLevel(node: Ast): string {
  return node.kind === 'or' || node.kind === 'nor'
    ? `(${astToExpression(node)})`
    : astToExpression(node);
}

/** Parenthesise a child when it is ANY binary node (`and`/`nand`/`or`/`nor`).
 *  Used for the RIGHT operand of a left-associative AND-level parent, where an
 *  unparenthesised same-or-lower-precedence right child would re-associate. */
function parenIfBinary(node: Ast): string {
  return node.kind === 'and' || node.kind === 'nand' || node.kind === 'or' || node.kind === 'nor'
    ? `(${astToExpression(node)})`
    : astToExpression(node);
}

/**
 * Pseudocode grammar (superset of `parse`'s canonical grammar):
 *
 *   program  := if_expr
 *   if_expr  := 'if' or_expr 'then' or_expr | or_expr
 *   or_expr  := and_expr ( 'or' and_expr )*
 *   and_expr := not_expr ( 'and' not_expr )*
 *   not_expr := 'not' not_expr | atom
 *   atom     := VAR | '(' if_expr ')'
 *
 * Keywords (`if`, `then`, `and`, `or`, `not`) are case-insensitive. Variables
 * are single letters (uppercased). `true` / `false` literals are NOT supported;
 * use variable expressions. Distinct-variable count is capped at 10 (guards
 * 2^n truth-table growth).
 *
 * Input is capped at 2000 characters and parse recursion depth at 200 to
 * prevent stack overflow / DoS from pathological inputs.
 *
 * @throws {BooleanParseError} on any syntax error, variable-count violation,
 *   input-length violation, or recursion-depth overflow.
 */
export function parsePseudocode(src: string): Ast {
  // Source-length guard: prevent DoS from gigantic inputs
  if (src.length > 2000) {
    throw new BooleanParseError(
      `Expression is too long (${src.length.toString()} characters); maximum is 2000.`,
    );
  }
  const tokens = tokenizePseudo(src);
  const parser = new PseudoParser(tokens);
  const ast = parser.parse();
  // Cap distinct variables
  const vars = variables(ast);
  if (vars.length > 10) {
    throw new BooleanParseError(
      `Expression uses ${vars.length.toString()} distinct variables; maximum is 10 (guards 2^n truth-table size).`,
    );
  }
  return ast;
}

// --- pseudocode tokenizer ---

type PseudoToken =
  | { type: 'var'; name: string; pos: number }
  | { type: 'not'; pos: number }
  | { type: 'and'; pos: number }
  | { type: 'or'; pos: number }
  | { type: 'nand'; pos: number }
  | { type: 'nor'; pos: number }
  | { type: 'if'; pos: number }
  | { type: 'then'; pos: number }
  | { type: 'lparen'; pos: number }
  | { type: 'rparen'; pos: number };

const PSEUDO_KEYWORDS: Record<string, PseudoToken['type']> = {
  NOT: 'not',
  AND: 'and',
  OR: 'or',
  NAND: 'nand',
  NOR: 'nor',
  IF: 'if',
  THEN: 'then',
};

function tokenizePseudo(input: string): PseudoToken[] {
  const tokens: PseudoToken[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen', pos: i });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', pos: i });
      i++;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      const wordStart = i;
      let word = '';
      while (i < input.length && /[A-Za-z]/.test(input[i]!)) {
        word += input[i]!;
        i++;
      }
      const upper = word.toUpperCase();
      const keyword = PSEUDO_KEYWORDS[upper];
      if (keyword) {
        tokens.push({ type: keyword, pos: wordStart } as PseudoToken);
      } else if (upper === 'TRUE' || upper === 'FALSE') {
        throw new BooleanParseError(
          `Boolean literals "true"/"false" are not supported at position ${wordStart.toString()} — use variable expressions.`,
        );
      } else if (upper.length === 1) {
        tokens.push({ type: 'var', name: upper, pos: wordStart });
      } else {
        throw new BooleanParseError(
          `Unexpected identifier "${word}" at position ${wordStart.toString()} — variables are single letters; keywords are: not, and, or, if, then`,
        );
      }
      continue;
    }
    throw new BooleanParseError(`Illegal character "${ch}" at position ${i.toString()}`);
  }
  return tokens;
}

// --- pseudocode recursive-descent parser ---

/** Maximum parse recursion depth — generous for real L1 pseudocode but well
 *  below the JS call-stack limit (~10 000+). Guards against crafted deep-nest
 *  inputs like `((((…X…))))` or `not not not … X`. */
const MAX_PARSE_DEPTH = 200;

class PseudoParser {
  private pos = 0;
  private depth = 0;
  constructor(private readonly tokens: PseudoToken[]) {}

  parse(): Ast {
    if (this.tokens.length === 0) {
      throw new BooleanParseError('Empty expression');
    }
    const ast = this.parseIfExpr();
    if (this.pos < this.tokens.length) {
      throw new BooleanParseError('Unexpected trailing tokens');
    }
    return ast;
  }

  private peek(): PseudoToken | undefined {
    return this.tokens[this.pos];
  }

  /** Increment depth and throw BooleanParseError if the limit is exceeded. */
  private enterDepth(): void {
    this.depth++;
    if (this.depth > MAX_PARSE_DEPTH) {
      throw new BooleanParseError(
        `Expression is too deeply nested (depth > ${MAX_PARSE_DEPTH.toString()}); simplify by removing unnecessary parentheses or NOT chains.`,
      );
    }
  }

  private leaveDepth(): void {
    this.depth--;
  }

  private parseIfExpr(): Ast {
    this.enterDepth();
    try {
      if (this.peek()?.type === 'if') {
        this.pos++; // consume 'if'
        const condition = this.parseOr();
        const thenTok = this.peek();
        if (thenTok?.type !== 'then') {
          throw new BooleanParseError(
            'Expected "then" after condition in "if … then …" expression',
          );
        }
        this.pos++; // consume 'then'
        const consequent = this.parseOr();
        // if P then Q === (NOT P) OR Q
        return {
          kind: 'or',
          left: { kind: 'not', operand: condition },
          right: consequent,
        };
      }
      return this.parseOr();
    } finally {
      this.leaveDepth();
    }
  }

  private parseOr(): Ast {
    this.enterDepth();
    try {
      let left = this.parseAnd();
      let tok = this.peek()?.type;
      // NOR shares OR-precedence (ADR-012 additive grammar).
      while (tok === 'or' || tok === 'nor') {
        this.pos++;
        const right = this.parseAnd();
        left = tok === 'nor' ? { kind: 'nor', left, right } : { kind: 'or', left, right };
        tok = this.peek()?.type;
      }
      return left;
    } finally {
      this.leaveDepth();
    }
  }

  private parseAnd(): Ast {
    this.enterDepth();
    try {
      let left = this.parseNot();
      let tok = this.peek()?.type;
      // NAND shares AND-precedence (ADR-012 additive grammar).
      while (tok === 'and' || tok === 'nand') {
        this.pos++;
        const right = this.parseNot();
        left = tok === 'nand' ? { kind: 'nand', left, right } : { kind: 'and', left, right };
        tok = this.peek()?.type;
      }
      return left;
    } finally {
      this.leaveDepth();
    }
  }

  private parseNot(): Ast {
    this.enterDepth();
    try {
      if (this.peek()?.type === 'not') {
        this.pos++;
        return { kind: 'not', operand: this.parseNot() };
      }
      return this.parseAtom();
    } finally {
      this.leaveDepth();
    }
  }

  private parseAtom(): Ast {
    const tok = this.peek();
    if (!tok) {
      throw new BooleanParseError('Unexpected end of expression — operand expected');
    }
    if (tok.type === 'var') {
      this.pos++;
      return { kind: 'var', name: tok.name };
    }
    if (tok.type === 'lparen') {
      this.pos++;
      const inner = this.parseIfExpr();
      const close = this.peek();
      if (close?.type !== 'rparen') {
        throw new BooleanParseError('Unbalanced parentheses — expected ")"');
      }
      this.pos++;
      return inner;
    }
    throw new BooleanParseError(`Unexpected token "${tok.type}" — operand expected`);
  }
}

// ---------------------------------------------------------------------------
// I3/I4 barrier — the shared var-capped, parse-safe equivalence scorer.
// Strictly additive; the locked signatures above are unchanged.
// ---------------------------------------------------------------------------

export { MAX_EQUIVALENCE_VARS, scoreEquivalence } from './scoreEquivalence.js';

// ---------------------------------------------------------------------------
// ADR-012 stretch — the free-build playground equivalence scorer (caps BOTH
// sides). Strictly additive; the locked signatures above are unchanged.
// ---------------------------------------------------------------------------

export {
  playgroundEquivalence,
  type PlaygroundEquivalenceResult,
} from './playgroundEquivalence.js';
