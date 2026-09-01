import { autoJoinHandlesForEmail } from '@mediforce/platform-core';
import type { Namespace, NamespaceMember } from '@mediforce/platform-core';
import { ForbiddenError, ValidationError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type { GetMeInput, GetMeOutput, MeNamespace } from '../../contract/users';

const PERSONAL_HANDLE_FALLBACK = 'user';

/**
 * Return the signed-in user's profile + every workspace they belong to with
 * their role. Powers the sidebar switcher, page-gate role checks, and the
 * workspace header.
 *
 * Lazy bootstrap: when the caller has no personal namespace, the handler
 * creates one inline (idempotent) before returning, emitting
 * `user.personal_namespace_created` exactly once. This stayed the single
 * bootstrap site through the NextAuth cutover — the `signIn` callback only
 * gates the email domain, so handle generation lives here alone (ADR-0002
 * §4a).
 *
 * Domain auto-join (`AUTO_JOIN_WORKSPACES`) is reconciled here too, for the
 * same reason: this is the one read every signed-in client makes before it can
 * render anything, so a config change takes effect on the next page load
 * rather than the next sign-in.
 *
 * apiKey callers are rejected — there's no uid to attribute the response to.
 */
export async function getMe(input: GetMeInput, scope: CallerScope): Promise<GetMeOutput> {
  const uid = resolveUid(input, scope);

  const directory = scope.system.userDirectory;
  const [metadata, profile, passwordHash] = await Promise.all([
    directory === null ? Promise.resolve(null) : directory.getUserMetadata(uid).catch(() => null),
    scope.userProfiles.getProfile(uid),
    scope.credentials.getPasswordHash(uid),
  ]);
  const email = metadata?.email ?? null;
  const displayName = metadata?.displayName ?? null;
  // A gate nobody can satisfy traps the user on `/change-password` forever, so
  // with password auth off the flag is projected away — not cleared, so
  // re-enabling password auth restores the gate.
  const mustChangePassword =
    scope.system.passwordAuthEnabled === true && profile?.mustChangePassword === true;
  const hasPassword = passwordHash !== null;

  let namespaces = await scope.workspaces.getNamespacesByUser(uid);
  let personal = namespaces.find((n) => n.type === 'personal' && n.linkedUserId === uid);

  if (personal === undefined) {
    personal = await ensurePersonalNamespace({ uid, email, displayName }, scope);
    namespaces = [personal, ...namespaces];
  }

  const joined = await applyAutoJoin({ uid, email, displayName }, namespaces, scope);
  if (joined.length > 0) {
    namespaces = [...namespaces, ...joined];
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
    ...(n.logo !== undefined ? { logo: n.logo } : {}),
    ...(n.brandPrimaryColor !== undefined ? { brandPrimaryColor: n.brandPrimaryColor } : {}),
    ...(n.brandAccentColor !== undefined ? { brandAccentColor: n.brandAccentColor } : {}),
  }));

  return {
    user: { uid, email, displayName, mustChangePassword, hasPassword },
    namespaces: responseNamespaces,
  };
}

/**
 * Join the user into every workspace their email domain maps to
 * (`AUTO_JOIN_WORKSPACES`), and return the ones actually joined.
 *
 * Three things this deliberately does NOT do:
 *
 * - **It never touches an existing membership.** A member already in the
 *   workspace is skipped entirely, so an owner's promotion to `admin` survives
 *   the next page load. Making this an upsert would silently demote every
 *   promoted member back to `member` — the reason `addMember` is reached only
 *   on the miss.
 * - **It never overrides a removal.** Someone who left, or whom an admin
 *   removed, carries a tombstone (migration 0043) and stays out until an
 *   explicit invite adds them back. Without this, `leave` and "remove member"
 *   would both be no-ops in an auto-join workspace.
 * - **It never creates the workspace.** A rule naming a handle that does not
 *   exist is skipped, so a typo in the env var degrades to "nobody is
 *   auto-joined" instead of conjuring a workspace nobody meant.
 *
 * Failures are swallowed per workspace: auto-join is a convenience layered on
 * top of `getMe`, and a workspace that cannot be joined must not take down the
 * profile read that the whole app blocks on.
 */
async function applyAutoJoin(
  user: { uid: string; email: string | null; displayName: string | null },
  current: readonly Namespace[],
  scope: CallerScope,
): Promise<Namespace[]> {
  const handles = autoJoinHandlesForEmail(user.email, scope.system.autoJoinWorkspaces);
  if (handles.length === 0) return [];

  const alreadyIn = new Set(current.map((n) => n.handle));
  const joined: Namespace[] = [];

  for (const handle of handles) {
    if (alreadyIn.has(handle)) continue;
    try {
      const namespace = await scope.workspaces.getNamespace(handle);
      if (namespace === null) continue;
      if (await scope.workspaces.isAutoJoinBlocked(handle, user.uid)) continue;
      if ((await scope.workspaces.getMember(handle, user.uid)) !== null) continue;

      const now = new Date().toISOString();
      await scope.workspaces.addMember(handle, {
        uid: user.uid,
        role: 'member',
        ...(user.displayName !== null ? { displayName: user.displayName } : {}),
        joinedAt: now,
      });

      await scope.system.audit.append({
        actorId: user.uid,
        actorType: 'user',
        actorRole: 'operator',
        action: 'namespace.member_auto_joined',
        description: `User '${user.uid}' auto-joined '${handle}' as member via email domain`,
        timestamp: now,
        inputSnapshot: { uid: user.uid, handle },
        outputSnapshot: { handle, role: 'member' },
        basis: `AUTO_JOIN_WORKSPACES matched the email domain of '${user.uid}' to workspace '${handle}'`,
        entityType: 'namespace',
        entityId: handle,
        namespace: handle,
      });

      joined.push(namespace);
    } catch {
      continue;
    }
  }

  return joined;
}

async function ensurePersonalNamespace(
  user: { uid: string; email: string | null; displayName: string | null },
  scope: CallerScope,
): Promise<Namespace> {
  const baseHandle = generateHandle(user.email ?? user.uid);
  let handle = baseHandle;
  let attempt = 1;
  // Bounded retry — handle collisions are rare and resolved by suffixing;
  // an unbounded loop here would hide a deeper outage.
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
    namespace: handle,
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
