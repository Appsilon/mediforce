import type { UserDirectoryService } from '@mediforce/platform-core';
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

/**
 * The two `UserDirectoryService` reads the process-role gate needs, narrowed to
 * a structural port so this module keeps its no-service, no-framework promise
 * and unit tests can fabricate one from a literal.
 */
export type ProcessRoleDirectory = Pick<
  UserDirectoryService,
  'getRolesForUser' | 'getUsersByRoleInNamespace'
>;

/**
 * What the refusal calls the thing being refused — "This step requires
 * 'reviewer'". Defaults to the step gate, the first and most common caller;
 * the workflow-level verbs (#1253) name themselves instead, because a person
 * denied the Start button is not looking at a step.
 */
const DEFAULT_ROLE_GATE_SUBJECT = 'This step';

/**
 * Throw `ForbiddenError` unless the caller holds one of `allowedRoles` for
 * `workflow` in `namespace` — the process-role gate of ADR-0019, and the one
 * predicate behind every verb the epic gates.
 *
 * - Absent or empty `allowedRoles` means "any workspace member", exactly as
 *   before the gate existed. It is opt-in; unrestricted steps are untouched.
 * - apiKey callers bypass: the engine, worker and CLI automation act as the
 *   system, and a role is something a person holds.
 * - There is deliberately **no owner/admin override**. An admin who needs to
 *   act grants themselves the role first, which leaves an audit trail that a
 *   silent bypass does not.
 *
 * `allowedRoles` must come from the run's pinned Workflow Definition, never
 * from `HumanTask.assignedRole`: the engine copies only `allowedRoles[0]` into
 * that column, so a step allowing `['reviewer', 'approver']` would enforce
 * `reviewer` alone and silently drop the role the author also wrote.
 *
 * `workflow` is not decoration: a grant narrowed to workflow B must fail the
 * gate on workflow A, and only the handler has the workflow in hand.
 * `CallerIdentity` carries workspace-wide grants, so the common allow costs no
 * round trip; a narrowed grant is resolved through `directory` on the path that
 * is otherwise about to be refused. Test scopes pass no directory, and then
 * only the workspace-wide set — already refused — is left to answer with.
 *
 * Per ADR-0004 §4 the wrapper layer does not consult roles; this
 * handler-resident predicate is the only consumer.
 */
export async function assertCallerHoldsRole(
  caller: CallerIdentity,
  namespace: string,
  workflow: string,
  allowedRoles: readonly string[] | undefined,
  directory: ProcessRoleDirectory | null,
  options: { readonly subject?: string } = {},
): Promise<void> {
  const grant = await resolveRoleGrant(caller, namespace, workflow, allowedRoles, directory);
  if (grant.holds) return;

  throw new ForbiddenError(
    await roleDenialMessage(
      namespace,
      workflow,
      grant.required,
      grant.held,
      directory,
      options.subject ?? DEFAULT_ROLE_GATE_SUBJECT,
    ),
    { namespace, workflow, requiredRoles: grant.required, heldRoles: grant.held },
  );
}

/**
 * The same predicate as `assertCallerHoldsRole`, answered rather than
 * enforced — for the callers that are deciding what to *show* instead of
 * whether to refuse (the actionable inbox, issue #1251).
 *
 * Sharing the predicate is the point: an inbox that computed "can act" its own
 * way is how a UI ends up listing tasks the server then refuses, which is
 * exactly the bug #1249 deleted from the run step page.
 */
export async function callerHoldsRole(
  caller: CallerIdentity,
  namespace: string,
  workflow: string,
  allowedRoles: readonly string[] | undefined,
  directory: ProcessRoleDirectory | null,
): Promise<boolean> {
  const grant = await resolveRoleGrant(caller, namespace, workflow, allowedRoles, directory);
  return grant.holds;
}

type RoleGrant =
  | { readonly holds: true }
  | { readonly holds: false; readonly required: string[]; readonly held: string[] };

