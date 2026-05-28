import type { Namespace, NamespaceMember } from '@mediforce/platform-core';
import { ForbiddenError, ValidationError } from '../../errors.js';
import type { CallerScope } from '../../repositories/index.js';
import type { GetMeInput, GetMeOutput, MeNamespace } from '../../contract/users.js';

const PERSONAL_HANDLE_FALLBACK = 'user';

/**
 * Return the signed-in user's profile + every workspace they belong to with
 * their role. Powers the sidebar switcher, page-gate role checks, and the
 * workspace header.
 *
 * Lazy bootstrap: when the caller has no personal namespace, the handler
 * creates one inline (idempotent) before returning, emitting
 * `user.personal_namespace_created` exactly once. Bootstrap moves to
 * `events.createUser` when ADR-0002 (NextAuth) lands.
 *
 * apiKey callers are rejected — there's no uid to attribute the response to.
 */
export async function getMe(input: GetMeInput, scope: CallerScope): Promise<GetMeOutput> {
  const uid = resolveUid(input, scope);

  const directory = scope.system.userDirectory;
  const metadata = directory === null ? null : await directory.getUserMetadata(uid).catch(() => null);
  const email = metadata?.email ?? null;
  const displayName = metadata?.displayName ?? null;

  let namespaces = await scope.workspaces.getNamespacesByUser(uid);
  let personal = namespaces.find((n) => n.type === 'personal' && n.linkedUserId === uid);

  if (personal === undefined) {
    personal = await ensurePersonalNamespace({ uid, email, displayName }, scope);
    namespaces = [personal, ...namespaces];
  }

  const memberships = await scope.workspaces.getMembershipsForUser(uid);
  const roleByHandle = new Map(memberships.map((m) => [m.handle, m.role]));

  const responseNamespaces: MeNamespace[] = namespaces.map((n) => ({
    handle: n.handle,
    type: n.type,
    displayName: n.displayName,
    role: roleByHandle.get(n.handle) ?? 'owner',
    ...(n.avatarUrl !== undefined ? { avatarUrl: n.avatarUrl } : {}),
    ...(n.icon !== undefined ? { icon: n.icon } : {}),
  }));

  return {
    user: { uid, email, displayName },
    namespaces: responseNamespaces,
  };
}

async function ensurePersonalNamespace(
  user: { uid: string; email: string | null; displayName: string | null },
  scope: CallerScope,
): Promise<Namespace> {
  const baseHandle = generateHandle(user.email ?? user.uid);
  let handle = baseHandle;
  let attempt = 1;
  // Bounded retry — Firestore handle collisions are rare and resolved by
  // suffixing; an unbounded loop here would hide a deeper outage.
  for (let i = 0; i < 16; i += 1) {
    const existing = await scope.workspaces.getNamespace(handle);
    if (existing === null) break;
    attempt += 1;
    handle = `${baseHandle}-${attempt}`;
  }

  const now = new Date().toISOString();
  const namespace: Namespace = {
    handle,
    type: 'personal',
    displayName: user.displayName ?? user.email ?? handle,
    linkedUserId: user.uid,
    createdAt: now,
  };
  const ownerMember: NamespaceMember = {
    uid: user.uid,
    role: 'owner',
    ...(user.displayName !== null ? { displayName: user.displayName } : {}),
    joinedAt: now,
  };

  await scope.workspaces.createNamespaceWithOwner({ namespace, ownerMember });

  await scope.system.audit.append({
    actorId: user.uid,
    actorType: 'user',
    actorRole: 'operator',
    action: 'user.personal_namespace_created',
    description: `Personal namespace '${handle}' bootstrapped for user '${user.uid}'`,
    timestamp: now,
    inputSnapshot: { uid: user.uid },
    outputSnapshot: { handle, type: 'personal' },
    basis: 'Lazy bootstrap on GET /api/users/me',
    entityType: 'namespace',
    entityId: handle,
  });

  return namespace;
}

function resolveUid(input: GetMeInput, scope: CallerScope): string {
  if (scope.caller.kind === 'user') {
    if (input.uid !== undefined && input.uid !== scope.caller.uid) {
      throw new ForbiddenError('Cannot request another user’s `me` view');
    }
    return scope.caller.uid;
  }
  if (input.uid === undefined) {
    throw new ValidationError(
      'apiKey caller must pass `uid` to GET /api/users/me — there is no implicit identity for system actors',
    );
  }
  return input.uid;
}

function generateHandle(seed: string): string {
  const localPart = seed.split('@')[0] ?? '';
  return (
    localPart
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || PERSONAL_HANDLE_FALLBACK
  );
}
