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

## Not covered

`user_profiles.deployment_admin` / `.current_workspace` are **not** seeded — the
`user_profiles` reshape that would add those columns was deliberately not done in
the NextAuth cutover, because nothing reads them. If a later change introduces
them, the raw `customClaims.role` is already carried on each `FirebaseUserExport`
so the profile upsert (`deployment_admin = customClaims.role === 'admin'`) can be
added to the script then.

Passwords are not migrated (Firebase scrypt is proprietary; passwords are
test-only). `password_hash` stays null; email/password users reset if they want
one.

## Run

The script reads a **Firebase CLI export file** — the codebase no longer contains
any Firebase Admin wiring, so there is no live Admin SDK call. Produce the file
first with the Firebase CLI:

```bash
firebase auth:export users.json --project <project-id>
```

Then pass its path as the first argument:

```bash
# dry-run (default): prints counts, writes nothing
npx tsx scripts/migrate-firebase-auth-to-postgres/seed-user-roles.ts users.json

# apply
npx tsx scripts/migrate-firebase-auth-to-postgres/seed-user-roles.ts users.json --apply
```

The file shape (`{"users": [{"localId", "email", "displayName", "photoUrl",
"customAttributes"}]}`) is validated with Zod; a malformed file fails loudly
instead of seeding a partial set. `customAttributes` is a JSON *string* of the
custom claims — a missing or unparseable value is treated as "no claims".

Requires `DATABASE_URL` (only for `--apply`). Idempotent
(`auth_users` upserts `email_verified` on conflict; `user_roles` is
`ON CONFLICT DO NOTHING`).

## Gate

**Do not run `--apply` on staging without per-action confirmation from the
coordinator.** Never point it at production.

## One-command migration (`migrate-to-nextauth.py`)

`migrate-to-nextauth.py` is the **automated path** for the manual seed sequence in
[`docs/adr/RUNBOOK-0002-staging-cutover.md`](../../docs/adr/RUNBOOK-0002-staging-cutover.md)
(steps 4–5). It **wraps** the tsx seed above (it does not re-implement seeding)
behind a single guarded command, so the next environment (e.g. cdisc) can be cut
over without hand-copying the runbook commands.

Run it **manually**, **after** the operator has set that environment's Google
credentials + `ALLOWED_EMAIL_DOMAINS` (runbook step 2) and applied the auth
migrations 0030–0033 (runbook step 3). The script does neither of those — it
*verifies* the migrations landed and refuses otherwise. Dry-run is the default;
`--apply` writes and then post-verifies. **It never targets production.**

### What it does, in order

1. **Guard 1 — production protection.** Refuses outright (no override) if the
   `--project` id or `--database-url` contains `mediforce-platform` / `prod` /
   `production`. For any project id not on the known-staging allowlist it demands
   `--allow-unlisted-env`, so a new environment is always a conscious opt-in.
   Runs *first*, before touching the export or the DB.
2. **Export** the Firebase users (`firebase auth:export`), unless
   `--export-file` points at an existing export.
3. **Guard 2 — DB reachable.** `SELECT 1` through the Postgres container.
4. **Guard 3 — auth tables exist.** Checks `information_schema` for `auth_users`,
   `user_roles`, `auth_accounts`, `auth_sessions`; aborts with "run migrations
   first" if any is missing.
5. **Guard 4 — export sanity.** Aborts on 0 users; `--min-users N` sets a higher
   floor so a short-but-valid file cannot silently seed too few users.
6. **Guard 5 — domain allowlist.** Computes each user's email domain with the
   same logic as `packages/platform-ui/src/lib/email-allowlist.ts` and lists
   everyone whose domain is **not** in `--allowed-domains` — they **will be
   locked out** after cutover (as Filip's gmail + `test@crsnt.com` were on
   staging). Aborts unless `--acknowledge-locked-out` is passed, so it is never
   silent.
7. **Guard 6 — password-only users.** Flags users with no federated Google
   provider in the export; their Firebase passwords are **not** migrated, so they
   cannot password-login afterwards. A **warning**, not fatal — surfaced so it is
   never a surprise.
8. **Seed dry-run** (always) — drives the tsx seed's own dry-run for the
   authoritative counts.
9. **`--apply`** — runs the tsx seed `--apply`, then **post-verifies**:
   `auth_users` count ≥ the number seeded, **zero** rows with NULL
   `email_verified`, and a **uid-preservation spot-check** (export `localId` ==
   `auth_users.id` for the same email). Any failure aborts loudly — that is the
   same failure the runbook step-7 gate catches, caught here before deploy.

### How it reaches the environment (assumptions)

- **The tsx seed** runs as a one-off `node:22-bookworm` container joined to the
  compose network — exactly the runbook step-5 pattern. No host Node toolchain,
  no exposed DB port; the DB is reached via the `postgres` service DNS in
  `--database-url`. Network name defaults to `<repo-dir-basename>_default`
  (`mediforce_default` for `/opt/mediforce`); override with `--network`.
- **DB queries** (guards + post-verify) go through `docker exec
  <postgres-container> psql` (default `mediforce-postgres-1`, override with
  `--postgres-container`). This is chosen over a direct `psycopg` connection
  because it needs the **fewest host assumptions**: `--database-url` points at
  the in-network `postgres:5432` DNS name, which the host cannot resolve, and it
  requires no Python DB driver. The only host requirement is the Docker CLI,
  which the compose deployment already has.

### cdisc worked example

Operator has already set cdisc's `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` /
`ALLOWED_EMAIL_DOMAINS=cdisc.org` and run the migrations. On the cdisc host:

```bash
# Dry-run — prints counts, the locked-out list, the password-only list, writes nothing.
# cdisc's project id is not on the known-staging allowlist, so --allow-unlisted-env
# is required.
python3 scripts/migrate-firebase-auth-to-postgres/migrate-to-nextauth.py \
  --project mediforce-cdisc \
  --database-url postgresql://mediforce:$POSTGRES_PASSWORD@postgres:5432/mediforce \
  --allowed-domains cdisc.org \
  --allow-unlisted-env

# Apply — only after reviewing the dry-run. --acknowledge-locked-out is required
# iff the dry-run listed any out-of-domain users.
python3 scripts/migrate-firebase-auth-to-postgres/migrate-to-nextauth.py \
  --project mediforce-cdisc \
  --database-url postgresql://mediforce:$POSTGRES_PASSWORD@postgres:5432/mediforce \
  --allowed-domains cdisc.org \
  --acknowledge-locked-out --apply
```

`mediforce-cdisc` is a recognised environment in `KNOWN_STAGING_PROJECTS`, so
`--allow-unlisted-env` is not needed for it. See `--help` for every flag
(`--repo-dir`, `--network`,
`--postgres-container`, `--min-users`, `--export-file`).
