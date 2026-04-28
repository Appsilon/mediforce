import type { ActionConfig } from '@mediforce/platform-core';
import type {
  ActionContext,
  ActionHandler,
  ActionOutput,
  AnyActionHandler,
} from './types.js';

export class UnknownActionKindError extends Error {
  constructor(public readonly kind: string) {
    super(`No action handler registered for kind '${kind}'`);
    this.name = 'UnknownActionKindError';
  }
}

/**
 * Registry of action handlers keyed by `kind`. Built-in handlers (http) are
 * registered at runtime construction; user pluginized actions can call
 * `register()` to add new kinds without touching the discriminated union in
 * platform-core (additive: union grows when their kind ships in core).
 *
 * Thread model: registration is synchronous and lock-free; `dispatch()` is
 * read-only. The registry is intended to be created once at process start.
 */
export class ActionRegistry {
  private readonly handlers = new Map<string, AnyActionHandler>();

  register<T>(kind: string, handler: ActionHandler<T>): void {
    this.handlers.set(kind, handler as AnyActionHandler);
  }

  has(kind: string): boolean {
    return this.handlers.has(kind);
  }

  /** Dispatch a config from a WorkflowStep.action to the registered handler.
   *  The config is the discriminated-union element (not just the inner
   *  `config` payload) so the handler can read its own `kind` if needed. */
  async dispatch(action: ActionConfig, ctx: ActionContext): Promise<ActionOutput> {
    const handler = this.handlers.get(action.kind);
    if (handler === undefined) {
      throw new UnknownActionKindError(action.kind);
    }
    return handler(action.config, ctx);
  }
}
