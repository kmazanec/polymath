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
  | { kind: 'or'; left: Ast; right: Ast };

type Token =
  | { type: 'var'; name: string }
  | { type: 'not' }
  | { type: 'and' }
  | { type: 'or' }
  | { type: 'lparen' }
  | { type: 'rparen' };

const KEYWORDS: Record<string, Token['type']> = {
  NOT: 'not',
  AND: 'and',
  OR: 'or',
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
    while (this.peek()?.type === 'or') {
      this.pos++;
      const right = this.parseAnd();
      left = { kind: 'or', left, right };
    }
    return left;
  }

  private parseAnd(): Ast {
    let left = this.parseNot();
    while (this.peek()?.type === 'and') {
      this.pos++;
      const right = this.parseNot();
      left = { kind: 'and', left, right };
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
  const out = tableOver(ast, vars);
  const rows: boolean[][] = out.map((_, mask) =>
    vars.map((_v, bit) => (mask & (1 << (vars.length - 1 - bit))) !== 0),
  );
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
