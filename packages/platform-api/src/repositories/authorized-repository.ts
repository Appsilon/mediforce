import type { CallerIdentity } from '../auth.js';

/**
 * Base class for `Authorized<Entity>Repository` wrappers in `platform-api`.
 *
 * Wrappers enforce caller-set namespace membership on every read and write:
 * a user caller's view is filtered to entities whose namespace appears in
 * `caller.namespaces`; an apiKey caller bypasses the gate (system actor).
 *
 * The base ships three primitives:
 *
 *   - `canSeeNamespace(ns)` — synchronous predicate, returns true for apiKey
 *     or when the namespace is in the caller's membership set. Indirect-
 *     namespace wrappers (HumanTask → parent run → namespace) compose this
 *     after the parent lookup.
 *   - `gate(entity)` — returns the entity if direct-namespace access passes,
 *     else null. Defaults to reading `entity.namespace`; override
 *     `namespaceOf` when the field name differs.
 *   - `filter(entities)` — list variant; apiKey returns the input unchanged,
 *     user filters by `canSee`.
 *
 * Visibility (`public` vs `private`) and soft-delete filtering are NOT in the
 * base — they belong to the one or two entities that have them and are
 * expressed in the wrapper. Per ADR-0004 §"What the wrapper does NOT enforce":
 * role enforcement is out of scope here.
 *
 * Subclass once per entity. Construct with the caller; instances are
 * per-request and disposable.
 */
export abstract class AuthorizedRepository<T> {
  constructor(protected readonly caller: CallerIdentity) {}

  /**
   * Default extractor reads `entity.namespace`. Override when the field name
   * differs or when the namespace is reachable only via an async parent
   * lookup (in which case do the lookup at the call site and use
   * `canSeeNamespace` instead of `gate`).
   */
  protected namespaceOf(entity: T): string | undefined {
    return (entity as { namespace?: unknown }).namespace as string | undefined;
  }

  protected canSeeNamespace(namespace: string | undefined): boolean {
    if (this.caller.kind === 'apiKey') return true;
    return typeof namespace === 'string' && this.caller.namespaces.has(namespace);
  }

  protected canSee(entity: T | null): boolean {
    if (entity === null) return false;
    if (this.caller.kind === 'apiKey') return true;
    return this.canSeeNamespace(this.namespaceOf(entity));
  }

  protected gate(entity: T | null): T | null {
    return entity !== null && this.canSee(entity) ? entity : null;
  }

  protected filter(entities: readonly T[]): T[] {
    if (this.caller.kind === 'apiKey') return [...entities];
    return entities.filter((e) => this.canSee(e));
  }
}
