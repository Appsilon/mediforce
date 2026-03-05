import type { GateFunction, GateInput } from './gate-types.js';

export class GateNotFoundError extends Error {
  override name = 'GateNotFoundError';

  constructor(gateName: string) {
    super(
      `Gate function "${gateName}" is not registered. This is a process definition error.`,
    );
  }
}

export class GateExecutionError extends Error {
  override name = 'GateExecutionError';
  readonly gateName: string;
  override readonly cause: Error;

  constructor(gateName: string, cause: Error) {
    super(`Gate function "${gateName}" threw an error: ${cause.message}`);
    this.gateName = gateName;
    this.cause = cause;
  }
}

export class GateRegistry {
  private gates = new Map<string, GateFunction>();

  register(name: string, fn: GateFunction): void {
    if (this.gates.has(name)) {
      throw new Error(
        `Gate "${name}" is already registered. Duplicate registration is not allowed.`,
      );
    }
    this.gates.set(name, fn);
  }

  get(name: string): GateFunction {
    const gate = this.gates.get(name);
    if (!gate) {
      throw new GateNotFoundError(name);
    }
    return gate;
  }

  has(name: string): boolean {
    return this.gates.has(name);
  }

  invoke(name: string, input: GateInput): { next: string; reason: string } {
    const gate = this.get(name);
    try {
      return gate(input);
    } catch (err) {
      if (err instanceof GateNotFoundError) {
        throw err;
      }
      throw new GateExecutionError(name, err as Error);
    }
  }

  clear(): void {
    this.gates.clear();
  }

  names(): string[] {
    return Array.from(this.gates.keys());
  }
}
