# @mediforce/platform-ui

Main web application for Mediforce — Next.js 15 (App Router).

Top of the dependency graph: it consumes every other package and nothing
consumes it. That position is the reason its rules are about restraint — code
that lands here is reachable from the browser and from nowhere else.

## What lives here

| Path | Holds |
|---|---|
| `src/app/(app)/[handle]/` | Workspace-scoped pages |
| `src/app/api/` | HTTP route adapters over `platform-api` handlers |
| `src/proxy.ts` | NextAuth session / API-key auth and CORS |
| `src/components/`, `src/hooks/`, `src/contexts/` | UI surface |
| `src/instrumentation*.ts` | OTel wiring ([ADR-0007](../../docs/adr/0007-llm-evaluation-observability.md)) |
| `e2e/` | L3 API and L4 UI Playwright suites |

## Rules

**Routes are adapters, not logic.** A route parses the request, builds the
caller scope, calls a handler in
[`@mediforce/platform-api`](../platform-api/README.md), and serialises the
result. Business logic in a route is unreachable from the CLI and from agents,
which call the same handler directly —
[`docs/reference/api-architecture.md`](../../docs/reference/api-architecture.md).

**No new Server Actions.** Every mutation is a handler plus a Zod contract plus a
route adapter ([ADR-0005](../../docs/adr/0005-headless-platform-api-ui-separation.md)).

**`src/lib/platform-services.ts` is a re-export shim, not an API.** The
composition root is `getPlatformServices()` in `@mediforce/platform-api/services`;
the shim exists only until its call sites migrate. Do not add symbols to it.

**Never call `fetch` directly from a client component.** Middleware 401s
silently because no auth header is attached. Use the typed `mediforce` client
from `@/lib/mediforce`, or `apiFetch` from `@/lib/api-fetch` for an endpoint
that is not on the contract — the `use-mediforce` skill has the full ladder.

## Running and testing it

Commands, ports, env vars and troubleshooting live in
[`docs/start/dev-quickref.md`](../../docs/start/dev-quickref.md); first-time
setup in [`GETTING-STARTED.md`](../../GETTING-STARTED.md). The authority on this
package's environment is [`.env.example`](.env.example) — copy it to `.env.local`.
Nothing is duplicated here, because a second copy is the one that goes stale.

`vercel.json` gives every pull request a preview deployment against the staging
database, and runs the `/api/cron/model-sync` cron.
