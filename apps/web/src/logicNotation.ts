export function formatLogicExpression(expression: string): string {
  return expression
    .replace(/\bNAND\b/g, '↑')
    .replace(/\bNOR\b/g, '↓')
    .replace(/\bAND\b/g, '∧')
    .replace(/\bOR\b/g, '∨')
    .replace(/\bNOT\b/g, '¬');
}
