#!/usr/bin/env npx tsx
/**
 * One-time keep-uid seed: Firebase Auth users -> Postgres `auth_users`
 * (verified email) + global `user_roles` (ADR-0002 §4, §7).
 *
 * ADR-0002 §7 keeps the Firebase uid as `auth_users.id` (text), so this is a
 * SEED, not a remap — no uid column anywhere is rewritten. For each Firebase
 * user it inserts:
 *   - `auth_users(id=uid, email, name=displayName, image=photoURL,
 *      email_verified=now())`. `email_verified` is what lets the first Google
 *      sign-in LINK by verified email onto the pre-existing uid (§4b) instead
 *      of minting a new one — the whole point of keeping the uid.
 *   - one `user_roles(uid, role)` row per `customClaims.roles` entry (global,
 *      §5) so `getUsersByRole` escalation targeting keeps working. Uses the
 *      SAME pure mapping (`buildUserRolesSeed`) the L2 tests pin against the
 *      Firebase filter.
 *
 * NOT seeded here (deferred): `user_profiles.deployment_admin` /
 * `.current_workspace` (PLAN §4). The `user_profiles` reshape (§1.2) adding
 * those columns is a separate Drizzle migration owned by the NextAuth-cutover
 * change; until it lands the columns do not exist. Once they do, add the
 * profile upsert (deployment_admin = customClaims.role === 'admin') here — the
 * per-user `customClaims.role` is available on the `FirebaseUserExport`.
 * `password_hash` stays null (Firebase scrypt is proprietary; passwords are
 * test-only) — email/password users reset if they want one.
 *
 * GATED: dry-run by default. It prints what it WOULD write and exits. Pass
 * `--apply` to actually upsert. Do NOT run `--apply` on staging without the
 * coordinator's per-action confirmation. Never point it at production.
 *
 * Idempotent: `auth_users` upserts `email_verified` on conflict (so a
 * PR1-seeded row without it is upgraded); `user_roles` uses ON CONFLICT DO
 * NOTHING. Safe to re-run.
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
    const now = new Date();
    const rows = seed.authUsers.map((user) => ({ ...user, emailVerified: now }));
    await db
      .insert(authUsers)
      .values(rows)
      .onConflictDoUpdate({ target: authUsers.id, set: { emailVerified: now } });
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
