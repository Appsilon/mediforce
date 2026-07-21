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
 * Input is a Firebase CLI export file, NOT the Admin SDK — the NextAuth cutover
 * removed all Firebase Admin wiring from the codebase. The operator produces the
 * file with the Firebase CLI and passes its path:
 *
 *   firebase auth:export users.json --project <project-id>
 *
 * NOT seeded here: `user_profiles.deployment_admin` / `.current_workspace`.
 * Those columns were deliberately never added — nothing reads them. If a future
 * change introduces them, the raw `customClaims.role` is available on each
 * `FirebaseUserExport` to derive `deployment_admin = role === 'admin'`.
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
 *   npx tsx scripts/migrate-firebase-auth-to-postgres/seed-user-roles.ts users.json
 *   npx tsx scripts/migrate-firebase-auth-to-postgres/seed-user-roles.ts users.json --apply
 *
 * Requires: DATABASE_URL (only for `--apply`) + the export file.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { buildUserRolesSeed } from '../../packages/platform-infra/src/auth/seed-user-roles';
import type { FirebaseUserExport } from '../../packages/platform-infra/src/auth/seed-user-roles';
import { getSharedPostgresClient } from '../../packages/platform-infra/src/postgres/client';
import { authUsers } from '../../packages/platform-infra/src/postgres/schema/auth-user';
import { userRoles } from '../../packages/platform-infra/src/postgres/schema/user-role';

/**
 * Shape of `firebase auth:export`. Only the fields the seed needs are pinned;
 * every other field of the export is ignored. `customAttributes` is a JSON
 * *string* of the custom claims in this format, not an object.
 */
const exportedUserSchema = z.object({
  localId: z.string().min(1),
  email: z.string().optional(),
  displayName: z.string().optional(),
  photoUrl: z.string().optional(),
  customAttributes: z.string().optional(),
});

const exportFileSchema = z.object({
  users: z.array(exportedUserSchema),
});

const customClaimsSchema = z.object({
  role: z.unknown().optional(),
  roles: z.unknown().optional(),
});

function parseCustomClaims(raw: string | undefined): FirebaseUserExport['customClaims'] {
  if (raw === undefined || raw.trim() === '') return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return null;
  }
  const claims = customClaimsSchema.safeParse(decoded);
  return claims.success ? claims.data : null;
}

function readFirebaseExport(path: string): FirebaseUserExport[] {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (cause) {
    throw new Error(`Cannot read Firebase Auth export file "${path}": ${String(cause)}`);
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`Firebase Auth export "${path}" is not valid JSON: ${String(cause)}`);
  }

  const parsed = exportFileSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error(
      `Firebase Auth export "${path}" does not match the expected \`firebase auth:export\` ` +
        `shape ({"users": [{"localId", "email", ...}]}):\n${z.prettifyError(parsed.error)}`,
    );
  }

  return parsed.data.users.map((user) => ({
    uid: user.localId,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    photoURL: user.photoUrl ?? null,
    customClaims: parseCustomClaims(user.customAttributes),
  }));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const exportPath = args.find((arg) => arg.startsWith('--') === false);
  if (exportPath === undefined) {
    throw new Error(
      'Missing Firebase Auth export path.\n' +
        'Produce it with: firebase auth:export users.json --project <project-id>\n' +
        'Usage: npx tsx scripts/migrate-firebase-auth-to-postgres/seed-user-roles.ts <users.json> [--apply]',
    );
  }

  const exported = readFirebaseExport(exportPath);
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
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
