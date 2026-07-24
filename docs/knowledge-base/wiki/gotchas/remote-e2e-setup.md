---
type: gotcha
created: 2026-04-23
updated: 2026-07-21
sources: 2
tags: [gotcha, e2e, playwright, nextauth, postgres, remote]
---

**Remote environments (Claude Code web, CI, fresh machines) need manual E2E prep: a reachable Postgres, `AUTH_SECRET`, and the Playwright chromium binary.**

## Symptom

- E2E setup fails with `DATABASE_URL must be set to seed auth users for E2E`.
- Every authenticated journey redirects to `/login`.
- Playwright fails with "chromium executable not found".

## Cause

Local dev boxes already have `.env.local`, a running Postgres, and Playwright
browsers installed. Remote agent environments don't. Google Fonts may also fail
to download — Next.js falls back to system fonts, tests still work.

No Firebase emulator is involved (ADR-0002): auth is NextAuth with database
sessions in Postgres, and `e2e/auth-setup.ts` seeds the session cookie
directly.

## Fix / workaround

| What | Why |
|------|-----|
| Postgres up + `DATABASE_URL` exported | `auth-setup.ts` and the E2E server must share one database. `pnpm dev` once brings up the dev container. |
| `AUTH_SECRET` in the environment | Without it NextAuth cannot sign/validate the session — `playwright.config.ts` supplies a fixed test-only fallback. |
| `npx playwright install --with-deps chromium` | Binary must match `@playwright/test` version. |
| `fuser -k 9007/tcp` | Kill a stale E2E server. |

Playwright's `globalSetup` applies the Drizzle migrations and starts the mock
OAuth server itself, so no separate migration step is needed.

```bash
pnpm test:e2e
```

## How to avoid next time

Bring up Postgres and export `DATABASE_URL` as the first step in any fresh
environment, before touching E2E.

## Sources

- `packages/platform-ui/playwright.config.ts`
- `packages/platform-ui/e2e/auth-setup.ts`, `e2e/helpers/auth-session.ts`
