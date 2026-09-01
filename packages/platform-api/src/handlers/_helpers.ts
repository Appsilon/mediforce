import type { WorkflowDefinition } from '@mediforce/platform-core';
import { NotFoundError } from '../errors';
import { PLATFORM_BASE_URL_SETTING_KEY, normalizeBaseUrl } from '../contract/config';
import type { CallerScope } from '../repositories/index';

/**
 * Resolve the deployment's configured public base URL from platform settings,
 * or `undefined` when unset. Notification adapters use this to override their
 * construction-time `APP_BASE_URL`/`NEXT_PUBLIC_APP_URL`/localhost fallback so
 * invite links point at the real host. A trailing slash is stripped so callers
 * can safely append `/login` etc.
 */
export async function resolveConfiguredBaseUrl(
  scope: CallerScope,
): Promise<string | undefined> {
  const value = await scope.system.platformSettings.get(PLATFORM_BASE_URL_SETTING_KEY);
  return normalizeBaseUrl(value);
}

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

/**
 * The Workflow Definition version a run is pinned to, or `null` when it cannot
 * be read — the version was deleted, or the workflow was transferred to another
 * workspace and left the run's `namespace` pointing at the source.
 *
 * `parseInt` rather than `Number`: legacy runs carry versions like `'1.0.0'`,
 * and truncating to the major is how they have always resolved. Callers decide
 * what `null` means — a 404 for a read, a refusal for an authorization gate.
 */
export async function loadPinnedDefinition(
  scope: CallerScope,
  run: {
    readonly namespace?: string;
    readonly definitionName: string;
    readonly definitionVersion: string;
  },
): Promise<WorkflowDefinition | null> {
  const version = Number.parseInt(run.definitionVersion, 10);
  if (!Number.isFinite(version)) return null;
  return scope.workflowDefinitions.get(run.namespace ?? '', run.definitionName, version);
}
