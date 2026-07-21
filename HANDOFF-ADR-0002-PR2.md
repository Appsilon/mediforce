# Handoff — ADR-0002 PR2 (Firebase Auth → NextAuth atomic cutover)

**Branch:** `claude/firebase-auth-migration-uc1zop` (stacked on PR1 branch
`feat/adr-0002-pr1-pg-user-management`, NOT on `main`).
**Base to compare against:** `origin/feat/adr-0002-pr1-pg-user-management`.
**Spec:** `docs/adr/0002-firebase-auth-to-nextauth.md` + `docs/adr/PLAN-0002.md`.
**Status:** core cutover implemented; L1/L2 verified; **full `tsc -b` and full
test run NOT yet done**; browser/L4 + real OAuth unverified (needs staging).

> Delete this file before opening the PR.

---

## How to reproduce the verification setup

A local Postgres was used for L2/L3 (docker daemon is not available in the
sandbox; Postgres binaries are). To bring one up:

```bash
# as the unprivileged `postgres` user (initdb refuses root)
PGDATA=/tmp/pgdata; PGBIN=$(ls -d /usr/lib/postgresql/*/bin | head -1)
mkdir -p "$PGDATA"; chown postgres:postgres "$PGDATA"
sudo -u postgres "$PGBIN/initdb" -D "$PGDATA" -U mediforce --auth=trust
sudo -u postgres "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p 5433 -k /tmp" -l /tmp/pg.log start
sudo -u postgres "$PGBIN/createdb" -h 127.0.0.1 -p 5433 -U mediforce mediforce
export TEST_DATABASE_URL="postgresql://mediforce@127.0.0.1:5433/mediforce"
```

`pnpm install` works (registry reachable). NextAuth deps already added to
`packages/platform-ui/package.json`: `next-auth@5.0.0-beta.31`,
`@auth/drizzle-adapter@1.11.2`, `bcryptjs@^3`, `@types/bcryptjs` (dev).

**Verified green so far:**
- `pnpm --filter @mediforce/platform-infra exec vitest run` → **558 pass** (needs `TEST_DATABASE_URL`).
- `pnpm --filter @mediforce/platform-api exec vitest run src/handlers/users` → 50 pass (per subagent).
- platform-ui: api-auth (16), email-allowlist+session-cookie (15), the 10 migrated auth-mock test files (117), invite/resend routes (12).
- `pnpm --filter @mediforce/platform-infra exec tsc --noEmit` and platform-api tsc → clean (per subagent).

---

## NEXT STEPS (in order)

1. **`pnpm typecheck` (full `tsc -b`).** This is the big integration gate — it
   was interrupted, never run across all packages together. Likely trouble spots:
   - `packages/platform-ui/src/auth.ts` — NextAuth v5 **beta.31** types: the
     OIDC provider object literal (`type: 'oidc'`), the `jwt.encode` override
     signature, `session`/`jwt` callback param types, `token.sessionId` (added
     via the `next-auth/jwt` module augmentation in `src/types/next-auth.d.ts`).
   - The module augmentation itself (`src/types/next-auth.d.ts`) — confirm it's
     picked up by tsconfig `include`.
   - `providers.tsx` `SessionProvider` import.
   - Any residual `firebaseUser` / deleted-import references the subagents
     might have missed (grep is clean, but tsc is authoritative).
2. **`pnpm test:unit`** (full). Fix fallout. Run with `TEST_DATABASE_URL` set.
3. **Boot smoke test** — the ONLY way to validate the NextAuth wiring here:
   ```bash
   DATABASE_URL=$TEST_DATABASE_URL AUTH_SECRET=$(openssl rand -hex 32) \
   ENABLE_PASSWORD_AUTH=true PLATFORM_API_KEY=dev MEDIFORCE_DISABLE_EMAIL=true \
   SECRETS_ENCRYPTION_KEY=$(openssl rand -hex 32) \
   pnpm --filter @mediforce/platform-ui dev   # or `next build && next start`
   ```
   Then curl: `/api/auth/providers` (should list credentials), `/api/auth/session`
   (should be null when unauthenticated), and verify `/api/health` is public and
   a protected `/api/*` route 401s without a cookie. This exercises the DB pool
   in `proxy.ts` (nodejs runtime) and the auth.ts config load.
