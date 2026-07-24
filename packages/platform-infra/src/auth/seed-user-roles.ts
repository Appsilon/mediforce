/**
 * Pure mapping from a Firebase Auth user export to the rows that seed the
 * Postgres `auth_users` + global `user_roles` tables (ADR-0002 §4, §5, PR1).
 *
 * The role extraction mirrors `FirebaseUserDirectoryService.getUsersByRole`
 * EXACTLY so that, after the seed, `PostgresUserDirectoryService.getUsersByRole`
 * returns the identical set for every role — the non-breaking guarantee for
 * escalation-notification targeting:
 *
 *   - `customClaims.roles: string[]` present  → one row per entry (the `role`
 *     scalar is ignored, matching the Firebase filter's `else` branch).
 *   - otherwise `customClaims.role: string`   → a single row for that role.
 *
 * Users without an email are skipped: `auth_users.email` is `NOT NULL UNIQUE`
 * and a user with no email cannot be an escalation notification target.
 *
 * Pure and idempotent: same input → same output, role rows de-duplicated per
 * user. The script applies the rows with `ON CONFLICT DO NOTHING`, so a re-run
 * is a no-op.
 */

export interface FirebaseCustomClaims {
  readonly role?: unknown;
  readonly roles?: unknown;
}

export interface FirebaseUserExport {
  readonly uid: string;
  readonly email: string | null;
  readonly displayName?: string | null;
  readonly photoURL?: string | null;
  readonly customClaims?: FirebaseCustomClaims | null;
}

export interface AuthUserSeedRow {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly image: string | null;
}

export interface UserRoleSeedRow {
  readonly uid: string;
  readonly role: string;
}

export interface UserRolesSeed {
  readonly authUsers: AuthUserSeedRow[];
  readonly userRoles: UserRoleSeedRow[];
  /** uids skipped because they had no email (cannot be seeded). */
  readonly skippedNoEmail: string[];
}

function rolesFromClaims(claims: FirebaseCustomClaims | null | undefined): string[] {
  if (claims === null || claims === undefined) return [];
  if (Array.isArray(claims.roles)) {
    const unique = new Set(
      claims.roles.filter((r): r is string => typeof r === 'string' && r !== ''),
    );
    return [...unique];
  }
  if (typeof claims.role === 'string' && claims.role !== '') {
    return [claims.role];
  }
  return [];
}

export function buildUserRolesSeed(users: readonly FirebaseUserExport[]): UserRolesSeed {
  const authUsersRows: AuthUserSeedRow[] = [];
  const userRolesRows: UserRoleSeedRow[] = [];
  const skippedNoEmail: string[] = [];

  for (const user of users) {
    if (user.email === null || user.email === '') {
      skippedNoEmail.push(user.uid);
      continue;
    }
    authUsersRows.push({
      id: user.uid,
      email: user.email,
      name: user.displayName ?? null,
      image: user.photoURL ?? null,
    });
    for (const role of rolesFromClaims(user.customClaims)) {
      userRolesRows.push({ uid: user.uid, role });
    }
  }

  return { authUsers: authUsersRows, userRoles: userRolesRows, skippedNoEmail };
}
