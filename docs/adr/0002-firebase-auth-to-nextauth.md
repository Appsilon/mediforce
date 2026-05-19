# 0002 — Move authentication from Firebase Auth to NextAuth (Auth.js v5)

- **Status:** Proposed
- **Date:** 2026-05-19
- **Authors:** Marek Rogala (@marekrogala)
- **Reviewers:** Filip Stachura (@filipstachura), Paweł Przytuła (@przytu1)
- **Depends on:** [ADR-0001](./0001-firestore-to-postgres.md) (Postgres + Drizzle is the adapter target)
- **Implementation plan:** [PLAN-0002.md](./PLAN-0002.md)

## Context

Mediforce uses Firebase Auth for identity. Firebase Auth is a Google SaaS — it
cannot run on customer premises, which blocks the same pharma on-prem GTM that
motivates [ADR-0001](./0001-firestore-to-postgres.md). Pharma customers also
expect SSO via their corporate IdP (Microsoft Entra ID, Okta, Keycloak) and
Firebase Auth's OIDC integration is awkward — credentials still flow through
Google's identity layer.

Today's auth surface in Mediforce:

- Browser sign-in via `firebase/auth` SDK: Google OAuth popup + email/password.
- Server-side ID-token verification in `packages/platform-ui/src/middleware.ts`.
- Admin SDK `getAuth()` server-side for invites and user directory.
- **Custom claims** carry two distinct concepts: `role: 'admin'` (deployment
  superuser) and `roles: string[]` (process-domain functional roles).
- A flat `users/{uid}` Firestore doc holds `handle` (current Workspace),
  `mustChangePassword` and profile fields — no formal Zod schema.
- CLI / cron / scripts authenticate via a shared `PLATFORM_API_KEY` env. This
  path is **out of scope** for this ADR (Filip's work-in-progress on Personal
  Access Tokens covers it).

Domain terms — User, Workspace, Workspace member, **membership** (governance
level: `owner | admin | member`), **roles** (process-domain), deployment admin
— are defined in [`CONTEXT.md`](../../CONTEXT.md).

## Decision

Replace Firebase Auth with **NextAuth (Auth.js v5)**, backed by the Postgres
introduced in ADR-0001 via `@auth/drizzle-adapter`. Specifics:

1. **Library.** `next-auth@5` plus `@auth/drizzle-adapter`. Self-hosted, MIT,
   no SaaS in the path.

2. **Adapter target.** Drizzle, writing to the same Postgres database
   established by ADR-0001. New tables: `auth_users`, `auth_accounts`,
   `auth_sessions`, `auth_verification_tokens`. A Mediforce-side
   `user_profiles` table joins by `user_id` and owns domain fields
   (`current_workspace`, `deployment_admin`, `must_change_password`).
   This **split** (auth tables vs domain profile) is the standard NextAuth
   pattern and keeps schema changes from the upstream library separated from
   Mediforce concerns.

3. **Session strategy.** **Database sessions**, not JWT. Server-side
   revocation works in one HTTP round-trip; session create/destroy is a row
   we can audit; the per-request DB read is indexed (millisecond-scale) and
   negligible for our scale.

4. **Providers, env-gated and additive.** A single configuration ships
   four providers, each enabled by an env var:

   - **Google OAuth** (`GOOGLE_CLIENT_ID`) — parity with today's
     `signInWithPopup(googleProvider)`. The default for the current
     Mediforce user base.
   - **Credentials / email + password** (`ENABLE_PASSWORD_AUTH=true`) —
     real password auth (bcrypt-hashed in `auth_users`). Optional. Useful
     when Google/OIDC aren't available, plus for testing and self-hosted
     installs.
   - **Email magic link** (`SMTP_HOST` set) — passwordless via SendGrid
     (we already operate it in `platform-infra/src/email`). Staging / fallback.
   - **OIDC** (`OIDC_ISSUER` set) — pharma SSO to a customer's Keycloak /
     Entra / Okta / generic OIDC server. **One IdP per deployment**;
     mediforce is single-tenant per deployment so per-workspace IdPs are
     out of scope.

5. **Role / claim resolution.** Firebase custom claims map onto three
   different storage locations:

   - `customClaims.role === 'admin'` → `user_profiles.deployment_admin: boolean`
   - `customClaims.roles: string[]` → **per-workspace** `workspace_members.roles: text[]`
     (today these claims are global; the migration **copies them onto every
     workspace membership** the user holds, then admins can fine-tune
     separately).
   - Workspace governance (`owner | admin | member`) lives on
     `workspace_members.membership` (renamed from today's `members.role`
     to remove the naming collision with process-domain roles).

