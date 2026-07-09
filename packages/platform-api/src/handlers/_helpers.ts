import { NotFoundError } from '../errors';
import type { CallerScope } from '../repositories/index';

export async function loadOr404<T>(
  lookup: Promise<T | null>,
  notFoundMessage: string,
): Promise<T> {
  const entity = await lookup;
  if (entity === null) throw new NotFoundError(notFoundMessage);
  return entity;
}

export interface Actor {
  readonly actorId: string;
  readonly actorType: 'user' | 'system';
  readonly actorRole: string;
}

// Derive the audit-event actor fields from the caller. Default role is
// 'operator'; cron-style handlers override.
export function actorFromCaller(scope: CallerScope, role = 'operator'): Actor {
  if (scope.caller.kind === 'user') {
    return { actorId: scope.caller.uid, actorType: 'user', actorRole: role };
  }
  return { actorId: 'api-user', actorType: 'system', actorRole: role };
}

/**
 * Resolve the FK-valid `workspace` handle an audit event should belong to when
 * the action is not scoped to a specific entity namespace (e.g. acknowledging a
 * forced password change, or editing a platform-global agent). The acting
 * user's personal namespace is the natural owner — it always exists (lazily
 * bootstrapped on `GET /api/users/me`) and is FK-valid against `workspaces`.
 *
 * `audit_events.workspace` is NOT NULL with an FK to `workspaces.handle`
 * (ADR-0001), so handlers MUST supply a real handle; omitting it makes the
 * Postgres audit write throw. Returns `null` only when no namespace is
 * resolvable (apiKey caller with no personal namespace) so the caller can
 * decide how to proceed.
 */
export async function resolvePersonalNamespace(
  scope: CallerScope,
  uid: string,
): Promise<string | null> {
  const namespaces = await scope.workspaces.getNamespacesByUser(uid);
  const personal = namespaces.find(
    (n) => n.type === 'personal' && n.linkedUserId === uid,
  );
  return personal?.handle ?? namespaces[0]?.handle ?? null;
}
