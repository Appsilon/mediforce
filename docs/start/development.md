---
status: living
audience: engineers
last_reviewed: 2026-08-19
---

# Development Guide

Local dev conventions, branch policy, deployment and auth setup.
Install and first run: [GETTING-STARTED.md](../../GETTING-STARTED.md).
Command lookup: [dev-quickref.md](dev-quickref.md).
Package graph: [architecture.md](../concepts/architecture.md).

## Environment variables

Local dev only — what a *deployed* server needs is
[below](#environment-variables-per-deployment).

```bash
cp packages/platform-ui/.env.example packages/platform-ui/.env.local
```

Auth is NextAuth / Auth.js v5 with Postgres-backed database sessions
(ADR-0002) — there is no Firebase project to configure.

| Variable | Description |
|----------|-------------|
| `AUTH_SECRET` | NextAuth session signing secret (`openssl rand -hex 32`) |
| `ENABLE_PASSWORD_AUTH` | `true` enables the email + password (Credentials) provider — simplest local path |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign-in provider (optional) |
| `ALLOWED_EMAIL_DOMAINS` | Comma-separated email-domain allowlist (optional) |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | Customer SSO, dormant until `OIDC_ISSUER` is set |
| `OPENROUTER_API_KEY` | OpenRouter API key (for agent LLM calls) |
| `PLATFORM_API_KEY` | Platform API key (server-to-server `X-Api-Key`) |

The full annotated list lives in `packages/platform-ui/.env.example`; the
boot-time authority on what is mandatory is
`packages/platform-ui/src/instrumentation-node.ts`.

## Local agent execution

With `ALLOW_LOCAL_AGENTS=true` (what `pnpm dev:no-docker` sets), agent CLIs are
spawned as host processes instead of Docker containers. Docker-free, but it
**still needs Postgres on `:5432`** and does not start it — run `pnpm dev` once
first, or point `DATABASE_URL` at your own DB.

| Tool | Used by | Install |
|------|---------|---------|
| `claude` | `ClaudeCodeAgent` steps | `npm install -g @anthropic-ai/claude-code` |
| `opencode` | `OpenCodeAgent` steps | `npm install -g opencode-ai` |

Both must be on `PATH` — verify with `claude --version` / `opencode --version`.
Without the flag, agents run in Docker and neither CLI is needed.

## Testing

Commands and levels: [dev-quickref.md](dev-quickref.md#test-levels). Level
definitions and the rules behind them:
[e2e-strategy.md](../testing/e2e-strategy.md).

### Contract tests

Handlers in `platform-api` are pure functions `(input, deps) => Promise<output>`
with per-handler dependency injection, tested against the in-memory repositories
from `@mediforce/platform-core/testing` — no mocks, no HTTP, no database, no dev
server. The win is zero ceremony: set up repo state, call the handler, assert on
the return value. Canonical example:
`packages/platform-api/src/handlers/tasks/__tests__/list-tasks.test.ts`.

### E2E tests (Playwright)

E2E tests live in `packages/platform-ui/e2e/`. A local Postgres must be up
(`pnpm dev` once, or your own DB on `:5432`); `globalSetup` applies the Drizzle
migrations and starts the mock OAuth server itself.

- `e2e/smoke.spec.ts` — unauthenticated
- `e2e/api/*.journey.ts` — L3 API E2E
- `e2e/ui/*.journey.ts` — L4 UI E2E
- `e2e/helpers/` — Postgres seed + NextAuth session helpers

`e2e/auth-setup.ts` seeds the Postgres fixture, upserts the test user's
`auth_users` row, opens a NextAuth database session for it, and writes that
session token as the `authjs.session-token` cookie into Playwright
`storageState` — the cookie alone authenticates every downstream journey.

Interactive variants run from `packages/platform-ui`:

```bash
pnpm test:e2e:headed        # browser visible
pnpm test:e2e:ui            # Playwright UI mode (from the repo root this
                            # name means "L4 only" instead — different script)
```

## Branches

Two branches are permanent: `main` (default, deploys to staging via
`deploy-staging.yml`) and `production` (live deploy target — `deploy-production.yml`
triggers on every push to it). Everything else on `origin` is temporary.

Work branches are named `<type>/<slug>`, e.g. `feat/cron-trigger-management`,
`fix/1158-agent-time-budget-overhead`. Bots own their own prefixes: `renovate/*`
(Renovate recreates and drops these itself) and `changelog/cut-<sunday>` (one per
weekly run of `changelog-cut.yml`, disposable once its PR merges).

**Retention rule:**

| Branch | Kept |
|--------|------|
| `main`, `production` | Always |
| Open PR | Until the PR closes |
| Merged PR | Deleted on merge — by GitHub's *Automatically delete head branches* repo setting, which must stay enabled |
| Closed (unmerged) PR, or no PR, and no commit for 60 days | Deleted in the periodic sweep |

Deleting a branch never destroys review history: a PR keeps its commits under
`refs/pull/<number>/head`, so `git fetch origin pull/<number>/head` restores the
work regardless. For a branch that never had a PR, restore from its SHA with
`git push origin <sha>:refs/heads/<name>` while the object is still reachable.

The sweep is manual and rare — the delete-on-merge setting is what keeps the
list short. Re-run it by listing branches with no open PR and no commit in 60
days, and confirming the list before deleting.

## Deployment

Staging and production servers are hosted on **Hetzner**. Staging:
`ssh deploy@204.168.165.57`. That machine also has an `sftpuser` account with
SFTP enabled, used for the Data Landing Zone workflow demo. All credentials live
in **1Password**, vault **Mediforce**.

Standing up a *new* server is driven by
[`scripts/bootstrap-server.py`](../../scripts/bootstrap-server.py) (or the
browser wizard at [`docs/setup/index.html`](../setup/index.html)), which collects
every required env var — including `AUTH_SECRET`, a provider, and
`ALLOWED_EMAIL_DOMAINS` — and prints the exact Google OAuth redirect URI to
register. The server refuses to start if anything is missing.

### Postgres in production (ADR-0001)

`docker-compose.prod.yml` runs `postgres:16-alpine` alongside Redis and applies
Drizzle migrations from a short-lived `migrate` init container that `platform-ui`
waits on (`depends_on: { migrate: { condition: service_completed_successfully } }`).
Migrations are idempotent (drizzle's `__drizzle_migrations` ledger), so the deploy
pipeline needs no separate migration step.

The host needs two things before `platform-ui` will start:

1. `POSTGRES_PASSWORD` in `/opt/mediforce/.env` — no default. `POSTGRES_USER` and
   `POSTGRES_DB` default to `mediforce`.
2. `/var/lib/mediforce/postgres-data`, owned by UID 999 (the postgres-alpine
   user). `docker-compose.staging.yml` bind-mounts that path so
   `docker compose down -v` cannot wipe data — only an explicit `rm -rf` removes
   it. Local dev keeps a named volume, where `down -v` stays a normal reset.

`bootstrap-server.py` does both on a fresh host (`step_env_local` +
`step_postgres_dir`: auto-generated password, correct directory ownership).
Already-bootstrapped deployments — the current staging — are never re-bootstrapped:
add the variable and create the directory over ssh.

### Environment variables per deployment

[`.env.example`](../../.env.example) is the annotated source of truth for every
variable. Below is what to actually set per environment; anything not listed has
a safe default.

**Required (every deployment):**

| Var | Notes |
| --- | --- |
| `POSTGRES_PASSWORD` | No default. `POSTGRES_USER` / `POSTGRES_DB` default to `mediforce`. |
| `AUTH_SECRET` | Session signing. `openssl rand -hex 32`. |
| `NEXT_PUBLIC_APP_URL` | Public origin of this deployment (e.g. `https://app.example.com`). `APP_BASE_URL` **auto-derives from it** in compose — set only this one. |
| `ALLOWED_EMAIL_DOMAINS` | Comma-separated domain allowlist. Mandatory with any OAuth/OIDC provider on (boot-fails if empty) — otherwise any account at the IdP could sign in. |

**Auth providers — enable at least one:**

| Var | Default | Notes |
| --- | --- | --- |
| `ENABLE_PASSWORD_AUTH` | **on** | Email + password sign-in. Set `false` only for a Google/OIDC-only estate (also hides the invite "resend setup link" recovery form). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | off | "Sign in with Google". |
| `ENABLE_MAGIC_LINK` | off | Passwordless sign-in; needs email configured. Second first-password / recovery path. |
| `OIDC_ISSUER` (+ client id/secret) | off | Customer SSO, one IdP per deployment. |

**Email — required to send invites / magic-links** (choose one provider; the
`*_FROM_EMAIL` must be on a **verified** sender domain or mail bounces / spams):

- Mailgun: `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM_EMAIL` (+ optional `MAILGUN_SENDER_NAME`).
- SMTP: `SMTP_HOST`, `SMTP_FROM_EMAIL` (+ `SMTP_USER` / `SMTP_PASS` / `SMTP_PORT` / `SMTP_SECURE`).
- Or `MEDIFORCE_DISABLE_EMAIL=true` to run without email (no invites / magic-links).

In **production**, boot fails if email is enabled but `NEXT_PUBLIC_APP_URL` /
`APP_BASE_URL` is unset or `localhost` — otherwise activation / magic-link emails
would ship a dead `http://localhost` link.

> **Inviting users to set a first password requires `ENABLE_PASSWORD_AUTH` (on by
> default) and a configured email provider.** Existing Google users just sign in
> with Google after their account is seeded — no invite, no password.

### Authentication setup (ADR-0002)

Auth is NextAuth over Postgres — no Firebase project, service account, or
emulator to provision. Every install is greenfield: nothing to export or migrate.

Create the first user directly — an `auth_users` row with a bcrypt
`password_hash` (see `ENABLE_PASSWORD_AUTH` in
`packages/platform-ui/.env.example`) — or configure OIDC against the customer's
IdP and let them sign in. `user_roles` starts empty and **stays empty**: nothing
in the product writes to it today (see
[ADR-0019](../adr/0019-workspace-scoped-roles.md) Context), so process-domain
roles are not yet something an operator can grant.

Passwords are per-install: there is no password recovery flow yet
([issue #1001](https://github.com/Appsilon/mediforce/issues/1001)), so an install
offering only password auth needs an operator who can write a fresh hash.

> **Historical.** The one-time seed that copied identities out of Firebase Auth,
> keeping each user's uid so their workspaces, tasks and audit trail stayed
> attached, ran during the staging cutover and is done. Kept for the record at
> [`scripts/migrate-firebase-auth-to-postgres/README.md`](../../scripts/migrate-firebase-auth-to-postgres/README.md)
> and [`docs/archive/RUNBOOK-0002-staging-cutover.md`](../archive/RUNBOOK-0002-staging-cutover.md).
> Do not run it against a new deployment.
