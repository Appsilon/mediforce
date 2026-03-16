export interface ExpressionContext {
  output: Record<string, unknown>;
  variables: Record<string, unknown>;
  verdict?: string;
}

export class ExpressionError extends Error {
  override name = 'ExpressionError';

  constructor(
    message: string,
    public readonly position?: number,
  ) {
    super(message);
  }
}

/**
 * Evaluate a when-expression against a context.
 * Returns the result coerced to boolean.
 *
 * Supported syntax:
 *   - Literals: true, false, null, numbers, "strings"
 *   - Field access: output.field, variables.field, verdict
 *   - Comparisons: ==, !=, >, <, >=, <=
 *   - Logical: &&, ||, !
 *   - Parentheses for grouping
 */
export function evaluateExpression(
  expression: string,
  context: ExpressionContext,
): boolean {
  const trimmed = expression.trim();
  if (trimmed.length === 0) {
    throw new ExpressionError('Empty expression');
  }

  const parser = new ExpressionParser(trimmed, context);
  const result = parser.parse();
  return Boolean(result);
}

// ---------------------------------------------------------------------------
// Recursive-descent parser
// ---------------------------------------------------------------------------

class ExpressionParser {
  private pos = 0;

  constructor(
    private readonly expr: string,
    private readonly context: ExpressionContext,
  ) {}

  /** Parse the full expression; error if there are trailing characters. */
  parse(): unknown {
    const result = this.parseOrExpr();
    this.skipWhitespace();
    if (this.pos < this.expr.length) {
      throw new ExpressionError(
        `Unexpected character '${this.expr[this.pos]}' at position ${this.pos}`,
        this.pos,
      );
    }
    return result;
  }

  // ---- Grammar rules ----

