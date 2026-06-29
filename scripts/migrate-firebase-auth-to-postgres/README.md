# Firebase Auth → Postgres seed (ADR-0002 PR1)

One-time seed of `auth_users` + the global `user_roles` table from current
Firebase Auth users and their `customClaims.roles`.

## Why

PR1 swaps the live `UserDirectoryService` to Postgres. `getUsersByRole` now
reads `user_roles`; an **empty table silently stops escalation notifications**
(workflow-engine) — a regression. This seed must run when PR1 deploys so
targeting keeps working. The role mapping is the same pure function
(`buildUserRolesSeed`) the L2 tests pin against the old Firebase filter, so the
post-seed `getUsersByRole` output is identical to today's.

## Run

```bash
# dry-run (default): prints counts, writes nothing
npx tsx scripts/migrate-firebase-auth-to-postgres/seed-user-roles.ts

# apply
npx tsx scripts/migrate-firebase-auth-to-postgres/seed-user-roles.ts --apply
```

Requires `DATABASE_URL` + Firebase admin credentials. Idempotent
(`ON CONFLICT DO NOTHING`).

## Gate

**Do not run `--apply` on staging without per-action confirmation from the
coordinator.** Never point it at production.
