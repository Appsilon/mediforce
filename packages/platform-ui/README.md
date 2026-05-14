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
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Yes | Firebase API key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Yes | Firebase auth domain |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Yes | Firebase project ID |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | No | Firebase storage bucket |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | No | Firebase messaging sender ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | No | Firebase app ID |
| `OPENROUTER_API_KEY` | Yes | OpenRouter API key for LLM calls |
| `PLATFORM_API_KEY` | Yes | Shared API key for cross-app server-to-server auth |
| `NEXT_PUBLIC_USE_EMULATORS` | No | Set to `true` to use Firebase emulators |
| `MOCK_AGENT` | No | Set to `true` to use mock agent plugins instead of real Claude CLI — returns fixture data instantly, useful for UI development and UAT |

## Dev Modes

```bash
# Standard dev server — port 9003, production/staging Firebase per .env.local
pnpm dev

# Mocked agents + in-memory data — port 9007. No Firebase, no keys, no Docker.
# Use this to click through the UI without any setup.
pnpm dev:mock

# Dev with mock agents but against production/staging Firebase
MOCK_AGENT=true pnpm dev
```

See `docs/running-workspace-locally.md` for the full step-by-step on exercising the workspace + Docker path locally.

## PR Preview Deployments

`vercel.json` configures automatic preview deployments via Vercel. Each pull request gets a temporary URL so reviewers can click through the UI without running the app locally. Preview deployments connect to the staging Firebase project.

## Testing

```bash
# Unit + integration (vitest) — runs from repo root
pnpm test:unit

# All E2E (L3 + L4, Playwright) — needs Firebase emulators
pnpm emulators        # terminal 1
pnpm test:e2e         # terminal 2
```

E2E variants (run from this directory):

```bash
pnpm test:e2e -- --project=api           # L3 only — API E2E, no browser
pnpm test:e2e -- --project=authenticated # L4 only — UI E2E
pnpm test:e2e:headed                     # with visible browser
pnpm test:e2e:ui-mode                    # Playwright UI mode (interactive)
pnpm test:e2e:record                     # record videos for GIFs
```
