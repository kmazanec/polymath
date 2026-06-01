export function formatLogicExpression(expression: string): string {
  return expression
    .replace(/\bNOT\s+(?=\()/g, '!')
    .replace(/\bNOT\s+([A-Z])\b/g, '!$1')
    .replace(/\bAND\b/g, '&')
    .replace(/\bOR\b/g, '||');
}
