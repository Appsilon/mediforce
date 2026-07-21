# Firebase Auth → Postgres keep-uid seed (ADR-0002)

One-time seed of `auth_users` (with a **verified email**) + the global
`user_roles` table from current Firebase Auth users and their
`customClaims.roles`.

## Why

ADR-0002 §7 keeps the Firebase uid as `auth_users.id`, so this is a **seed, not
a remap** — no uid column is rewritten. Two things depend on it:

1. **Account linking (§4b).** Setting `auth_users.email_verified` lets the first
   Google sign-in link by verified email onto the pre-existing uid instead of
   minting a fresh one. That is what makes seamless re-login work without a
   reference remap.
2. **Escalation targeting (§5).** PR1 swapped the live `UserDirectoryService`
   to Postgres, so `getUsersByRole` reads `user_roles`; an **empty table
   silently stops escalation notifications** (workflow-engine) — a regression.
   The role mapping is the same pure function (`buildUserRolesSeed`) the L2
   tests pin against the old Firebase filter, so post-seed `getUsersByRole`
   output is identical to today's.

## Not covered (deferred)

`user_profiles.deployment_admin` / `.current_workspace` (PLAN §4) are **not**
seeded here. The `user_profiles` reshape (ADR-0002 §1.2) that adds those columns
is part of the NextAuth-cutover migration; until it lands the columns don't
exist. Once it lands, add the profile upsert
(`deployment_admin = customClaims.role === 'admin'`) to the script — the raw
`customClaims.role` is already carried on each `FirebaseUserExport`.

Passwords are not migrated (Firebase scrypt is proprietary; passwords are
test-only). `password_hash` stays null; email/password users reset if they want
one.

## Run

```bash
# dry-run (default): prints counts, writes nothing
npx tsx scripts/migrate-firebase-auth-to-postgres/seed-user-roles.ts

# apply
npx tsx scripts/migrate-firebase-auth-to-postgres/seed-user-roles.ts --apply
```

Requires `DATABASE_URL` + Firebase admin credentials. Idempotent
(`auth_users` upserts `email_verified` on conflict; `user_roles` is
`ON CONFLICT DO NOTHING`).

## Gate

**Do not run `--apply` on staging without per-action confirmation from the
coordinator.** Never point it at production.
