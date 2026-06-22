import type { Namespace, NamespaceMember, NamespaceMembership } from '../schemas/index';

/**
 * Patch shape for `updateNamespace`. `undefined` means "leave unchanged";
 * any provided string overwrites the field (empty string is the cleared
 * state for `bio`).
 */
export interface NamespaceUpdates {
  readonly displayName?: string;
  readonly icon?: string;
  readonly bio?: string;
  readonly avatarUrl?: string;
}

export interface NamespaceRepository {
  getNamespace(handle: string): Promise<Namespace | null>;
  createNamespace(namespace: Namespace): Promise<void>;
  /**
   * Atomic create: writes the namespace doc, its `ownerMember` member doc,
   * and the denormalised `users/{uid}.organizations` entry in one
   * transaction (Firestore: `WriteBatch`; Postgres: SQL transaction). All-or-
   * nothing — if any leg fails the others must not land. Used by
   * `POST /api/namespaces` so a half-created workspace cannot leak into the
   * UI between the namespace doc and its owner member.
   */
  createNamespaceWithOwner(input: { namespace: Namespace; ownerMember: NamespaceMember }): Promise<void>;
  /**
   * Patch namespace fields. Undefined values are ignored — only
   * explicitly-provided keys are touched. Empty string for `bio` is the
   * cleared state (stored as `""`, not deleted).
   */
  updateNamespace(handle: string, updates: NamespaceUpdates): Promise<void>;
  getNamespacesByUser(uid: string): Promise<Namespace[]>;
  addMember(handle: string, member: NamespaceMember): Promise<void>;
  /**
   * @deprecated No production caller as of PR4.5 — use
   * `removeMemberWithOrganizations` for the DELETE member / POST leave handlers
   * (it also keeps `users/{uid}.organizations` in sync). Full delete in PR-final.
   */
  removeMember(handle: string, uid: string): Promise<void>;
  /**
   * Atomic remove: deletes the member subcollection doc AND arrayRemoves the
   * handle from `users/{uid}.organizations` in one transaction. Mirrors
   * `createNamespaceWithOwner`'s atomic shape. Used by the DELETE member +
   * POST leave handlers so a half-removed member cannot strand in
   * `users/{uid}.organizations` after the member doc is gone.
   */
  removeMemberWithOrganizations(handle: string, uid: string): Promise<void>;
  /**
   * Update a member's role in-place. No-op if no member doc exists for `uid`.
   * Used by PATCH /api/namespaces/:handle/members/:uid.
   */
  setMemberRole(handle: string, uid: string, role: NamespaceMember['role']): Promise<void>;
  /**
   * Cascade delete: deletes every member doc, arrayRemoves the handle from
   * each member's `users/{uid}.organizations`, then deletes the namespace
   * doc. Firestore impl uses a single `WriteBatch`; capacity ~500 ops, so
   * scales to ~249 members (2 ops/member + 1 namespace delete). Used by
   * DELETE /api/namespaces/:handle (owner-only).
   */
  deleteNamespaceCascade(handle: string): Promise<void>;
  getMember(handle: string, uid: string): Promise<NamespaceMember | null>;
  getMembers(handle: string): Promise<NamespaceMember[]>;
  getUserNamespaces(uid: string): Promise<Namespace[]>;

  /**
   * Return every namespace the user is a member of, with their role.
   *
   * Covers both:
   *   - org namespaces (member subcollection: explicit `role`).
   *   - personal namespace (`linkedUserId == uid`: implicit `owner`).
   *
   * Used by the route layer to build `CallerIdentity.namespaceRoles` so
   * handler-side gates (`assertCallerIsNamespaceAdmin`) can authorize without
   * an extra Firestore hit per request.
   */
  getMembershipsForUser(uid: string): Promise<readonly NamespaceMembership[]>;
}