6. **Middleware.** `hasValidFirebaseToken()` in
   `packages/platform-ui/src/middleware.ts` is removed. Browser requests
   carry NextAuth's `authjs.session-token` httpOnly cookie; the middleware
   resolves the user via `await auth()`. `hasValidApiKey()` (the
   `PLATFORM_API_KEY` path for CLI / cron) **stays untouched** — out of
   scope of this ADR.

7. **Existing-user migration.** Google users migrate **seamlessly**: a
   Python script seeds them into `auth_users` keyed by email; the first
   NextAuth Google sign-in matches the pre-seeded row, links the account,
   and they're in. **Password users do not have their hashes migrated** —
   Firebase password hashes are not exportable in any form NextAuth can
   accept. Active production users are mostly Google; the few password
   accounts are internal/testing and re-enroll via the magic-link or
   password provider (whichever the deployment has enabled).

8. **Cutover.** **Sequential after ADR-0001**, not bundled. ADR-0001 lands
   first; mediforce runs on Postgres + Firebase Auth for a stable interval
   (hybrid is fine — Firebase Auth talks to Google, doesn't touch our DB).
   Then ADR-0002 runs its own planned-downtime cutover: deploy NextAuth
   code, run user migration script, flip `AUTH_BACKEND=nextauth`, restart,
   smoke-test. Rollback path: flip back to `AUTH_BACKEND=firebase`,
   investigate. Splitting cutovers isolates failure modes.

## Considered alternatives

- **Stay on Firebase Auth.** Rejected — blocks pharma on-prem, blocks SSO
  story.
- **Lucia.** Lighter, but loses NextAuth's mature provider library (Entra,
  Okta, generic OIDC are 10 lines of config each). Ecosystem smaller, more
  code we own.
- **Ory Kratos.** Separate Go service, separate DB, separate operations.
  Overkill for a single-app installation.
- **Clerk / WorkOS / Auth0 / Stytch.** SaaS — same on-prem block as
  Firebase. Rejected.
- **Keycloak run-our-own.** A separate Java service we'd operate. Some
  pharma customers run Keycloak themselves; we connect to *theirs* via the
  OIDC provider above rather than running ours.
- **NextAuth with JWT sessions.** Simpler operationally (no session
  table), but loses immediate server-side revocation. Pharma cares.
  Rejected.

## Consequences

- Pharma on-prem deployment unblocked on the auth side.
- One codebase / one configuration covers demo, staging, customer pharma
  deployments — different deployments enable different providers via env.
- Session revocation is immediate (deactivate a user → next request 401).
- Auth state lives in our Postgres — visible in our backups, audit log,
  monitoring.
- We own more auth surface than before: email verification, magic link
  flow, password policy (if enabled), account recovery. NextAuth handles
  the heavy lifting; we own the configuration.
- The currently-undocumented `users/{uid}` Firestore shape gets a real
  schema (`auth_users` + `user_profiles`).

## Enterprise / pharma fit

- **SSO via the customer's IdP** is config-only: `OIDC_ISSUER` /
  `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` set, callback URL registered with
  the IdP, done.
- **No SaaS in the auth path** when the customer uses OIDC against their
  IdP — credentials never leave their infrastructure.
- **Audit trail** — every session create/destroy is a row we control. Add
  per-event audit rows in callbacks (`signIn`, `signOut`) if the customer
  asks.
- **21 CFR Part 11**: access control is auditable, sessions are revocable,
  user lifecycle is transparent.
- **Demo simplicity** — a `docker-compose up`, click "Sign in with Google"
  (or pre-seed a password user) and you're in. No external Firebase
  project required.

## Out of scope

- **CLI / API key auth** (`PLATFORM_API_KEY` + Personal Access Tokens) —
  Filip's separate WIP.
- **2FA / TOTP / WebAuthn passkeys** — future ADR. NextAuth v5 has no
  built-in 2FA; we'd add `@simplewebauthn` for passkeys and/or
  `otplib` for TOTP. Trigger: first pharma customer asks.
- **SCIM** — automatic user provisioning from customer IdP. Future ADR
  when a customer with >100 users asks.
- **Federated logout / single sign-out** — supported by NextAuth for OIDC
  but needs wiring. Future ADR.
- **Firebase Auth password hash migration** — explicitly deferred. Active
  password users re-enroll via magic link or the (optional) Credentials
  provider.

## Open questions for review

- Single OIDC config per deployment vs per workspace — recommended single
  per deployment given Mediforce's single-tenant model. Confirm.
- Real password provider toggle (`ENABLE_PASSWORD_AUTH=true`) — confirm
  this stays a supported option, not "demo only".
- Session strategy `database` vs `jwt` — confirm `database` for revocation
  and audit.
- Cutover sequencing — confirm ADR-0001 lands first, then ADR-0002, not
  bundled.
