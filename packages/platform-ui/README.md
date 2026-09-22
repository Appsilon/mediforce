# @mediforce/platform-ui

Main web application for Mediforce — Next.js 16 (App Router).

Top of the dependency graph: it consumes every other package and nothing
consumes it. That position is the reason its rules are about restraint — code
that lands here is reachable from the browser and from nowhere else.

## What lives here

| Path | Holds |
|---|---|
| `src/app/(app)/[handle]/` | Workspace-scoped pages |
| `src/app/api/` | HTTP route adapters over `platform-api` handlers |
| `src/app/join/` | Public `/join/<token>` join-link landing page (no session) |
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

**A public route brings its own guards.** `proxy.ts` exempts `/api/auth/*` and
`/api/join/*` because you cannot present a session while obtaining one. What the
adapter would otherwise supply, those routes supply themselves: a JSON
content-type check (a cross-site form post can only send the three form
encodings, so demanding JSON blocks CSRF) and, for anything that sends mail, a
budget from `@/lib/rate-limit` in the same commit as the route
([ADR-0021](../../docs/adr/0021-workspace-join-links.md) §6). A public route
without both is how an endpoint becomes a mail relay.

**`src/lib/platform-services.ts` is a re-export shim, not an API.** The
composition root is `getPlatformServices()` in `@mediforce/platform-api/services`;
the shim exists only until its call sites migrate. Do not add symbols to it.

**The guide points at `data-tour`, not at class names.** The Guide button in the
top bar runs over `src/components/tour/`, spotlighting whichever element carries
the `data-tour` value a step names. Adding a step means adding
that attribute to the real element — never a CSS selector over layout classes,
which the next restyle silently breaks. A step whose element is absent still
runs and narrates centred, so a guide survives a panel that renders only when
it has something to show. Route matching and the card geometry live in
`src/lib/tour.ts`; the chapters themselves in `src/lib/tour-content.ts`, where
a test holds each one to at least three steps and forbids ringing the same
element more than twice.

**Demo is the same overlay with a different job.** A guide explains the page you
are on and ends when you leave it; a *scenario* (`src/lib/demo-content.ts`)
walks one job across pages, navigates to the page and tab each step is about,
and folds into a pill in the top bar when the viewer touches the app. Where a
step cannot be reached — an empty workspace has no run for `:runId` — it says
what is missing rather than spotlighting nothing. Every routing decision is one
pure function, `nextRouteAction` in `src/lib/demo.ts`; keep it that way, because
the bugs here come from two rules disagreeing about the same pathname.

The button is offered to `@appsilon.com` addresses, or to anyone when
`NEXT_PUBLIC_DEMO_MODE=true` (which `pnpm dev:mock` sets so the scenarios are
walkable against the mock seed). Being `NEXT_PUBLIC_*`, the flag is inlined into
the client bundle, so it is presentation only — the scenarios are static copy
with no privileged data behind them, and nothing about the gate is a security
boundary.

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
