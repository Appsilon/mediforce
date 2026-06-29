#!/usr/bin/env npx tsx
/**
 * One-time seed: Firebase Auth custom claims -> Postgres `auth_users` +
 * global `user_roles` (ADR-0002 §4, PR1).
 *
 * Why it exists: PR1 swaps the live UserDirectoryService to Postgres, so
 * `getUsersByRole` reads `user_roles`. An empty table silently stops
 * escalation notifications (workflow-engine) — a regression. This seed
 * populates `user_roles` from today's Firebase claims so targeting keeps
 * working, using the SAME pure mapping (`buildUserRolesSeed`) the L2 tests
 * pin against the Firebase filter.
 *
 * GATED: dry-run by default. It prints what it WOULD write and exits. Pass
 * `--apply` to actually upsert. Do NOT run `--apply` on staging without the
 * coordinator's per-action confirmation. Never point it at production.
 *
 * Idempotent: upserts with ON CONFLICT DO NOTHING, safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/migrate-firebase-auth-to-postgres/seed-user-roles.ts            # dry-run
 *   npx tsx scripts/migrate-firebase-auth-to-postgres/seed-user-roles.ts --apply    # write
 *
 * Requires: GOOGLE_APPLICATION_CREDENTIALS (or Firebase admin env) + DATABASE_URL.
 */
import { getAdminAuth, getSharedPostgresClient, buildUserRolesSeed } from '@mediforce/platform-infra';
import type { FirebaseUserExport } from '@mediforce/platform-infra';
import { authUsers } from '../../packages/platform-infra/src/postgres/schema/auth-user';
import { userRoles } from '../../packages/platform-infra/src/postgres/schema/user-role';

async function listAllFirebaseUsers(): Promise<FirebaseUserExport[]> {
  const auth = getAdminAuth();
  const users: FirebaseUserExport[] = [];
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) {
      users.push({
        uid: u.uid,
        email: u.email ?? null,
        displayName: u.displayName ?? null,
        photoURL: u.photoURL ?? null,
        customClaims: (u.customClaims as FirebaseUserExport['customClaims']) ?? null,
      });
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const exported = await listAllFirebaseUsers();
  const seed = buildUserRolesSeed(exported);

  console.log(`Firebase users read:        ${exported.length}`);
  console.log(`auth_users rows to seed:    ${seed.authUsers.length}`);
  console.log(`user_roles rows to seed:    ${seed.userRoles.length}`);
  console.log(`skipped (no email):         ${seed.skippedNoEmail.length}`);
  if (seed.skippedNoEmail.length > 0) {
    console.log(`  skipped uids: ${seed.skippedNoEmail.join(', ')}`);
  }

  if (!apply) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to seed.');
    return;
  }

  const db = getSharedPostgresClient().db;
  if (seed.authUsers.length > 0) {
    await db.insert(authUsers).values([...seed.authUsers]).onConflictDoNothing({ target: authUsers.id });
  }
  if (seed.userRoles.length > 0) {
    await db
      .insert(userRoles)
      .values([...seed.userRoles])
      .onConflictDoNothing({ target: [userRoles.uid, userRoles.role] });
  }
  console.log('\nApplied. Re-running is a no-op (ON CONFLICT DO NOTHING).');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
