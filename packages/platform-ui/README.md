# @mediforce/platform-ui

Main web application for Mediforce — built with Next.js.

## Getting Started

```bash
# Install dependencies (from repo root)
pnpm install

# Start dev server on port 9003
pnpm dev
```

## Environment Variables

Copy `.env.example` to `.env.local` and fill in values.

| Variable | Required | Description |
|----------|----------|-------------|
| `AUTH_SECRET` | Yes | NextAuth session signing secret (`openssl rand -hex 32`) |
| `DATABASE_URL` | Yes | Postgres connection string — identity and all app data |
| `ENABLE_PASSWORD_AUTH` | No | Set to `true` to enable the email + password provider |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | No | Google OAuth provider credentials |
| `OPENROUTER_API_KEY` | Yes | OpenRouter API key for LLM calls |
| `PLATFORM_API_KEY` | Yes | Shared API key for cross-app server-to-server auth |
| `MOCK_AGENT` | No | Set to `true` to use mock agent plugins instead of real Claude CLI — returns fixture data instantly, useful for UI development and UAT |

## Dev Modes

```bash
# Standard dev server — port 9003, Postgres per .env.local
pnpm dev

# Mocked agents + seeded demo data — port 9007. No real keys, no Docker.
# Use this to click through the UI without any setup.
pnpm dev:mock

# Dev with mock agents against your normal local database
MOCK_AGENT=true pnpm dev
```

See `docs/running-workspace-locally.md` for the full step-by-step on exercising the workspace + Docker path locally.

## PR Preview Deployments

`vercel.json` configures automatic preview deployments via Vercel. Each pull request gets a temporary URL so reviewers can click through the UI without running the app locally. Preview deployments connect to the staging database.

## Testing

```bash
# Unit + integration (vitest) — runs from repo root
pnpm test:unit

# All E2E (L3 + L4, Playwright) — needs Postgres on DATABASE_URL.
# Playwright's globalSetup applies migrations; auth-setup seeds the user.
pnpm test:e2e
```

E2E variants (run from this directory):

```bash
pnpm test:e2e -- --project=api           # L3 only — API E2E, no browser
pnpm test:e2e -- --project=authenticated # L4 only — UI E2E
pnpm test:e2e:headed                     # with visible browser
pnpm test:e2e:ui                         # Playwright UI mode (interactive)
```
