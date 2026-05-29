import type { ActionConfig } from '@mediforce/platform-core';
import type {
  ActionContext,
  ActionHandler,
  ActionOutput,
  AnyActionHandler,
} from './types';

/**
 * Hints shown when a workflow references an action `kind` whose handler
 * was deliberately not registered at boot. The runtime swallows the registration
 * silently (e.g. when MEDIFORCE_DISABLE_EMAIL=true), so without these hints the
 * user sees only "No action handler registered" and has no clue why.
 */
const KIND_DISABLED_HINTS: Record<string, string> = {
  email:
    'The email handler is not registered. This usually means MEDIFORCE_DISABLE_EMAIL=true ' +
    'is set, OR the Mailgun env vars (MAILGUN_API_KEY, MAILGUN_DOMAIN, MAILGUN_FROM_EMAIL) ' +
    'are missing. Either provide credentials and unset MEDIFORCE_DISABLE_EMAIL, or remove ' +
    "the email step from this workflow's definition.",
};

export class UnknownActionKindError extends Error {
  constructor(public readonly kind: string, registeredKinds: ReadonlyArray<string> = []) {
    const hint = KIND_DISABLED_HINTS[kind];
    const registeredList = registeredKinds.length > 0
      ? ` Registered kinds: ${registeredKinds.join(', ')}.`
      : ' No action handlers are registered.';
    const detail = hint !== undefined ? ` ${hint}` : '';
    super(`No action handler registered for kind '${kind}'.${registeredList}${detail}`);
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
      throw new UnknownActionKindError(action.kind, Array.from(this.handlers.keys()));
    }
    return handler(action.config, ctx);
  }
}