  /** or_expr → and_expr ('||' and_expr)* */
  private parseOrExpr(): unknown {
    let left = this.parseAndExpr();
    while (this.matchOperator('||')) {
      const right = this.parseAndExpr();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }

  /** and_expr → unary_expr ('&&' unary_expr)* */
  private parseAndExpr(): unknown {
    let left = this.parseUnaryExpr();
    while (this.matchOperator('&&')) {
      const right = this.parseUnaryExpr();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }

  /** unary_expr → '!' unary_expr | comparison */
  private parseUnaryExpr(): unknown {
    this.skipWhitespace();
    if (
      this.pos < this.expr.length &&
      this.expr[this.pos] === '!' &&
      this.charAt(this.pos + 1) !== '='
    ) {
      this.pos++;
      const operand = this.parseUnaryExpr();
      return !Boolean(operand);
    }
    return this.parseComparison();
  }

  /** comparison → primary (comp_op primary)? */
  private parseComparison(): unknown {
    const left = this.parsePrimary();

    // Try each comparison operator (longest first to avoid prefix clashes)
    const operators = ['==', '!=', '>=', '<=', '>', '<'] as const;
    for (const op of operators) {
      if (this.matchOperator(op)) {
        const right = this.parsePrimary();
        return this.compare(left, op, right);
      }
    }

    return left;
  }

  /** primary → 'true' | 'false' | 'null' | NUMBER | STRING | field_path | '(' expr ')' */
  private parsePrimary(): unknown {
    this.skipWhitespace();

    if (this.pos >= this.expr.length) {
      throw new ExpressionError('Unexpected end of expression', this.pos);
    }

    const ch = this.expr[this.pos];

    // Parenthesized expression
    if (ch === '(') {
      this.pos++;
      const result = this.parseOrExpr();
      this.skipWhitespace();
      if (this.pos >= this.expr.length || this.expr[this.pos] !== ')') {
        throw new ExpressionError(
          'Expected closing parenthesis',
          this.pos,
        );
      }
      this.pos++;
      return result;
    }

    // String literal
    if (ch === '"') {
      return this.parseString();
    }

    // Negative number: '-' followed by digit
    if (ch === '-' && this.isDigit(this.charAt(this.pos + 1))) {
      return this.parseNumber();
    }

    // Positive number
    if (this.isDigit(ch)) {
      return this.parseNumber();
    }

    // Keyword or field path
    const ident = this.parseIdentifier();

    if (ident === 'true') return true;
    if (ident === 'false') return false;
    if (ident === 'null') return null;

    // Field path: ident(.ident)*
    const path = [ident];
    while (this.pos < this.expr.length && this.expr[this.pos] === '.') {
      this.pos++; // consume '.'
      path.push(this.parseIdentifier());
    }

    return this.resolveFieldPath(path);
  }

  // ---- Value resolution ----

  private resolveFieldPath(path: string[]): unknown {
    const root = path[0];

    if (root === 'verdict') {
      if (path.length > 1) {
        throw new ExpressionError(
          `'verdict' is a scalar value, cannot access sub-field '${path[1]}'`,
        );
      }
      return this.context.verdict ?? null;
    }

    if (root === 'output' || root === 'variables') {
      let current: unknown = this.context[root];
      for (let idx = 1; idx < path.length; idx++) {
        if (current === null || current === undefined) return null;
        if (typeof current !== 'object') return null;
        current = (current as Record<string, unknown>)[path[idx]];
      }
      return current ?? null;
    }

    throw new ExpressionError(
      `Unknown context field '${root}'. Expected 'output', 'variables', or 'verdict'`,
    );
  }

  // ---- Comparison helper ----

  private compare(left: unknown, op: string, right: unknown): boolean {
    switch (op) {
      case '==':
        // Treat null and undefined as equal
        if (left === null || left === undefined) {
          return right === null || right === undefined;
        }
        if (right === null || right === undefined) return false;
        return left === right;

      case '!=':
        if (left === null || left === undefined) {
          return right !== null && right !== undefined;
        }
        if (right === null || right === undefined) return true;
        return left !== right;

      case '>':
        return (left as number) > (right as number);
      case '<':
        return (left as number) < (right as number);
      case '>=':
        return (left as number) >= (right as number);
      case '<=':
        return (left as number) <= (right as number);
      default:
        throw new ExpressionError(`Unknown operator: ${op}`);
    }
  }

  // ---- Tokenization helpers ----

  private parseString(): string {
    this.pos++; // skip opening "
    let str = '';
    while (this.pos < this.expr.length && this.expr[this.pos] !== '"') {
      if (this.expr[this.pos] === '\\') {
        this.pos++;
        if (this.pos >= this.expr.length) {
          throw new ExpressionError('Unterminated string escape', this.pos);
        }
      }
      str += this.expr[this.pos];
      this.pos++;
    }
    if (this.pos >= this.expr.length) {
      throw new ExpressionError('Unterminated string literal', this.pos);
    }
    this.pos++; // skip closing "
    return str;
  }

  private parseNumber(): number {
    const start = this.pos;
    if (this.expr[this.pos] === '-') this.pos++;
    while (this.pos < this.expr.length && this.isDigit(this.expr[this.pos])) {
      this.pos++;
    }
    if (this.pos < this.expr.length && this.expr[this.pos] === '.') {
      this.pos++;
      while (
        this.pos < this.expr.length &&
        this.isDigit(this.expr[this.pos])
      ) {
        this.pos++;
      }
    }
    const numStr = this.expr.slice(start, this.pos);
    const num = Number(numStr);
    if (Number.isNaN(num)) {
      throw new ExpressionError(`Invalid number '${numStr}'`, start);
    }
    return num;
  }

  private parseIdentifier(): string {
    this.skipWhitespace();
    if (this.pos >= this.expr.length || !this.isIdentStart(this.expr[this.pos])) {
      throw new ExpressionError(
        `Expected identifier at position ${this.pos}`,
        this.pos,
      );
    }
    const start = this.pos;
    while (this.pos < this.expr.length && this.isIdentChar(this.expr[this.pos])) {
      this.pos++;
    }
    return this.expr.slice(start, this.pos);
  }

  /** Try to match an operator at the current position (after skipping whitespace). */
  private matchOperator(op: string): boolean {
    this.skipWhitespace();
    if (this.expr.startsWith(op, this.pos)) {
      this.pos += op.length;
      return true;
    }
    return false;
  }

  private skipWhitespace(): void {
    while (this.pos < this.expr.length && /\s/.test(this.expr[this.pos])) {
      this.pos++;
    }
  }

  private charAt(index: number): string | undefined {
    return index < this.expr.length ? this.expr[index] : undefined;
  }

  private isDigit(ch: string | undefined): boolean {
    return ch !== undefined && ch >= '0' && ch <= '9';
  }

  private isIdentStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
  }

  private isIdentChar(ch: string): boolean {
    return this.isIdentStart(ch) || this.isDigit(ch);
  }
}
