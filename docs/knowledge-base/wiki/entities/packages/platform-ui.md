---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 5
tags: [package, platform-ui, nextjs, app-router]
---

**Main web app. Next.js 15 App Router. Hosts every route + API + `getPlatformServices()` composition root.**

## Purpose

User-facing entry. Workspace-scoped pages (agents, tasks, processes, workflows, catalog, monitoring, cowork, runs, tickets, configs, settings). REST API for agents + external clients. `getPlatformServices()` wires every other package: repos, workflow engine, agent runners, plugin registry. Top of dependency graph.

## Dependencies

- Internal: [`platform-infra`](./platform-infra.md), [`platform-core`](./platform-core.md), [`workflow-engine`](./workflow-engine.md), [`agent-runtime`](./agent-runtime.md), `mcp-client`, [`supply-intelligence-plugins`](./supply-intelligence-plugins.md); optionally `agent-queue`.
- External: `next@15`, `react`, `radix-ui`, `firebase`, `playwright`.

## Key entry points

- **Routes**: `src/app/(app)/[handle]/{agents,catalog,configs,cowork,monitoring,processes,runs,settings,tasks,tools,workflows}`.
- **Auth pages**: `/login`, `/change-password`, `/test-login`, `/workspace-selection`.
- **API**: `src/app/api/{processes,definitions,tasks,users,configs,cowork,workflow-definitions,agents,tickets,cron,migrations}`.
- **Service singleton**: `src/lib/platform-services.ts` — `getPlatformServices()` lazy-wires everything. Registers built-in plugins (`claude-code-agent`, `opencode-agent`, `script-container`) + supply-intelligence plugins. See [service-singleton](../../concepts/service-singleton.md).
- **Middleware**: `src/middleware.ts` — JWT/API-key auth, CORS, Firebase token verify (emulator-aware via `NEXT_PUBLIC_USE_EMULATORS`).

## Key internal modules

- `src/lib/platform-services.ts` — composition root.
- `src/lib/execute-agent-step.ts`, `src/lib/resolve-task.ts` — workflow + task resolution.
- `src/lib/resolve-definition-steps.ts` — bridges legacy `processDefinitions`+`processConfigs` to unified `workflowDefinitions`. **Always go through this.** See [dual-schema-migration](../../concepts/dual-schema-migration.md) + [dual-schema-routing gotcha](../../gotchas/dual-schema-routing.md).
- `src/components/{agents,tasks,processes,workflows}` — feature UI.
- `src/contexts/auth-context.tsx` — Firebase Auth React context.

## Notable patterns

- **Service singleton** → [service-singleton](../../concepts/service-singleton.md).
- **`@mediforce/source` TS condition** — dev = source `.ts`, prod = `dist/`. See [mediforce-source-custom-condition gotcha](../../gotchas/mediforce-source-custom-condition.md).
- **Firebase emulator toggle** — `NEXT_PUBLIC_USE_EMULATORS=true` → JWT verify switches `jwtVerify` (prod JWKS) to `decodeJwt` (emulator unsigned).
- **App Router RSC** — async server components throughout.

## Testing surface

- Unit: `src/test/*.test.ts` (Vitest jsdom).
- Journey: `src/test/*-journey.test.ts` — handler-level, in-memory repos.
- E2E: `e2e/journeys/` (Playwright, port 9007 emulator), `e2e/smoke.spec.ts`. Remote env? → [remote-e2e-setup gotcha](../../gotchas/remote-e2e-setup.md).
- Real-LLM E2E: `e2e/api/*.test.ts` via `pnpm test:mcp-real`.

## Ports / infra

- Dev: `9003` (`pnpm dev`).
- Emulator E2E: `9007`.
- Firebase emulators: Auth `9099`, Firestore `8080`.
- Prod: Hetzner VPS.

## Relationships

- Consumes: every other Mediforce package.
- Consumed by: nothing (top of graph).

## Sources

- `packages/platform-ui/package.json`
- `packages/platform-ui/src/middleware.ts`
- `packages/platform-ui/src/lib/platform-services.ts`
- `packages/platform-ui/src/lib/resolve-definition-steps.ts`
- `AGENTS.md` → "Platform UI structure", "Package dependency graph"
