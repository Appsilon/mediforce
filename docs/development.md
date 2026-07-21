# Development Guide

## Prerequisites

- **Node.js** 20+
- **pnpm** 10+ (`corepack enable && corepack prepare pnpm@latest --activate`)
- **Docker** (local Postgres + agent containers)

## Setup

```bash
git clone https://github.com/Appsilon/mediforce.git
cd mediforce
pnpm install
```

### Environment variables

```bash
cp packages/platform-ui/.env.example packages/platform-ui/.env.local
```

Authentication is NextAuth / Auth.js v5 with Postgres-backed database sessions
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

The full annotated list lives in `packages/platform-ui/.env.example`.

## Monorepo structure

```
packages/
  platform-core/       # Shared types, domain models, test factories
  platform-ui/         # Next.js UI — the main web application
  platform-infra/      # Postgres infrastructure (Drizzle ORM) + NextAuth stores
  platform-api/        # API contract schemas + pure handlers (framework-free)
  agent-runtime/       # Agent execution engine
  workflow-engine/     # Process orchestration engine
  example-agent/       # Reference agent implementation
```

## Local Postgres dev

All server data lives in a local Postgres (ADR-0001) — there is no Firestore
data layer. `pnpm dev` starts the container, runs migrations, and boots the UI
against it. Quick recipes:

```bash
# Reset local data (wipes the persistent volume, re-migrates)
docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v && pnpm dev

# Add a migration: edit a schema file under
#   packages/platform-infra/src/postgres/schema/
pnpm db:generate    # emit NNNN_*.sql + journal entry
pnpm db:migrate     # apply locally (pnpm dev auto-runs this)

# Run repo tests against a real Postgres
TEST_DATABASE_URL=postgresql://mediforce:mediforce@localhost:5432/mediforce \
  pnpm --filter @mediforce/platform-infra exec vitest run src/postgres
```

Deep dive (inspecting migration state, branch-collision renames, connection
pool, troubleshooting): [postgres-local-dev.md](postgres-local-dev.md).

## Local agent execution

When running with `ALLOW_LOCAL_AGENTS=true` (via `pnpm dev:no-docker`), the platform spawns agent CLIs directly as local processes instead of Docker containers. This mode is docker-free but **still requires Postgres on `:5432`** (`DATABASE_URL` is required at boot) — it does not start the container itself, so run `pnpm dev` once first or point `DATABASE_URL` at your own DB. The following tools must be installed and on your `PATH`:

| Tool | Used by | Install |
|------|---------|---------|
| `claude` | `ClaudeCodeAgent` workflow steps | [Claude Code docs](https://docs.anthropic.com/en/docs/claude-code) — `npm install -g @anthropic-ai/claude-code` |
| `opencode` | `OpenCodeAgent` workflow steps | `npm install -g opencode-ai` |

Verify both are available after installing:

```bash
claude --version
opencode --version
```

Without `ALLOW_LOCAL_AGENTS=true`, agents run inside Docker containers instead. In that case you need **Docker** installed and running, but not the CLIs above.

## Running the app

```bash
# Platform UI (default, port 9003)
cd packages/platform-ui && pnpm dev
```

## Testing

### Unit & integration tests

```bash
# Unit + integration (vitest)
pnpm test:unit

# Only tests affected by your changes
pnpm test:affected

# With coverage
pnpm test:coverage

# Type checking
pnpm typecheck

# Everything (unit + e2e)
pnpm test
```

### Contract tests

Handlers in `platform-api` are tested against in-memory repositories from `@mediforce/platform-core/testing` — no mocks, no HTTP, no database, no dev server. The real win over E2E is not raw wall-clock time but zero ceremony: run the file, get the answer. Each handler is a pure function `(input, deps) => Promise<output>` with per-handler dependency injection, so tests read like the spec: set up repo state, call handler, assert on the return value. The canonical example is `packages/platform-api/src/handlers/tasks/__tests__/list-tasks.test.ts`, which exercises the `listTasks` handler backing `GET /api/tasks`.

### E2E tests (Playwright)

E2E tests live in `packages/platform-ui/e2e/`.

A local Postgres must be up (`pnpm dev` once, or your own DB on `:5432`).
No emulator is involved — Playwright's `globalSetup` applies the Drizzle
migrations and starts the mock OAuth server itself.

```bash
pnpm test:e2e               # all E2E (L3 + L4)
pnpm test:e2e:api           # L3 only — API E2E, no browser (~30s)
pnpm test:e2e:ui            # L4 only — UI E2E with real Chromium (~3min)
```

Variants run from `packages/platform-ui`:

```bash
pnpm test:e2e:headed        # with browser visible
pnpm test:e2e:ui            # interactive Playwright UI mode
```

`e2e/auth-setup.ts` automatically:
1. Seeds Postgres with test data (workspaces, workflow definitions, tasks, process instances, agent runs, audit events)
2. Upserts the test user's `auth_users` row and opens a NextAuth database session for it (`e2e/helpers/auth-session.ts`)
3. Writes that session token as the `authjs.session-token` cookie into Playwright `storageState`, authenticating every downstream journey

**Test structure:**
- `e2e/smoke.spec.ts` — unauthenticated tests
- `e2e/api/*.journey.ts` — L3 API E2E
- `e2e/ui/*.journey.ts` — L4 UI E2E
- `e2e/helpers/` — Postgres seed + NextAuth session helpers

### Recommended workflow

1. `pnpm typecheck` — catches type errors (~5s)
2. `pnpm test:affected` — tests for changed files only (<1s)
3. `pnpm test:unit` — full L1+L2 (~9s)
4. `pnpm test:e2e` — if UI/API contract changed (~4min)

## Build

```bash
pnpm build    # builds all packages
```

## Deployment

Staging and production servers are hosted on **Hetzner**.

| Environment | SSH access |
|-------------|-----------|
| Staging | `ssh deploy@204.168.165.57` |

The staging machine also has an `sftpuser` account with SFTP enabled, used for the Data Landing Zone workflow demo.

All credentials (SSH passwords, etc.) are stored in **1Password** under the **Mediforce** vault.
