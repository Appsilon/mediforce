import { ForbiddenError } from './errors';

/**
 * Identity of the caller hitting an API handler.
 *
 * `apiKey` callers are server-to-server (CLI, agent runtime, partner
 * integrations) and bypass namespace restrictions — they're trusted to scope
 * themselves. `user` callers come from a NextAuth session cookie; the route
 * layer resolves the user's namespace membership before the handler runs.
 *
 * Framework-free on purpose: handlers receive this shape as plain data, so
 * unit tests can fabricate a caller without a session or a database. The Next.js
 * adapter (`platform-ui/src/lib/api-auth.ts`) is responsible for producing it
 * from a `Request`.
 */
export type NamespaceRole = 'owner' | 'admin' | 'member';

export type CallerIdentity =
  | { readonly kind: 'apiKey'; readonly isSystemActor: true }
  | {
      readonly kind: 'user';
      readonly uid: string;
      readonly namespaces: ReadonlySet<string>;
      readonly namespaceRoles: ReadonlyMap<string, NamespaceRole>;
      /**
       * The caller's process-domain Roles per namespace (ADR-0019) —
       * `reviewer`, `PI`, `approver`: what they do in a process, as opposed to
       * `namespaceRoles` above, which is Membership. Both are per-workspace
       * and mean different things; `CONTEXT.md` draws the same distinction.
       *
       * Resolved once per request alongside `namespaceRoles` so the role gate
       * (#1249) costs no second round-trip. Workspace-wide grants only: a
       * grant narrowed to one workflow is not carried here, because the gate
       * needs the workflow in hand to honour it and only has that inside the
       * handler.
       *
       * A namespace absent from the map means "holds no roles there", not
       * "unknown" — every namespace the caller is a member of is populated.
       * apiKey callers have no entry at all: they are `isSystemActor` and
       * bypass.
       */
      readonly namespaceProcessRoles: ReadonlyMap<string, ReadonlySet<string>>;
      /**
       * The database-session token this request authenticated with, when the
       * boundary resolved one from the session cookie. Handlers must not use
       * it as an identity (the uid is that); its single purpose is letting a
       * session-revoking handler spare the caller's own session — see
       * `setPassword`. Optional so non-cookie caller shapes (tests, future
       * per-user PATs) stay constructible.
       */
      readonly sessionToken?: string;
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

/**
 * @deprecated ADR-0004 — handlers should reach data via `CallerScope` wrappers,
 *   which enforce this gate at the call site. Remaining inline callers under
 *   `platform-ui/src/app/api/**` are pre-Phase-2 routes that haven't migrated
 *   yet; new code must not use this helper.
 */
export function callerCanAccess(caller: CallerIdentity, namespace: string | undefined): boolean {
  if (caller.isSystemActor) return true;
  if (typeof namespace !== 'string' || namespace.length === 0) return false;
  return caller.namespaces.has(namespace);
}

/**
 * Filter a list of entities to those the caller may see. Each entity supplies
 * its namespace via `namespaceOf` — keeps this helper agnostic of entity
 * shape (some store namespace at top level, some via a parent instance).
 *
 * @deprecated ADR-0004 — list/query methods on `Authorized<Entity>Repository`
 *   filter at the storage layer (`*VisibleTo` / `*InNamespaces`). New code
 *   must reach data through `CallerScope`, not via this post-filter.
 */
export function filterByCaller<T>(
  items: readonly T[],
  caller: CallerIdentity,
  namespaceOf: (item: T) => string | undefined,
): T[] {
  if (caller.isSystemActor) return [...items];
  return items.filter((item) => callerCanAccess(caller, namespaceOf(item)));
}

/**
 * Throw `ForbiddenError` unless the caller has owner/admin role in `namespace`.
 *
 * apiKey callers (trusted infra: CLI / engine / worker / agents) bypass —
 * platform-admin in the operator's mental model. Per-user PATs (#376) reroute
 * through the user variant later.
 *
 * Per ADR-0004 §4 the wrapper layer (`AuthorizedScope`) does NOT consult roles;
 * this handler-resident helper is the only consumer.
 */
export function callerIsNamespaceAdmin(
  caller: CallerIdentity,
  namespace: string,
): boolean {
  if (caller.isSystemActor) return true;
  const role = caller.namespaceRoles.get(namespace);
  return role === 'owner' || role === 'admin';
}

export function assertCallerIsNamespaceAdmin(
  caller: CallerIdentity,
  namespace: string,
): void {
  if (!callerIsNamespaceAdmin(caller, namespace)) {
    throw new ForbiddenError();
  }
}

/**
 * Loose cross-namespace gate for the platform-wide DELETE /api/admin/docker-images
 * proxy — the user must be owner/admin in at least one namespace.
 *
 * Replaced by a first-class platform-admin field once #376 (per-user PATs)
 * lands; until then the "any namespace admin can prune image registry" proxy
 * is the closest existing approximation.
 */
export function assertCallerCanAdminDockerImages(caller: CallerIdentity): void {
  if (caller.isSystemActor) return;
  for (const role of caller.namespaceRoles.values()) {
    if (role === 'owner' || role === 'admin') return;
  }
  throw new ForbiddenError();
}

/**
 * Throw `ForbiddenError` unless the caller is the owner of `namespace`.
 *
 * apiKey callers bypass (platform-admin trust). Used by handlers that perform
 * owner-exclusive mutations: workspace deletion, role flips that promote /
 * demote admins, and the owner-cannot-leave precondition check.
 */
export function assertCallerIsNamespaceOwner(
  caller: CallerIdentity,
  namespace: string,
): void {
  if (caller.isSystemActor) return;
  const role = caller.namespaceRoles.get(namespace);
  if (role !== 'owner') {
    throw new ForbiddenError();
  }
}
