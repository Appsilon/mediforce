---
status: living
audience: engineers
last_reviewed: 2026-08-19
---

# E2E testing

For engineers adding or maintaining product behaviour. Choose the lowest level
that gives real signal; product features also need L3 coverage.

## Choose the level

| Level | Location | Use it for |
|---|---|---|
| L1 unit | Co-located `__tests__/` | Pure logic without I/O |
| L2 integration | In-process Vitest test | Collaborating code with faked services |
| L3 API E2E | `packages/platform-ui/e2e/api/` | Every product feature: its HTTP contract, auth, and persistence |
| L3 password-off API E2E | `packages/platform-ui/e2e/api-password-off/` | Behaviour specific to deployments without password sign-in |
| L4 UI journey | `packages/platform-ui/e2e/ui/` | A small number of complete, important browser flows |
| L5 external | `packages/platform-ui/e2e/external/` | Agent, MCP, or model-provider integration |

`smoke.spec.ts` is the unauthenticated browser smoke check. L3 and L4 use real
Postgres, seeded authentication, and mocked agents; L4 uses Chromium.

## Write a journey

- One test describes and completes one user outcome. Assert visible behaviour,
  not CSS or implementation details.
- Use `page.goto()` only for the entry page; follow the remaining flow through
  links and buttons.
- In UI journeys, import `test` and `expect` from
  `../helpers/test-fixtures`, call `trackPageErrors(page)` first, and use
  `allowPageErrors` only for errors the test deliberately causes. The fixture
  fails the test on unexpected page errors.
- Treat an unexpected failure as a regression. Change a test only when the
  intended behaviour changed, and say why in the PR.

The `authenticated` project receives its session from `auth-setup.ts`; do not
add a login round trip unless login itself is the behaviour under test.

## State and retries

`auth-setup.ts` seeds Postgres once per invocation. CI uses one worker; do not
rely on test order or on pristine state after a retry.

Read-only journeys may share fixtures in `e2e/helpers/seed-data.ts`. A journey
that writes must use a fixture no other journey reads, or create uniquely named
data. Reset persistent state at the start when a retry would otherwise see the
previous attempt's changes.

A fixture run must be created **after** the Workflow Definition it pins, the
order production can only produce. The step role gate reads that ordering to
tell a run's own definition from one registered under the same name after the
run started, and refuses the task when the definition looks like the later one.
Seeded definitions share one anchor, `SEEDED_DEFINITION_CREATED_AT`, that sits
well before the oldest fixture run; a new run fixture older than that has to
move the anchor back rather than date around it.

## Run

`DATABASE_URL` must point to local Postgres. The full suite applies migrations,
starts a mock OAuth server, and seeds the fixture.

| From the repository root | Runs |
|---|---|
| `pnpm test:e2e` | Smoke, all L3 API projects, and L4 UI journeys |
| `pnpm test:e2e:api` | Primary L3 API project |
| `pnpm test:e2e:ui` | Authenticated L4 UI journeys |
| `pnpm test:external` | L5 external tests (when their credentials are available) |

From `packages/platform-ui`, `pnpm test:e2e:headed` runs the full suite with a
visible browser. `pnpm test:e2e:ui` opens Playwright UI mode for the smoke
project only; set `E2E_FULL_SUITE=true` when using it to inspect L3/L4 tests.

CI runs `pnpm test:e2e:api` and `pnpm test:e2e:ui` after building the E2E app.
