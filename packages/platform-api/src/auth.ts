import { ForbiddenError } from './errors.js';

/**
 * Identity of the caller hitting an API handler.
 *
 * `apiKey` callers are server-to-server (CLI, agent runtime, partner
 * integrations) and bypass namespace restrictions — they're trusted to scope
 * themselves. `user` callers come from a Firebase ID token; the route layer
 * resolves the user's namespace membership before the handler runs.
 *
 * Framework-free on purpose: handlers receive this shape as plain data, so
 * unit tests can fabricate a caller without spinning up Firebase. The Next.js
 * adapter (`platform-ui/src/lib/api-auth.ts`) is responsible for producing it
 * from a `Request`.
 */
export type CallerIdentity =
  | { readonly kind: 'apiKey'; readonly isSystemActor: true }
  | {
      readonly kind: 'user';
      readonly uid: string;
      readonly namespaces: ReadonlySet<string>;
      readonly isSystemActor: false;
    };

/**
 * Throw `ForbiddenError` unless the caller is allowed to touch resources in
 * `namespace`. System-actor callers are unrestricted; user callers must have
 * the namespace in their membership set. Missing namespaces are treated as
 * forbidden — every domain entity that's gated must carry its namespace.
 *
 * Handlers call this AFTER fetching the resource (so 404 still beats 403 for
 * non-existent ids — surfacing "exists but denied" leaks information).
 */
export function assertNamespaceAccess(
  caller: CallerIdentity,
  namespace: string | undefined,
): void {
  if (caller.isSystemActor) return;
  if (typeof namespace !== 'string' || namespace.length === 0) {
    throw new ForbiddenError('Resource has no namespace');
  }
  if (!caller.namespaces.has(namespace)) {
    throw new ForbiddenError();
  }
}

export function callerCanAccess(caller: CallerIdentity, namespace: string | undefined): boolean {
  if (caller.isSystemActor) return true;
  if (typeof namespace !== 'string' || namespace.length === 0) return false;
  return caller.namespaces.has(namespace);
}

/**
 * Filter a list of entities to those the caller may see. Each entity supplies
 * its namespace via `namespaceOf` — keeps this helper agnostic of entity
 * shape (some store namespace at top level, some via a parent instance).
 */
export function filterByCaller<T>(
  items: readonly T[],
  caller: CallerIdentity,
  namespaceOf: (item: T) => string | undefined,
): T[] {
  if (caller.isSystemActor) return [...items];
  return items.filter((item) => callerCanAccess(caller, namespaceOf(item)));
}
