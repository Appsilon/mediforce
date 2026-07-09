# 0002 — Move authentication from Firebase Auth to NextAuth (Auth.js v5)

- **Status:** Proposed (grilled & reshaped 2026-06-29; supersedes the
  2026-06-16 greenfield-uuid + remap draft — see §7)
- **Date:** 2026-05-19 (reshaped 2026-06-16, 2026-06-29)
- **Authors:** Marek Rogala (@marekrogala)
- **Reviewers:** Filip Stachura (@filipstachura), Paweł Przytuła (@przytu1)
- **Depends on:** [ADR-0001](./0001-firestore-to-postgres.md) (Postgres + Drizzle is the adapter target)
- **Coordinates with:** [ADR-0004](./0004-scoped-data-access-authorization.md) (the `CallerIdentity` this ADR resolves feeds the caller-set repository base from ADR-0004 — the carrier change is orthogonal to that shape, as [ADR-0005](./0005-headless-platform-api-ui-separation.md) already noted) and the headless Phase 1–4 auth boundary (`proxy.ts` + `lib/api-auth.ts`). The browser `Mediforce` client / `apiFetch` **stop attaching an `Authorization` header for same-origin `/api/*` calls** — the NextAuth httpOnly session cookie rides automatically (see §6). Tracked in [`docs/headless-migration.md`](../headless-migration.md).
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
- **Two-stage server-side ID-token verification** (the headless Phase 1–4
  boundary — there is no `middleware.ts`):
  1. `packages/platform-ui/src/proxy.ts` (`matcher: '/api/:path*'`) — coarse
     gate accepting **either** `X-Api-Key` (`hasValidApiKey`, server-to-server)
     **or** `Authorization: Bearer <Firebase ID token>`
     (`hasValidFirebaseToken`, verified via `jose` + Firebase JWKS). Proves the
     caller is authenticated, not what they may touch.
  2. `packages/platform-ui/src/lib/api-auth.ts` (`resolveCallerIdentity`) —
     per-route, re-verifies the Bearer via Admin SDK `verifyIdToken`, then
     loads workspace memberships from Postgres into `CallerIdentity`.
- The browser is today **just another Bearer client**: `lib/firebase-id-token.ts`
  → `lib/mediforce.ts` / `lib/api-fetch.ts` attach `auth.currentUser.getIdToken()`.
  This Bearer-in-browser shape is a Firebase-SDK artifact (client-first token
  minting), not a deliberate architectural goal; this ADR returns the browser
  to the standard same-origin cookie model (§6).
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

