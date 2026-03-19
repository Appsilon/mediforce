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

Copy `.env.local.example` to `.env.local` and fill in values.

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
# Standard dev server
pnpm dev

# Dev with Firebase emulators (requires emulators running)
pnpm dev:test

# Dev with mock agents (no Claude CLI needed, instant fixture responses)
MOCK_AGENT=true pnpm dev
```

## PR Preview Deployments

`vercel.json` configures automatic preview deployments via Vercel. Each pull request gets a temporary URL so reviewers can click through the UI without running the app locally. Preview deployments connect to the staging Firebase project.

## Testing

```bash
# Unit tests
pnpm test:run

# E2E smoke tests (no emulators)
pnpm test:e2e

# E2E with auth (requires Firebase emulators)
pnpm emulators        # terminal 1
pnpm test:e2e:auth    # terminal 2
```