async function resolveRoleGrant(
  caller: CallerIdentity,
  namespace: string,
  workflow: string,
  allowedRoles: readonly string[] | undefined,
  directory: ProcessRoleDirectory | null,
): Promise<RoleGrant> {
  if (allowedRoles === undefined || allowedRoles.length === 0) return { holds: true };
  if (caller.isSystemActor) return { holds: true };

  // Nothing bounds `allowedRoles` at authoring time, and any member can register
  // a workflow, so the list a refusal walks is attacker-shaped input: deduplicate
  // it once here and every read below counts distinct roles, not repetitions.
  const required = [...new Set(allowedRoles)];

  const workspaceWide = caller.namespaceProcessRoles.get(namespace) ?? new Set<string>();
  if (required.some((role) => workspaceWide.has(role))) return { holds: true };

  // Only a grant narrowed to this workflow can still admit, and `CallerIdentity`
  // has nowhere to carry one — so it costs a read, taken on the path that is
  // otherwise about to refuse. Without a directory there is nothing further to
  // consult and the refusal above stands.
  const narrowed = directory === null
    ? null
    : await directory.getRolesForUser(caller.uid, namespace, workflow);
  if (narrowed !== null && required.some((role) => narrowed.includes(role))) {
    return { holds: true };
  }

  return { holds: false, required, held: narrowed ?? [...workspaceWide] };
}

/**
 * A `ProcessRoleDirectory` that reads each `(uid, namespace, workflow)` at most
 * once, sharing the in-flight promise between concurrent askers.
 *
 * The gate reads the directory once per refusal, which is right for one claim
 * and wrong for an inbox: thirty tasks parked on the same gated workflow would
 * otherwise be thirty identical reads. Request-scoped — build one per call,
 * never cache across requests, or a grant made mid-session would keep being
 * answered from before it existed.
 */
export function memoizeProcessRoleReads(
  directory: ProcessRoleDirectory | null,
): ProcessRoleDirectory | null {
  if (directory === null) return null;
  const inFlight = new Map<string, Promise<string[]>>();
  return {
    getRolesForUser: (uid, namespace, workflowName) => {
      const key = JSON.stringify([uid, namespace, workflowName ?? null]);
      const cached = inFlight.get(key);
      if (cached !== undefined) return cached;
      const pending = directory.getRolesForUser(uid, namespace, workflowName);
      inFlight.set(key, pending);
      return pending;
    },
    getUsersByRoleInNamespace: (role, namespace, workflowName) =>
      directory.getUsersByRoleInNamespace(role, namespace, workflowName),
  };
}

const ZERO_HOLDER_PROBE_LIMIT = 8;

/**
 * Why the caller was refused, in the words the person reading it needs.
 *
 * A step naming a role nobody in the workspace holds is unclaimable by
 * everyone — correct (an approval gate that opens when unconfigured is worse
 * than a stuck run) but useless behind a generic 403, so that case names the
 * cause and the fix instead of the caller's own roles.
 *
 * Establishing that costs one directory read per required role, so a step
 * listing more roles than `ZERO_HOLDER_PROBE_LIMIT` skips the probe and is
 * refused with the caller's own roles instead. A hand-written step never
 * reaches that many; a definition crafted to make one refusal fan out across
 * the connection pool does.
 */
async function roleDenialMessage(
  namespace: string,
  workflow: string,
  allowedRoles: readonly string[],
  held: readonly string[],
  directory: ProcessRoleDirectory | null,
  subject: string,
): Promise<string> {
  const quoted = (roles: readonly string[]): string =>
    roles.map((role) => `'${role}'`).join(', ');
  const required = allowedRoles.length === 1
    ? quoted(allowedRoles)
    : `any of ${quoted(allowedRoles)}`;

  if (directory !== null && allowedRoles.length <= ZERO_HOLDER_PROBE_LIMIT) {
    const holders = await Promise.all(
      allowedRoles.map((role) =>
        directory.getUsersByRoleInNamespace(role, namespace, workflow),
      ),
    );
    if (holders.every((users) => users.length === 0)) {
      const assign = allowedRoles.length === 1 ? 'it' : 'one';
      return `No one in this workspace holds ${required}. An admin can assign ${assign} in workspace Settings → Members.`;
    }
  }

  return held.length === 0
    ? `${subject} requires ${required}; you hold no roles in this workspace.`
    : `${subject} requires ${required}; you hold ${quoted(held)}.`;
}