4. **Providers, env-gated and additive (MVP scope set 2026-06-16).** A single
   configuration ships providers, each enabled by an env var. The MVP ships
   **three**; magic-link is deferred:

   - **Google OAuth** (`GOOGLE_CLIENT_ID`) — parity with today's
     `signInWithPopup(googleProvider)`. The default for the current
     Mediforce user base.
   - **Credentials / email + password** (`ENABLE_PASSWORD_AUTH=true`) —
     real password auth (bcrypt-hashed in `auth_users`). A first-class,
     production-supported option (not demo-only) — it is also load-bearing
     for local dev, E2E, and air-gapped demos, replacing today's Firebase
     Auth emulator password users. **Heavy password policy** (complexity,
     rotation, lockout, history) is **deferred to a future ADR** — built
     when a real password-in-production deployment needs 21 CFR-grade
     controls. The MVP provider is honest, not crippled, but minimal.
   - **OIDC** (`OIDC_ISSUER` set) — pharma SSO to a customer's Keycloak /
     Entra / Okta / generic OIDC server. **One IdP per deployment**;
     mediforce is single-tenant per deployment so per-workspace IdPs are
     out of scope. **Included now but dormant**: it is ~15 lines of
     env-gated config that ship even with no IdP wired. Real per-customer
     integration (client registration, callback URL, claim mapping,
     end-to-end test against the customer's IdP) happens when a customer
     lands; the MVP at most carries one smoke test against a local Keycloak.
     Shipped now because it *is* the on-prem SSO GTM story and costs almost
     nothing dormant.
   - **Email magic link** — **deferred** (was a fourth provider in the
     draft). Needs SMTP wiring + the verification-token flow, which nobody
     needs today. Add when a deployment without Google/OIDC/password asks.

4a. **Email-domain allowlist (decision 2026-06-16).** A deployment-level
   `ALLOWED_EMAIL_DOMAINS` env (comma-separated, e.g. `appsilon.com`) is
   enforced in the NextAuth `signIn` callback across **all** providers: a
   sign-in whose `user.email` domain is not in the list is rejected; an unset
   value means no restriction. This is **not** optional polish — with Google
   enabled, *any* Google account on earth could otherwise sign in, so the
   allowlist is what closes that open door (staging restricts to
   `appsilon.com`; a customer deployment restricts to its domain, or relies on
   its OIDC IdP). It is a deployment-operator security policy (env var,
   boot-validated in `instrumentation.ts`, enforced in the same `signIn`
   callback as the personal-workspace bootstrap), never a per-workspace
   in-app setting.

4b. **Account linking by verified email (decision 2026-06-29).** A Google
   sign-in whose email matches an existing `auth_users` row (a migration-seeded
   user, §7) **links automatically** onto that user — `allowDangerousEmailAccountLinking:
   true` set **on the Google provider only**. This is safe precisely because
   Google emails are verified and `ALLOWED_EMAIL_DOMAINS` (§4a) already gates
   the domain; it is what makes the seamless re-login work without a remap.
   **Never** enable it for an unverified-email provider (the "dangerous" case —
   account takeover). Today's explicit `pendingGoogleLink` password-link dance
   (sign in with password to attach a same-email Google account) is **dropped** —
   verified-email auto-link replaces it, and passwords are test-only anyway.

5. **Role / claim resolution.** Firebase custom claims map onto three
   different storage locations:

   - `customClaims.role === 'admin'` → `user_profiles.deployment_admin: boolean`
   - `customClaims.roles: string[]` → a **global** `user_roles(uid, role)` table
     (one indexed row per (user, role)). **These claims are global today and
     `getUsersByRole(role)` is called with no namespace context**
     (`workflow-engine.ts` escalation-notification targeting resolves a role to
     users across the whole deployment). A global table is the faithful port —
     the PG `UserDirectoryService` reads it with the same global semantics.
     _(Decision 2026-06-29: rejected the earlier draft's per-workspace
     `workspace_members.roles[]` — scoping role→user resolution to a workspace
     would silently change notification targeting, a **regression** dressed as
     a migration. Per-workspace functional roles can return later as a real
     product decision if asked.)_
   - Workspace governance (`owner | admin | member`) lives on
     `workspace_members.membership` (renamed from today's `members.role`
     to remove the naming collision with process-domain roles).

6. **Auth boundary — cookie for the browser, key/token for machines.**
   The carrier splits cleanly by client kind, which is the industry-standard
   shape for a same-origin Next.js app whose `/api/*` routes are also consumed
   by non-browser clients (browser → cookie session; CLI / agents / MCP →
   API key or PAT). Concretely:

   - `hasValidFirebaseToken()` in `proxy.ts` is **replaced** by a NextAuth
     session-cookie check (`auth()` / session-token lookup). The browser
     carries NextAuth's `authjs.session-token` httpOnly cookie; no
     `Authorization` header on same-origin `/api/*` calls.
   - `hasValidApiKey()` in `proxy.ts` (the `PLATFORM_API_KEY` path, and the
     per-user PATs from #376) **stays untouched** — out of scope of this ADR.
   - `lib/api-auth.ts` `resolveCallerIdentity` resolves `uid` from the
     NextAuth session instead of `verifyIdToken(Bearer)`; the
     membership-load-into-`CallerIdentity` tail is unchanged.
   - `lib/firebase-id-token.ts`, and the `Authorization`-attaching paths in
     `lib/mediforce.ts` / `lib/api-fetch.ts`, are deleted — the same-origin
     cookie rides automatically.

   **Same-origin assumption (decision 2026-06-16).** The target post-Firebase
   deployment is a single self-hosted Next.js server (one origin for UI + API);
   cookie sessions are the natural fit. The current `proxy.ts` CORS allowlist
   + `*.hosted.app` pattern is a Firebase Hosting artifact that retires with
   the Firebase exit. If a real cross-origin front (separate mobile / partner
   SPA) ever lands, reconcile then via a same-site reverse proxy (preferred)
   or `SameSite=None; Secure` cookies + a strict CORS allowlist — not by
   reverting the browser to Bearer.

7. **Existing-user migration — keep the uid, no remap (decision 2026-06-29).**
   The Firebase uid is already the **canonical, opaque user id** stored as
   `text` across the whole schema (`user_profiles.uid` PK, `workspace_members.uid`
   PK, `workspaces.linked_user_id`, `{human_tasks,cowork_sessions,handoff}.assigned_user_id`,
   `process_instances.created_by`, `audit_events` actor, `task_attachments.uploaded_by`).
   Nothing parses a user id as a `uuid`. So `auth_users.id` **is the existing
   Firebase uid** (the `@auth/drizzle-adapter` schema must declare `id` as
   `text`, **not** `uuid` — the only impl constraint), and **every reference
   stays valid with zero data rewrite**:

   - **Structural changes ship as Drizzle migrations** (create `auth_*` +
     `user_profiles` reshape; `workspace_members` rename `role` → `membership`;
     create the global `user_roles` table). The uid columns are **not** touched.
   - **Migration = a tiny one-time seed**, not a remap: a script reads Firebase
     Auth (`listUsers`) and inserts one `auth_users` row per existing user
     (`id = uid`, `email`, `name`) so a Google sign-in **links by verified
     email** (§4b) onto the pre-existing uid. It also seeds `user_roles` from
     today's `customClaims.roles` and `user_profiles.deployment_admin` from
     `customClaims.role === 'admin'`. No uid columns rewritten, no mapping
     table, no `audit_events`/`human_tasks`/… churn.
   - New users created after cutover get an adapter-generated `uuid` id —
     mixed id shapes (Firebase strings + uuids) are harmless: both are opaque
     `text`, no consumer cares.
   - Passwords are not migrated (Firebase scrypt is proprietary; passwords are
     test-only today). Email/password users reset if they want one — **not
     forced** (§ password ceremony).

   _(Decision 2026-06-29, after grilling: **supersedes** the 2026-06-16
   greenfield-uuid + remap-script plan. Keeping the uid was judged the
   simpler-correct move — the uuid was cosmetic and the remap rewrote ~8
   columns for no functional gain. This also **supersedes the "remap
   uploaded_by to fresh uuids" line in [ADR-0003](./0003-remove-firebase-storage.md)
   §5** — `uploaded_by` simply stays the Firebase-uid `text` it already is.)_

8. **Cutover — two PRs, no dual-run (decision 2026-06-29).** Auth is atomic —
   you cannot half-authenticate — so there is no dual-backend window, no
   `AUTH_BACKEND` flag, no parallel Firebase/NextAuth CI matrix, no
   rollback-to-Firebase scaffolding. With no production to protect (§7) the
   only cost of a bad cutover is "log in again," and the e2e auth-setup (now on
   NextAuth) exercises the whole login→session→API flow in CI before deploy;
   rollback is a redeploy. The work splits at a natural seam:

   - **PR1 — user-management off Firebase-admin (additive, non-breaking).** The
     global `user_roles` table + PG `UserDirectoryService` + PG invite impl,
     behind the existing ports; one-time seed of `user_roles` from current
     Firebase claims so `getUsersByRole` notifications keep working. Firebase
     stays the auth source. De-risks PR2 by pulling role/directory complexity
     out of the cutover.
   - **PR2 — NextAuth atomic cutover.** `auth_*` tables + `user_profiles`
     reshape + Google/Credentials providers + text-id drizzle adapter +
     `resolveCallerIdentity`→cookie + client rewrite + login page + the §7
     user seed on staging + e2e auth-setup → NextAuth + delete Firebase Auth /
     firebase-admin / emulator. Gate: `grep firebase/auth → 0`.

   A dual-run window (`resolveCallerIdentity` accepting both a Firebase Bearer
   and a NextAuth cookie at once) was **considered and rejected**: ADR-0003's
   migrate-before-flip protected data that would *vanish*; auth has no
   equivalent data-loss risk, so the dual-path scaffolding (plus a teardown PR,
   plus a wider security surface) buys nothing here.

   **Lands after ADR-0003** (storage) so client-direct uploads do not break
   when the Firebase Auth session disappears — see ADR-0003 §5.

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

(None blocking. All review questions resolved in the 2026-06-16 grilling —
see below.)

### Resolved during the 2026-06-16 grilling

- **OIDC scope.** Resolved: one IdP **per deployment** (single-tenant model),
  and **included now but dormant** (env-gated, real integration per-customer
  later). See §4.
- **Password provider.** Resolved: **production-supported, not demo-only**,
  env-gated; also the dev/E2E/demo auth path. Heavy 21 CFR password policy
  deferred to a future ADR. See §4.
- **Session strategy.** Resolved: **`database`** (immediate revocation +
  audit; near-free given the Drizzle adapter is present for account linking
  anyway). See §3.
- **Email-domain allowlist.** Added: `ALLOWED_EMAIL_DOMAINS` enforced in the
  `signIn` callback — mandatory in spirit once Google is on. See §4a.
- **Magic-link provider.** Deferred (SMTP + verification-token flow; nobody
  needs it today). See §4.

- **Auth carrier (browser → API).** Resolved: cookie-native, same-origin
  (decision §6). The browser uses the NextAuth httpOnly session cookie;
  machines keep `X-Api-Key` / PAT. Reconciled with the headless `proxy.ts`
  + `api-auth.ts` boundary that did not exist when this ADR was drafted.
- **Cutover sequencing.** Moot: ADR-0001 already landed (Postgres cutover
  completed 2026-05-31, PR #534). Mediforce now runs on Postgres + Firebase
  Auth — exactly the stable hybrid this ADR's §8 assumed. ADR-0002 is the
  next cutover; no bundling question remains.
