# Development Guide

## Prerequisites

- **Node.js** 20+
- **pnpm** 10+ (`corepack enable && corepack prepare pnpm@latest --activate`)
- **Firebase CLI** (`npm i -g firebase-tools`)

## Setup

```bash
git clone https://github.com/Appsilon/mediforce.git
cd mediforce
pnpm install
```

### Environment variables

```bash
cp packages/platform-ui/.env.local.example packages/platform-ui/.env.local
```

Fill in your Firebase project values. Get them from: Firebase Console > Project Settings > General > Your apps.

### Firebase credentials

The server-side Firebase Admin SDK needs credentials to talk to Firestore and Auth. On boot, `packages/platform-infra/src/auth/firebase-admin-init.ts` checks that at least one of these is present and fails fast with an actionable message otherwise.

Pick one of:

| Option | When to use | Setup |
|--------|-------------|-------|
| **ADC (gcloud)** | Local development | `gcloud auth application-default login` — writes `~/.config/gcloud/application_default_credentials.json` |
| **Service account file** | CI, containers, non-gcloud environments | `export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json` |
| **Emulators** | Offline work, E2E tests, first-time setup | `NEXT_PUBLIC_USE_EMULATORS=true pnpm dev:local` — no real credentials needed |
| **GCP runtime** | Firebase App Hosting / Cloud Run | Automatic — `K_SERVICE` / `GOOGLE_CLOUD_PROJECT` set by platform |

On startup `platform-services` logs which mode was detected, e.g. `[platform-services] Firebase Admin SDK: ADC (gcloud)`.

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase API key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase project ID |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase storage bucket |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase app ID |
| `OPENROUTER_API_KEY` | OpenRouter API key (for agent LLM calls) |
| `PLATFORM_API_KEY` | Platform API key (for server actions) |

## Monorepo structure

```
apps/
  supply-intelligence/ # Standalone supply intelligence Next.js app
packages/
  platform-core/       # Shared types, domain models, test factories
  platform-ui/         # Next.js UI — the main web application
  platform-infra/      # Firebase/Firestore infrastructure layer
  platform-api/        # API contract schemas + pure handlers (framework-free)
  agent-runtime/       # Agent execution engine
  workflow-engine/     # Process orchestration engine
  example-agent/       # Reference agent implementation
  supply-intelligence/ # Supply intelligence domain package
  supply-intelligence-plugins/  # Agent plugins for supply intelligence
```

## Running the app

```bash
# Platform UI (default, port 9003)
cd packages/platform-ui && pnpm dev

# Supply Intelligence app
cd apps/supply-intelligence && pnpm dev
```

## Testing

### Unit & integration tests

```bash
# All tests
pnpm test

# Fast mode (dot reporter)
pnpm test:fast

# Only tests affected by your changes
pnpm test:affected

# With coverage
pnpm test:coverage

# Type checking
pnpm typecheck
```

### Contract tests

Handlers in `platform-api` are tested against in-memory repositories from `@mediforce/platform-core/testing` — no mocks, no HTTP, no Firebase emulators, no dev server. The real win over E2E is not raw wall-clock time but zero ceremony: run the file, get the answer. Each handler is a pure function `(input, deps) => Promise<output>` with per-handler dependency injection, so tests read like the spec: set up repo state, call handler, assert on the return value. The canonical example is `packages/platform-api/src/handlers/tasks/__tests__/list-tasks.test.ts`, which exercises the `listTasks` handler backing `GET /api/tasks`.

### E2E tests (Playwright)

E2E tests live in `packages/platform-ui/e2e/`.

**Smoke tests** (no emulators needed):

```bash
cd packages/platform-ui
pnpm test:e2e              # headless
pnpm test:e2e:headed       # with browser visible
pnpm test:e2e:ui           # interactive Playwright UI
```

**Authenticated tests** (require Firebase Emulators):

```bash
# Terminal 1 — start emulators
cd packages/platform-ui
pnpm emulators

# Terminal 2 — run tests
pnpm test:e2e:auth         # headless
pnpm test:e2e:auth:headed  # with browser visible
```

The emulator setup automatically:
1. Creates a test user (`test@mediforce.dev` / `test123456`)
2. Seeds Firestore with test data (tasks, process instances, agent runs, audit events)
3. Authenticates and saves auth state for all tests

**Test structure:**
- `e2e/smoke.spec.ts` — unauthenticated tests (always run)
- `e2e/authenticated/*.spec.ts` — tests requiring login (only with emulators)
- `e2e/helpers/` — emulator REST API helpers and seed data

### Recommended workflow

1. `pnpm typecheck` — catches type errors (~5s)
2. `pnpm test:affected` — tests for changed files only (<1s)
3. `pnpm test` — full suite (~9s)
4. E2E tests if UI was changed (~15-60s)

## Build

```bash
pnpm build    # builds all packages
```

## Deployment

The platform UI deploys via Firebase App Hosting. See `apphosting.yaml` for configuration.
