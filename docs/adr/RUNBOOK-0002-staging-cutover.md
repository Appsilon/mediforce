# RUNBOOK-0002 — Staging cutover: Firebase Auth → NextAuth

Operational runbook for switching **staging** (`staging.mediforce.ai`) from
Firebase Auth to NextAuth (ADR-0002). This is the one-time cutover procedure.
Conceptual background lives in [ADR-0002](0002-firebase-auth-to-nextauth.md) and
the [Authentication setup section](../development.md#authentication-setup-adr-0002);
this file is the exact command sequence.

> **Scope.** Staging only. Every step targets `mediforce-staging`
> (`staging.mediforce.ai`, Firebase/GCP project `mediforce-1c761`). **Never run
> any of this against production.** The seed script has a hard gate in its
> header: never `--apply` without coordinator sign-off, never on prod.

> **Automated path for future environments.** The export-and-seed steps
> ([4](#4-export-the-firebase-users)–[5](#5-seed-auth_users--user_roles-dry-run-then---apply))
> are wrapped, with every pre-flight guard on this page, by
> [`scripts/migrate-firebase-auth-to-postgres/migrate-to-nextauth.py`](../../scripts/migrate-firebase-auth-to-postgres/migrate-to-nextauth.py)
> (see its
> [README section](../../scripts/migrate-firebase-auth-to-postgres/README.md#one-command-migration-migrate-to-nextauthpy)).
> Run it manually per environment (next target: cdisc) **after** steps 1–3
> (Google client → env → migrate). It never targets production and dry-runs by
> default. This runbook remains the authoritative full sequence; the script only
> automates the seed.

---

## What could go wrong, and how we bail

Three failure modes, one bail-out. **(1)** The new container refuses to boot —
`validateEnv` (`instrumentation-node.ts`) prints `FATAL: Missing or invalid
environment variables` and exits, so nothing serves. **(2)** The go/no-go gate
fails — a Google sign-in mints a *fresh uuid* in `auth_users.id` instead of
reusing the user's old Firebase uid, which means verified-email auto-linking
broke and every signed-in user is now detached from their workspaces, tasks and
audit trail. **(3)** Mass login failure — the domain allowlist or OAuth client
is misconfigured and real appsilon.com users are all rejected. In **all three**
cases the bail-out is identical and cheap: **redeploy the pre-cutover
`platform-ui` image** (snapshotted in pre-flight) — Firebase login returns
immediately. The auth migrations are purely additive (0030–0033) and the seeded
rows are invisible to the Firebase app, so **nothing needs to be undone in the
DB**; leftover NextAuth sessions are simply ignored by the old code. See
[Rollback](#rollback--we-deployed-and-its-wrong) at the end.

---

## Pre-flight checklist

Do every item before touching anything. Each is Action / Check / Abort.

### P1 — Confirm the target is staging, not prod
- **Action:**
  ```bash
  ssh mediforce-staging 'hostname; grep -E "^(DOMAIN|NEXT_PUBLIC_APP_URL|AUTH_URL)=" /opt/mediforce/.env'
  ```
- **Check:** `DOMAIN` / `NEXT_PUBLIC_APP_URL` resolve to `staging.mediforce.ai`.
- **Abort:** If anything says a production hostname — **stop**. You are on the wrong host.

### P2 — Back up the staging DB
- **Action:**
  ```bash
  ssh mediforce-staging 'docker exec mediforce-postgres-1 pg_dump -U mediforce mediforce | gzip' \
    > ~/staging-preauth-$(date +%Y%m%d-%H%M).sql.gz
  ```
- **Check:** File exists locally and is non-trivial in size:
  `ls -lh ~/staging-preauth-*.sql.gz` (expect > ~1 MB, not a few bytes).
- **Abort:** Empty/failed dump → do not proceed. Fix DB access first; this dump
  is the only full-restore path.

### P3 — Confirm the NextAuth image is available
The image must contain the NextAuth code **and** migrations 0030–0033. Per the
hard context, PR #999 is CI-green. You deploy the PR-branch SHA directly (see
[step 6](#6-deploy-the-nextauth-build)); confirm the branch and its head SHA:
- **Action:**
  ```bash
  gh pr view 999 --json headRefName,headRefOid,state,mergeable
  ```
- **Check:** `state` is `OPEN` (or `MERGED`); note `headRefOid` — this SHA is
  what you deploy. Record it as `DEPLOY_SHA`.
- **Abort:** If the PR is closed/unmergeable, stop and reconcile with the author.

### P4 — Confirm the local uid-preservation test passed
This is verified **separately** (a Google OAuth login against a dev DB proving a
sign-in reuses the seeded uid). It is a **prerequisite**, not part of this
runbook.
- **Check:** The person who ran it confirms: *"local uid-preservation test
  passed."*
- **Abort:** Not confirmed → do not cut over staging. The gate in step 7 is the
  only other place this is caught, and there it costs a rollback.

### P5 — Snapshot the current (Firebase) image for instant rollback
`deploy-staging.sh` pulls `:latest`, so once the new build exists you cannot roll
back by SHA alone — you need the old image tagged aside.
- **Action:**
  ```bash
  ssh mediforce-staging \
    'docker tag ghcr.io/appsilon/mediforce-platform-ui:latest mediforce-platform-ui:pre-nextauth'
  ```
- **Check:**
  ```bash
  ssh mediforce-staging 'docker image ls mediforce-platform-ui:pre-nextauth'
  ```
  shows one row.
- **Abort:** No image to tag → the currently-running image was never pulled as
  `:latest`; find the running image with
  `ssh mediforce-staging 'docker inspect --format "{{.Image}}" $(docker ps -qf name=platform-ui)'`
  and tag that digest instead. Do not proceed without a rollback image.

### P6 — Confirm Firebase CLI access to the export project
- **Action:**
  ```bash
  firebase projects:list
  ```
- **Check:** `mediforce-1c761` ("Mediforce - staging") is listed.
- **Abort:** Not listed → `firebase login` with an account that has access.

---

## Cutover sequence

Ordering is deliberate and matters:
**Google client → env → migrate → seed → deploy → verify.**
Migrations and the seed run **before** the NextAuth code is deployed — they are
additive and invisible to the still-running Firebase app, which closes the window
where a live login could mint a fresh uid. The seed needs the auth tables to
exist, so migrations come first.

> **Why deploy the PR-branch SHA directly (step 6), not "merge to main"?**
> Merging PR #999 to `main` triggers *Build & Push* → which auto-fires
> `deploy-staging.yml` (`workflow_run`, `branches: [main]`). That would deploy
> NextAuth **before** you seed. Deploying the branch SHA over SSH keeps the code
> landing strictly after the seed. Merge to `main` only after the gate passes
> (step 8).

---

### 1. Create the Google OAuth client

A **new, standalone** Web client in project `mediforce-1c761`. Do **not** reuse
the Firebase-auto-created client — it dies with the Firebase project.

- **Action (console):**
  1. [Google Cloud Console](https://console.cloud.google.com/) → project
     **mediforce-1c761**.
  2. **APIs & Services → OAuth consent screen**: User type **Internal**
     (Workspace `appsilon.com`). Internal skips app verification and restricts to
     the workspace. App name `Mediforce (staging)`, support email an
     appsilon.com address. Save.
  3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
  4. Application type **Web application**. Name `Mediforce Staging NextAuth`.
  5. **Authorized redirect URIs** → add **exactly**:
     ```
     https://staging.mediforce.ai/api/auth/callback/google
     ```
     (No trailing slash. This is the NextAuth Google callback served by the
     `[...nextauth]` catch-all route.)
  6. (Optional) Authorized JavaScript origins: `https://staging.mediforce.ai`.
     Not required for the server-side flow.
  7. **Create** → copy the **Client ID** and **Client secret**.
- **Check:** The credential appears under Credentials with the redirect URI
  above. Client ID ends in `.apps.googleusercontent.com`.
- **Abort/rollback:** Wrong redirect URI is the #1 cause of `redirect_uri_mismatch`
  at sign-in. If unsure, delete the client and recreate — nothing else depends on
  it yet.

### 2. Set the NextAuth env vars on staging

Edit `/opt/mediforce/.env` on the host. Add/confirm these five (the others —
`PLATFORM_API_KEY`, `SECRETS_ENCRYPTION_KEY`, `DATABASE_URL`, email/`MEDIFORCE_DISABLE_EMAIL`
— are already set on running staging; do not remove them).

- **Action:** generate the secret, then edit the file:
  ```bash
  openssl rand -hex 32          # copy output → AUTH_SECRET
  ssh mediforce-staging 'nano /opt/mediforce/.env'
  ```
  Set:
  ```dotenv
  AUTH_SECRET=<openssl output above>
  GOOGLE_CLIENT_ID=<from step 1>
  GOOGLE_CLIENT_SECRET=<from step 1>
  ALLOWED_EMAIL_DOMAINS=appsilon.com
  AUTH_URL=https://staging.mediforce.ai
  ```
  > **`ALLOWED_EMAIL_DOMAINS=appsilon.com` is an intentional consequence.** It
  > blocks Filip's gmail staging account (`fylyps@gmail.com` — he uses his
  > appsilon.com Google account) and the dead `test@crsnt.com`. See
  > [Known limitations](#known-limitations--comms).
- **Check:** Confirm all boot-required keys are present and non-empty. This
  mirrors what `validateEnv` (`instrumentation-node.ts`) enforces at container
  boot in production:
  ```bash
  ssh mediforce-staging \
    'grep -E "^(AUTH_SECRET|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|ALLOWED_EMAIL_DOMAINS|AUTH_URL|PLATFORM_API_KEY|SECRETS_ENCRYPTION_KEY|DATABASE_URL)=" /opt/mediforce/.env'
  ```
  Every listed key must have a non-empty value. `SECRETS_ENCRYPTION_KEY` must be
  64 hex chars. Because Google is on, `ALLOWED_EMAIL_DOMAINS` **must** be
  non-empty (else `validateEnv` refuses to boot — this is the door-closing check,
  deliberately outside the production-only block).
- **Abort/rollback:** `.env` is only read at container (re)start, so nothing is
  live yet. Fix typos before deploying. If you clobbered an existing value,
  restore it from the P2 dump's environment or 1Password (Mediforce vault).

### 3. Apply the additive auth migrations (ahead of the code deploy)

Migrations 0030–0033 create `auth_users`, `user_roles`, `auth_accounts`,
`auth_sessions`, `auth_verification_tokens` and the case-insensitive email index.
All additive — the running Firebase app never reads them. Run them via the
compose `migrate` service built from the PR-branch checkout (this is the repo's
own migration mechanism; the same init container runs on every deploy,
idempotently via Drizzle's `__drizzle_migrations` ledger).

- **Action:**
  ```bash
  ssh mediforce-staging
  cd /opt/mediforce
  git fetch origin
  git checkout <DEPLOY_SHA>          # PR #999 head SHA from P3
  export NEXT_PUBLIC_GIT_SHA=$(git rev-parse --short HEAD)
  COMPOSE="docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml"
  $COMPOSE up --build migrate        # runs once (restart:no), applies pending migrations, exits
  ```
  > `git checkout` only changes files on disk; the running `platform-ui`
  > container is **not** recreated and keeps serving Firebase auth. The `migrate`
  > service depends only on `postgres` (already healthy) and exits when done.
- **Check:** Auth tables exist and the ledger advanced:
  ```bash
  docker exec mediforce-postgres-1 psql -U mediforce -d mediforce -c '\dt auth_*'
  docker exec mediforce-postgres-1 psql -U mediforce -d mediforce -c '\dt user_roles'
  docker exec mediforce-postgres-1 psql -U mediforce -d mediforce \
    -c 'SELECT id FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 5;'
  ```
  Expect `auth_users`, `auth_accounts`, `auth_sessions`, `auth_verification_tokens`,
  `user_roles` all present. Then confirm the **Firebase app still works**: open
  `https://staging.mediforce.ai`, sign in with Google as normal — it must still
  succeed (proves the migration was non-breaking).
- **Abort/rollback:** If `migrate` errors, read its log
  (`$COMPOSE logs migrate`). The migrations are additive, so a *partial* apply is
  unlikely to break Firebase, but do not proceed to seed. If tables are in a bad
  state, restore from the P2 dump:
  `gunzip -c staging-preauth-*.sql.gz | docker exec -i mediforce-postgres-1 psql -U mediforce -d mediforce`
  (drop/recreate DB first if needed). Firebase app is unaffected regardless.

### 4. Export the Firebase users

- **Action (from a machine with Firebase CLI logged in — e.g. your laptop):**
  ```bash
  firebase auth:export users.json --project mediforce-1c761
  ```
- **Check:** `users.json` exists and contains ~37 users:
  ```bash
  jq '.users | length' users.json      # expect ~37
  ```
- **Abort:** Wrong/empty export → re-run; confirm `--project mediforce-1c761`.
  Do not seed from a partial export (the seed validates shape with Zod and fails
  loudly, but a *short* valid file would silently seed too few users).

### 5. Seed `auth_users` + `user_roles` (dry-run, then `--apply`)

The seed inserts each Firebase user into `auth_users` with `email_verified = now()`
— **this is what makes the first Google sign-in link onto the existing uid**
(the whole point). It also seeds `user_roles` from custom claims (expected empty
here — no custom claims exist). Passwords are **not** migrated.

Run it against the staging DB. The script is `npx tsx …` and needs the workspace
toolchain + a `DATABASE_URL` reaching the container Postgres. Run it as a one-off
`node` container joined to the compose network (no host toolchain, no exposed
port; connects via the `postgres` service DNS). Copy the export up first:

- **Action:**
  ```bash
  # from the machine that produced users.json:
  scp users.json mediforce-staging:/opt/mediforce/users.json

  # on the host:
  ssh mediforce-staging
  cd /opt/mediforce
  set -a; source .env; set +a               # loads POSTGRES_PASSWORD etc.
  NET=$(docker network ls --format '{{.Name}}' | grep -m1 mediforce)   # e.g. mediforce_default
  SEED="npx tsx scripts/migrate-firebase-auth-to-postgres/seed-user-roles.ts /repo/users.json"
  RUN="docker run --rm --network $NET -v /opt/mediforce:/repo -w /repo \
       -e DATABASE_URL=postgresql://mediforce:$POSTGRES_PASSWORD@postgres:5432/mediforce \
       node:22-bookworm sh -c"

  # --- dry-run (writes nothing, prints counts) ---
  $RUN "corepack enable && pnpm install --frozen-lockfile --prefer-offline --silent && $SEED"
  ```
- **Check (dry-run):** Read the printed counts. Expect approximately:
  ```
  Firebase users read:        37
  auth_users rows to seed:    37   (or 36 — one may lack an email)
  user_roles rows to seed:    0
  skipped (no email):         0
  ```
  `user_roles = 0` is **expected** (no custom claims). Investigate any large
  `skipped` count before applying.
- **Action (apply) — GATED, coordinator sign-off required:**
  ```bash
  $RUN "corepack enable && pnpm install --frozen-lockfile --prefer-offline --silent && $SEED --apply"
  ```
- **Check (apply):**
  ```bash
  docker exec mediforce-postgres-1 psql -U mediforce -d mediforce \
    -c 'SELECT count(*) FROM auth_users;'                        # ~37
  docker exec mediforce-postgres-1 psql -U mediforce -d mediforce \
    -c "SELECT id, email, email_verified FROM auth_users WHERE email='fylyps@gmail.com';"
  ```
  `count` ≈ 37; a known user's row exists with a **non-null `email_verified`** and
  its `id` is the **original Firebase uid** (a ~28-char alphanumeric string with
  **no dashes** — not a uuid). Spot-check that this uid matches the `localId` for
  the same email in `users.json`.
- **Abort/rollback:** The seed is idempotent (`auth_users` upserts
  `email_verified`; `user_roles` is `ON CONFLICT DO NOTHING`), so a re-run is
  safe. If it wrote garbage, the rows are still invisible to Firebase — you can
  `TRUNCATE user_roles; DELETE FROM auth_users;` and re-seed, or restore from the
  P2 dump. **Do not deploy the NextAuth code until the apply check is clean.**

### 6. Deploy the NextAuth build

Deploy the PR-branch SHA directly over SSH. `deploy-staging.sh` checks out the
SHA, force-recreates `platform-ui` with the new image + the new `.env`, and runs
the `migrate` init container again (idempotent no-op — migrations already
applied). `--no-cache` builds `platform-ui` from *this* checkout so you get the
NextAuth code regardless of what `:latest` points at.

- **Action:**
  ```bash
  ssh mediforce-staging "/opt/mediforce/scripts/deploy-staging.sh <DEPLOY_SHA> --no-cache"
  ```
- **Check:** Boot log shows **no** `FATAL: Missing or invalid environment
  variables`, and the app answers:
  ```bash
  ssh mediforce-staging \
    'cd /opt/mediforce && docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml logs --tail=100 platform-ui' \
    | grep -i "fatal\|error\|listening"
  curl -fsS https://staging.mediforce.ai/api/health          # {"status":"ok",...}  HTTP 200
  curl -fsS https://staging.mediforce.ai/api/auth/providers  # JSON, includes a "google" entry
  ```
  `/api/health` returns 200 with `{"status":"ok",…}`; `/api/auth/providers`
  lists `google`.
- **Abort/rollback:** `FATAL … environment variables` → the container exits;
  fix the missing key in `.env` (step 2 check) and re-run the deploy. If the
  build itself fails, the old container is still running (force-recreate only
  swaps on success) — you are still on Firebase, safe to retry. If it booted
  wrong, jump to [Rollback](#rollback--we-deployed-and-its-wrong).

### 7. GATE — verify uid preservation (go / no-go)

**This is the decision point.** A real appsilon.com Google sign-in must resolve
to the user's **old Firebase uid**, not a fresh uuid.

- **Action:** In a browser, go to `https://staging.mediforce.ai`, sign in with a
  **real appsilon.com Google account that existed in Firebase**. Then:
  ```bash
  docker exec mediforce-postgres-1 psql -U mediforce -d mediforce -c \
    "SELECT id, email FROM auth_users WHERE email='<that-account>@appsilon.com';"
  docker exec mediforce-postgres-1 psql -U mediforce -d mediforce -c \
    "SELECT provider, provider_account_id, user_id FROM auth_accounts \
     WHERE user_id=(SELECT id FROM auth_users WHERE email='<that-account>@appsilon.com');"
  ```
- **Check — GATE PASS if all true:**
  - `auth_users.id` for that email is the **old Firebase uid** (~28 chars,
    alphanumeric, **no dashes**) — the same value seeded in step 5, **not** a
    canonical uuid (`8-4-4-4-12` with dashes).
  - An `auth_accounts` row exists with `provider = google` pointing at that same
    `user_id` (proves the account got linked, via
    `allowDangerousEmailAccountLinking` + the seeded `email_verified`).
  - In the UI, that user's **workspaces and tasks are visible** (data stayed
    attached to the preserved uid).
  - **Sign out**, then a call to a protected endpoint returns **401** (the
    single `auth_sessions` row was deleted).
  - An **out-of-domain** Google account (any non-appsilon.com) is **rejected**
    at sign-in (blocked in the `signIn` callback by `ALLOWED_EMAIL_DOMAINS`; no
    `auth_users`/session row is created for it).
- **GATE FAIL → ROLL BACK immediately if:** `auth_users.id` is a **uuid**
  (dashes) instead of the old uid. That means verified-email auto-linking failed
  and this user — and every other who signs in — is now orphaned from their data.
  Do not "fix forward." Go to [Rollback](#rollback--we-deployed-and-its-wrong).

### 8. Finalize

Only after the gate passes.

- **Action:** Merge PR #999 to `main` so `:latest` and the auto-deploy pipeline
  match what is live. (The auto-deploy that fires on merge is now a no-op re-apply
  of the same code + idempotent migrations.)
- **Action:** Post the user comms below.
- **Check:** After the main auto-deploy settles, re-run the step 6 `curl` checks;
  still 200 / `google` listed.
- **Abort:** If the post-merge auto-deploy somehow regresses, roll back per below
  and investigate the `main` vs branch image difference.

---

## Known limitations & comms

Track and communicate these — they are expected, not bugs:

- **`ALLOWED_EMAIL_DOMAINS=appsilon.com` blocks two accounts by design:** Filip's
  personal `fylyps@gmail.com` (he signs in with his appsilon.com Google account
  instead) and the dead `test@crsnt.com`. The real password-only user
  `sasha.dcosta@appsilon.com` uses Google SSO.
- **Passwords are not migrated** (Firebase scrypt ≠ our bcrypt). Password-only
  users cannot sign in with a password afterwards — they use Google. Recovery is
  deferred:
  - [#1001](https://github.com/Appsilon/mediforce/issues/1001) — password recovery
  - [#1002](https://github.com/Appsilon/mediforce/issues/1002) — invite dead-end without Google
  - [#1003](https://github.com/Appsilon/mediforce/issues/1003) — password-login rate limiting
- **`user_roles` is empty** after seeding (no custom claims exist; the roles
  feature isn't built yet). Expected.

**User comms (to appsilon.com staging users):** *"Staging login now uses 'Sign in
with Google' with your appsilon.com account — the same button, your data is
unchanged. Email/password login on staging is temporarily unavailable; use
Google."*

---

## Rollback — "we deployed and it's wrong"

**Pull the trigger when:** the gate shows a **uuid instead of the old uid**;
the container **fails to boot** (`FATAL … environment variables`); or **appsilon.com
users can't sign in** at all.

The rollback is cheap because the DB changes are additive and inert to the old
code.

1. **Redeploy the pre-cutover image** (snapshotted in P5):
   - **Action:**
     ```bash
     ssh mediforce-staging
     cd /opt/mediforce
     git checkout <previous-main-SHA>     # the Firebase-era commit that was live
     docker tag mediforce-platform-ui:pre-nextauth ghcr.io/appsilon/mediforce-platform-ui:latest
     COMPOSE="docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml"
     $COMPOSE up -d --force-recreate platform-ui
     ```
     (Retagging the snapshot as `:latest` stops the deploy script re-pulling the
     new image. Alternatively rebuild from the old checkout:
     `scripts/deploy-staging.sh <previous-main-SHA> --no-cache`.)
   - **Check:** `https://staging.mediforce.ai` serves the **Firebase** login and
     an appsilon.com Google sign-in works; `curl -fsS …/api/health` → 200.
2. **Leave the DB as-is.** The auth tables (0030–0033) and the seeded
   `auth_users` / `user_roles` rows are **additive and unread** by the Firebase
   app — they cost nothing and save re-seeding on the next attempt. NextAuth
   `auth_sessions` rows are simply ignored. **Do not** drop them unless a fresh
   attempt requires a clean slate — and even then prefer re-seeding (idempotent)
   over the P2 restore.
3. **Restore from P2 dump** only if the DB is genuinely corrupted:
   ```bash
   gunzip -c ~/staging-preauth-*.sql.gz \
     | ssh mediforce-staging 'docker exec -i mediforce-postgres-1 psql -U mediforce -d mediforce'
   ```
4. **Post-mortem before retrying:** a uuid-not-uid gate failure means
   `email_verified` wasn't set on the matched row, the emails didn't match
   (case / typo — check the 0033 lower(email) index), or
   `allowDangerousEmailAccountLinking` wasn't in effect. Fix, re-seed, redeploy.

---

## Open items to nail down before the real run

These are the points where the repo did **not** give a single definitive command;
confirm them with the coordinator ahead of time:

1. **Seed execution environment (step 5).** The repo has no "run the seed on
   staging" wrapper. The one-off `node:22` container on the compose network is a
   constructed approach: it runs `pnpm install` into `/opt/mediforce` (writes a
   gitignored `node_modules` on the host — harmless but present) and assumes the
   staging host has enough disk/RAM for a transient install. Alternative: run the
   seed and `pnpm db:migrate` from a laptop checkout over an SSH tunnel to the
   container Postgres (the container publishes no host port, so the tunnel needs a
   temporary `socat`/`-p` proxy). Pick one and test the mechanics before cutover.
2. **Compose network name (step 5).** `mediforce_default` is the expected default
   (project dir `/opt/mediforce`), but the `grep -m1 mediforce` discovery must be
   confirmed to resolve to the right network on the host.
3. **`migrate` image build (step 3).** `up --build migrate` builds from the
   checkout; if the branch's migrate image is already in the registry as a tagged
   build, a plain `$COMPOSE pull migrate && $COMPOSE up migrate` is faster.
   Confirm which is available.
4. **Old-uid vs uuid identification (steps 5, 7).** The "≈28 chars, no dashes =
   Firebase uid; dashes = uuid" heuristic is visual. Ideally grab one known
   `localId` from `users.json` up front and compare exactly.
5. **`previous-main-SHA` for rollback.** Record the currently-live commit SHA in
   pre-flight (`ssh mediforce-staging 'cd /opt/mediforce && git rev-parse HEAD'`)
   so the rollback checkout target is known, not guessed.
