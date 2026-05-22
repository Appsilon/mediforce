import type { CallerIdentity } from '../auth.js';
import { ForbiddenError } from '../errors.js';

/**
 * Workspace-scope primitives for `Authorized<Entity>Repository` wrappers in
 * `platform-api`. Every wrapper extends this to gain a `caller` reference plus
 * the two membership primitives every gate boils down to:
 *
 *   - `canSeeNamespace(ns)` — synchronous predicate, returns true for apiKey
 *     callers (system actor) or when the namespace is in the user caller's
 *     membership set. Direct-namespace wrappers gate reads on this; indirect-
 *     namespace wrappers (HumanTask → parent run) compose it after a parent
 *     lookup.
 *   - `assertNamespaceWrite(ns)` — write-path guard; throws `ForbiddenError`
 *     for user callers outside the namespace.
 *
 * The base intentionally exposes only these two primitives + `caller`. Entity-
 * shaped helpers (`<T>`, `namespaceOf`, `gate`, `filter`) used to live here
 * but had a single concrete user (`AuthorizedWorkflowRunRepository`), so they
 * are now inlined at the call site. Rule of three: if a second direct-entity
 * wrapper appears with the same shape we'll re-extract.
 *
 * Visibility (`public` vs `private`) and soft-delete filtering are NOT in the
 * base — they belong to the one or two entities that have them and are
 * expressed in the wrapper. Per ADR-0004 §"What the wrapper does NOT enforce":
 * role enforcement is out of scope here.
 *
 * Subclass once per entity. Construct with the caller; instances are
 * per-request and disposable.
 */
export abstract class AuthorizedScope {
  constructor(protected readonly caller: CallerIdentity) {}

  protected canSeeNamespace(namespace: string | undefined): boolean {
    if (this.caller.isSystemActor) return true;
    return typeof namespace === 'string' && this.caller.namespaces.has(namespace);
  }

  protected assertNamespaceWrite(namespace: string | undefined): void {
    if (this.caller.isSystemActor) return;
    if (typeof namespace !== 'string' || !this.caller.namespaces.has(namespace)) {
      throw new ForbiddenError();
    }
  }
}