4. **Clean up leftovers:**
   - `packages/platform-api/src/services/invite-emails.ts` still exports an
     unused `sendInviteEmail` body helper (+ its re-export in `services/index.ts`
     + likely a test). Remove it (rzeźba per AGENTS.md #2).
   - Decide deps: `firebase` (client SDK) is now unused in `packages/platform-ui`
     — remove from its `package.json`. `firebase-admin` — the migration seed
     script (`scripts/migrate-firebase-auth-to-postgres/`) is the only intended
     consumer; **grep showed no `firebase-admin` import there** — verify the
     script actually reads Firebase (`listUsers`) or whether it now works off a
     pre-existing export. If nothing imports `firebase-admin`, remove it too.
   - `docs/E2E-STRATEGY.md` and `docs/running-workspace-locally.md` still mention
     the Firebase Auth emulator (:9099) — doc pass.
5. **`/self-review` as a subagent, then `/code-review`.** Iterate to SHIP.
   Regression-diff every replaced read/write/endpoint/hook (AGENTS.md #10).
6. **Real E2E (cannot be done in the sandbox):** a `pnpm test:e2e` run against a
   live server + DB, and a manual Google-OAuth round-trip on staging (with a real
   `GOOGLE_CLIENT_ID` + `ALLOWED_EMAIL_DOMAINS`). Verify the §8 smoke list in
   PLAN-0002 §5 PR2 step 5 (auto-link, allowlist reject, sign-out → 401, delete
   `auth_sessions` row → 401).

---

## Key design decisions (some deviate from PLAN — read these)

- **`user_profiles` kept MINIMAL** (`uid`, `must_change_password` only). PLAN
  §1.2 wanted `deployment_admin` + `current_workspace` + profile fields, but a
  full grep showed **nothing in live code reads deployment-admin** (all "admin"
  checks are `workspace_members` governance; process roles come from
  `user_roles`), and current-workspace is URL-driven. So those columns were NOT
  added (rule #1 simplify / no unused surface). **Consequence:** the session
  exposes `user.roles` (from `user_roles`) — consumed by `useViewerIdentity` —
  but NOT `deploymentAdmin`/`currentWorkspace`. If a future feature needs
  deployment-admin, add the column + session field then. The migration seed
  script correctly does not seed those columns (the e2e subagent flagged this as
  a "deferral" — it is actually an intentional non-addition, adjust its wording).
- **`workspace_members.role → membership`** renamed at the DB + Drizzle-property
  level only; the domain type `NamespaceMember.role` stays `role`
  (`namespace-repository.ts` maps `membership` column → `.role`). Typecheck-guarded.
- **Personal-workspace bootstrap stays LAZY in `getMe`** (get-me handler), NOT
  moved into the NextAuth `signIn` callback (PLAN §6 suggested moving it). The
  `signIn` callback does ONLY the `ALLOWED_EMAIL_DOMAINS` gate — avoids
  duplicating the handle-generation logic in two places. Every logged-in user
  hits `/api/users/me`, so bootstrap still runs idempotently.
- **Credentials provider + database sessions:** Auth.js doesn't persist a DB
  session for credential logins. Worked around in `auth.ts` via `jwt` callback
  (mint an `auth_sessions` row) + `jwt.encode` override (return that token as the
  cookie value). All providers therefore yield one revocable DB-session model.
  **This is the highest-risk piece — verify at runtime.**
- **`proxy.ts` runs on the Node runtime** (`config.runtime = 'nodejs'`) so it can
  do a real `resolveSessionUserId` DB lookup (not just a cookie-presence check),
  matching the pre-cutover "invalid credential → 401 at the gate" behavior. The
  shared PG client is a lazy singleton, safe to import in middleware.
- **Set-password** is a focused inline route (`app/api/users/set-password/route.ts`,
  session-authed, bcrypt cost 12) rather than a full headless handler. Password
  auth is dev/E2E/demo (ADR §4); if you want it as a proper
  `mediforce.users.setPassword` handler + contract, that's a small follow-up.
- **Session cookie helper** handles both `authjs.session-token` and
  `__Secure-authjs.session-token` (https). Confirm the secure-prefix name in the
  deployed (https) context.

---

## Flagged behavior changes / risks to review (AGENTS.md #10)

1. **Re-invite no longer overwrites an existing member's role.** `seedInvite`
   uses `onConflictDoNothing`; the old Firebase `addMember` upserted the role.
   Role changes go through the settings `setMemberRole` flow. Per ADR this is
   acceptable, but it IS a behavior change — decide whether to restore upsert
   parity in `PostgresInviteService.seedInvite` or keep as-is.
2. **`dev:mock` mode:** `auth.ts` calls `getSharedPostgresClient()` at module
   load, which requires `DATABASE_URL`. `dev:mock` runs without a DB, so NextAuth
   auth won't work there. Post-Firebase, `dev:mock`'s auth story needs a decision
   (require a DB, or a mock-session shim). Not blocking for `pnpm dev`.
3. **NextAuth v5 is a beta** (beta.31) on Next 16 / React 19 — pin is
   deliberate; watch for peer-dep / type friction at typecheck and runtime.
4. **CORS:** `proxy.ts` dropped the Firebase `*.hosted.app` allowlist pattern
   (ADR §6 says it retires) and the `Authorization` CORS header; kept
   localhost + `ALLOWED_ORIGINS` + added `Access-Control-Allow-Credentials`.

---

## File map (what changed, by area)

**Schema / migration (platform-infra):** `schema/auth-user.ts` (ALTER),
`schema/auth-account.ts`, `schema/auth-session.ts`,
`schema/auth-verification-token.ts` (new), `schema/workspace.ts` (rename),
`schema/index.ts`, `migrations/0030_nextauth_tables.sql` + `meta/_journal.json`,
`repositories/namespace-repository.ts` (membership mapping),
`repositories/user-profile-repository.ts` (unchanged — minimal).

**Session/credential primitives (platform-infra, L2-tested):**
`auth/session-store.ts` (`resolveSessionUserId`, `getUserRoles`,
`createDatabaseSession`, `SESSION_TTL_MS`), `auth/credentials-store.ts`
(`setUserPasswordHash`), `auth/postgres-invite-service.ts` (+`isInvitePending`).
Exports in `src/index.ts`. **Deleted:** `firebase-admin-init.ts`,
`firebase-invite-service.ts`, `firebase-user-directory-service.ts`,
`config/firebase-init.ts`.

**NextAuth core (platform-ui):** `src/auth.ts`, `src/types/next-auth.d.ts`,
`src/app/api/auth/[...nextauth]/route.ts`, `src/lib/email-allowlist.ts`,
`src/lib/session-cookie.ts`, `src/instrumentation-node.ts` +
`instrumentation.ts` (boot validations).

**Auth boundary (platform-ui):** `src/proxy.ts`, `src/lib/api-auth.ts`
(+`resolveSessionUid`), routes: `tickets`, `step-logs`, `agent-output-file`,
`agents/[id]/oauth/_shared/auth.ts` (+`requireCallerUid`),
`app/api/users/set-password/route.ts` (new).

**Client (platform-ui):** `contexts/auth-context.tsx`, `components/providers.tsx`
(SessionProvider), `hooks/use-viewer-identity.ts`, `lib/mediforce.ts`,
`lib/api-fetch.ts`, `app/login`, `app/change-password`, `app/test-login`,
command-palette (`provider.tsx`, `palette.tsx`, `types.ts`, `commands/new-ticket.tsx`),
`components/reports/run-report.tsx`, + ~16 `firebaseUser→user` consumer files.
**Deleted:** `lib/firebase.ts`, `lib/firebase-id-token.ts`.

**Invite reshape (platform-api + UI):** `services/invite-notification.ts` (port),
`services/platform-services.ts` (wiring), `handlers/users/invite-user.ts`,
`resend-invite.ts`, `contract/users.ts`, settings page invite dialog, + tests.

**E2E / seed / env / docs:** `e2e/auth-setup.ts`, `e2e/helpers/auth-session.ts`
(new), `emulator.ts`, `multi-namespace.ts`, 9 API journeys, `playwright.config.ts`,
`global-setup/teardown.ts`, `postgres-seed.ts` (fixed a latent `ON CONFLICT`
bug from the column rename), `scripts/migrate-firebase-auth-to-postgres/*`,
`.env.example` (x2), `README.md`, `GETTING-STARTED.md`, `docs/dev-quickref.md`,
`CHANGELOG.md`.

**New tests:** `session-store.test.ts`, `credentials-store.test.ts` (L2),
`email-allowlist.test.ts`, `session-cookie.test.ts` (L1). Migrated: `api-auth.test.ts`,
`proxy.test.ts`, tickets/oauth route tests, `mcp-oauth-integration`,
`workflows-by-image`, `task-detail-upload`, `step-editor`, `workspace-selection`,
`user-directory-parity`, `seed-user-roles` (dropped Firebase-impl references).

---

## §8 verification gate status
- `grep "from 'firebase/auth'"` across `packages/` → **0** ✅
- `firebase-admin/auth` in app code → **0** (deleted) ✅ (migration script exempt)
- `verifyIdToken` / `getIdTokenResult` / `getIdToken` in production src → **0** ✅
- Remaining `firebase` string hits are comments + the migration script.
