---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 5
tags: [package, platform-ui, nextjs, app-router]
---

**Main web application — Next.js 15 App Router, hosts all workspace routes, API routes, and the `getPlatformServices()` singleton that wires every other package together.**

## Purpose

User-facing entry point. Serves workspace-scoped pages (agents, tasks, processes, workflows, catalog, monitoring, cowork, runs, tickets, configs, settings), exposes the REST API consumed by agents and external clients, and composes the platform-services singleton that instantiates repositories, the workflow engine, agent runners, and the plugin registry. All other packages are orchestrated from here.

## Dependencies

- Internal: [`platform-infra`](./platform-infra.md), [`platform-core`](./platform-core.md), [`workflow-engine`](./workflow-engine.md), [`agent-runtime`](./agent-runtime.md), `mcp-client`, [`supply-intelligence-plugins`](./supply-intelligence-plugins.md); optionally `agent-queue`.
- External: `next@15`, `react`, `radix-ui`, `firebase`, `playwright`.

## Key entry points

- **Route groups**: `src/app/(app)/[handle]/{agents,catalog,configs,cowork,monitoring,processes,runs,settings,tasks,tools,workflows}`.
- **Auth pages**: `/login`, `/change-password`, `/test-login`, `/workspace-selection`.
- **API routes**: `src/app/api/{processes,definitions,tasks,users,configs,cowork,workflow-definitions,agents,tickets,cron,migrations}`.
- **Service singleton**: `src/lib/platform-services.ts` — `getPlatformServices()` lazy-creates everything, shared across API routes. Registers the three built-in plugins (`claude-code-agent`, `opencode-agent`, `script-container`) plus supply-intelligence plugins.
- **Middleware**: `src/middleware.ts` — JWT/API key auth, CORS, Firebase token validation (emulator-aware via `NEXT_PUBLIC_USE_EMULATORS`).

## Key internal modules

- `src/lib/platform-services.ts` — service composition root.
- `src/lib/execute-agent-step.ts`, `src/lib/resolve-task.ts` — workflow/task resolution.
- `src/lib/resolve-definition-steps.ts` — bridges legacy `processDefinitions` + `processConfigs` to unified `workflowDefinitions` (see [dual-schema-migration concept](../../concepts/dual-schema-migration.md)).
- `src/components/{agents,tasks,processes,workflows}` — feature UI.
- `src/contexts/auth-context.tsx` — Firebase Auth React context.

## Notable patterns

- **Service singleton** (see [service-singleton concept](../../concepts/service-singleton.md)): `getPlatformServices()` with fail-fast encryption-key validation.
- **Custom `@mediforce/source` TS condition** — imports resolve to source `.ts` during dev, compiled `dist/` in prod (see [gotchas/mediforce-source-custom-condition](../../gotchas/mediforce-source-custom-condition.md)).
- **Firebase emulator toggle** — `NEXT_PUBLIC_USE_EMULATORS=true` switches JWT verification from `jwtVerify` (production, JWKS) to `decodeJwt` (emulator, unsigned).
- **App Router server components** — async RSC throughout route groups.

## Testing surface

- Unit: `src/test/*.test.ts` (Vitest, jsdom).
- Journey: `src/test/*-journey.test.ts` — handler-level, in-memory repos.
- E2E: `e2e/journeys/` (Playwright, port 9007 emulator mode), `e2e/smoke.spec.ts`.
- Real-LLM E2E: `e2e/api/*.test.ts` via `pnpm test:mcp-real`.

## Ports / infra

- Dev: port `9003` (`pnpm dev`).
- Emulator E2E: port `9007`.
- Firebase emulators: Auth `9099`, Firestore `8080`.
- Production: Firebase App Hosting (`apphosting.yaml`).

## Relationships

- Consumes all other Mediforce packages.
- Consumed by: nothing (top of the dependency graph).

## Sources

- `packages/platform-ui/package.json`
- `packages/platform-ui/src/middleware.ts`
- `packages/platform-ui/src/lib/platform-services.ts`
- `packages/platform-ui/src/lib/resolve-definition-steps.ts`
- `AGENTS.md` → "Platform UI structure", "Package dependency graph"
