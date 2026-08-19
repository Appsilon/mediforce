---
status: living
audience: engineers
last_reviewed: 2026-08-19
---

# Dev quick reference

Terse command-first lookup for agents and devs. Zero-to-running setup:
[GETTING-STARTED.md](../../GETTING-STARTED.md). Deeper guides:
[development.md](development.md) (env vars, branches, deployment),
[postgres-local-dev.md](postgres-local-dev.md) (migrations, DB internals).

## Which dev command?

| Command              | Backend                                | Agents            | Port | Use when                            |
|----------------------|----------------------------------------|-------------------|------|-------------------------------------|
| `pnpm dev:mock`      | Postgres, auto-seeded, password sign-in | Mocked           | 9007 | UI work, fastest spin-up            |
| `pnpm dev`           | Postgres (auto-migrate)                | Docker containers | 9003 | Default full stack — most realistic |
| `pnpm dev:no-docker` | Postgres on :5432 (must already be up) | Host `claude` CLI | 9003 | Agent debugging without containers  |
| `pnpm dev:queue`     | Postgres + Redis                       | Queue-backed; worker separate | 9003 | Queue-based agent runs     |

Notes:
- Every mode needs a database — ADR-0001 left no in-memory backend. `dev`,
  `dev:queue` and `dev:mock` start it for you via
  [`scripts/dev-infra.py`](../../scripts/dev-infra.py) (`docker-compose.yml` +
  `docker-compose.dev.yml`, project `mediforce-dev`, volume
  `mediforce-dev-pgdata` — same data across all worktrees), then run
  `pnpm db:migrate`.
- `dev:no-docker` defaults `DATABASE_URL` to the same `localhost:5432` URL but
  does **not** start Postgres — run `pnpm dev` once first, or bring your own DB.
- `dev:queue` starts Postgres + Redis only. The queue consumer and its UI are
  separate containers: `docker compose up -d container-worker bull-board`
  (bull-board on :3100). Without the worker, jobs enqueue and nothing runs them.
- Auth is NextAuth / Auth.js v5 (ADR-0002) — no Firebase emulator. Set
  `AUTH_SECRET` plus a provider: `ENABLE_PASSWORD_AUTH=true` for local
  email/password, or `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` for Google.
  See `packages/platform-ui/.env.example`.
- Port override: `PORT=9999 pnpm dev`.

### `dev:mock` env overrides

[`dev-mock.py`](../../packages/platform-ui/scripts/dev-mock.py) bakes in defaults
(`MOCK_AGENT`, `AUTH_SECRET`, `MEDIFORCE_DISABLE_EMAIL`, fake OpenRouter and
platform API keys) and seeds the demo user + fixture. An already-exported value
always wins, so any default — plus anything not baked in at all (`DATABASE_URL`,
`MEDIFORCE_API_KEY`, `MEDIFORCE_BASE_URL`) — is overridable. Set
`MEDIFORCE_DEV_MOCK_SEED=false` to skip the seed.

Example — real Postgres, real API key so the `mediforce` CLI can hit the mock
server, real (non-mocked) agent containers:

```sh
DATABASE_URL=postgresql://mediforce:mediforce@localhost:5432/mediforce \
MEDIFORCE_API_KEY="test" \
MEDIFORCE_BASE_URL="http://127.0.0.1:9007" \
MEDIFORCE_DISABLE_EMAIL=false \
MOCK_AGENT=false \
pnpm dev:mock
```

## Test levels

| Command              | Scope                               |
|----------------------|-------------------------------------|
| `pnpm typecheck`     | `tsc -b --noEmit`                   |
| `pnpm test:affected` | vitest `--changed` only             |
| `pnpm test:unit`     | vitest L1 + L2 (unit + integration) |
| `pnpm test:e2e:api`  | L3 API E2E, no browser              |
| `pnpm test:e2e:ui`   | L4 UI E2E (Chromium)                |
| `pnpm test:e2e`      | L3 + L4 (NextAuth on :9007)         |
| `pnpm test`          | Everything (unit + e2e)             |

Level definitions (L1–L5) + the rules: [e2e-strategy.md](../testing/e2e-strategy.md).
Product features must land at **L3**.

Playwright's `globalSetup` applies migrations and starts the mock OAuth server —
no separate migration step before `pnpm test:e2e`.

**Your dev data is safe.** The suite deletes only the workspace handles it owns
(`test`, `tenant-a`, `tenant-b`, plus per-journey handles and prefixes); FK
cascade does the rest. Your personal namespace is never touched. A journey that
creates a new handle must add it to `fixtureHandles` in
[e2e/helpers/postgres-seed.ts](../../packages/platform-ui/e2e/helpers/postgres-seed.ts).

**Builds are never stale.** `build:e2e` stamps a hash of the source tree into
`.next/BUILD_SOURCE_HASH` and `start:e2e` rebuilds when it no longer matches
([e2e_build_gate.py](../../packages/platform-ui/scripts/e2e_build_gate.py)).
The fingerprint is content-based, not `HEAD`-based, so branch switches **and
uncommitted edits** both force a rebuild. On CI the `.next` cache key already
encodes that hash, so the gate only asserts a build exists and never rebuilds.

## CLI cheat sheet

Dogfood rule: **CLI > REST.** Full guide: [use-mediforce skill](../../skills/use-mediforce/SKILL.md).

```bash
pnpm exec mediforce --help                 # discover commands
pnpm exec mediforce workflow list          # example read
pnpm exec mediforce workflow list --json   # machine-readable
```

Auth: `MEDIFORCE_API_KEY`. Base URL: `MEDIFORCE_BASE_URL` (default `http://localhost:9003`).
**Never hit production.** Missing a command? Add it in the same PR (see the skill).

## Repo checks

```bash
pnpm typecheck        # tsc -b --noEmit, whole workspace
pnpm check:docs       # doc metadata, routing, links, backticked docs//skills/ paths
pnpm check:readmes    # every packages/*/ and apps/*/ has a README.md
```

`check:docs` runs in `docs.yml`, `check:readmes` in `ci.yml` — a new package
with no Markdown file matches no `**.md` path filter, so the docs workflow
would never fire on it. Both check *references*, never whether prose is true.
For that, `/sync-docs`.

## Add a migration

```bash
# 1. edit a schema file under packages/platform-infra/src/postgres/schema/
pnpm db:generate    # 2. emit NNNN_*.sql + journal entry (drizzle-kit)
pnpm db:migrate     # 3. apply locally (pnpm dev auto-runs this)
# 4. commit the .sql + meta/_journal.json
```

Branch-collision rename rule: [postgres-local-dev.md](postgres-local-dev.md).

### Pull staging data locally

Clone the staging DB into local dev Postgres — real data, staging untouched.
Requires SSH to the staging host (user `deploy`, override with `--user`).

```bash
python3 scripts/db-pull-staging.py <staging-ip>              # e.g. 204.168.165.57
python3 scripts/db-pull-staging.py <staging-ip> --keep-dump  # keep the .dump for reuse
```

## Tracing (Phoenix)

Agent runs emit OTel spans ([ADR-0007](../adr/0007-llm-evaluation-observability.md)).
Opt-in — without `OTEL_EXPORTER_OTLP_ENDPOINT` they are no-ops. Any OTLP-HTTP
backend works in place of Phoenix.

```bash
docker compose up -d phoenix                              # trace viewer on :6006
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:6006 pnpm dev
```

Run a workflow with an agent step, then open http://localhost:6006 — spans
`mediforce.agent.run` (workflow correlation attributes) and
`openrouter.chat.completion` (model + token usage) land in the `default` project.

- `MEDIFORCE_OTEL_CAPTURE_CONTENT=true` also records content — step input,
  envelope result, prompt/completion text. Dev/demo only; may contain patient data.
- `MEDIFORCE_OTEL_EXPORT_ALL_SPANS=true` exports non-`@mediforce/*` spans too
  (Next.js HTTP instrumentation is filtered out by default).
- Container agents (claude-code, opencode, script) call their LLM **inside** the
  container, so they have no `openrouter.chat.completion` child span — only the
  platform-side `OpenRouterLlmClient` is traced. In-container tracing needs
  context propagation into the container (not implemented).

## Port map

| Port | Service                                     |
|------|---------------------------------------------|
| 9003 | dev UI (`dev`, `dev:no-docker`, `dev:queue`) |
| 9007 | e2e + `dev:mock` UI                         |
| 5432 | Postgres                                    |
| 6379 | Redis (`dev:queue`)                         |
| 3100 | bull-board (`dev:queue`)                    |
| 6006 | Phoenix trace viewer (opt-in)               |

## Troubleshooting

| Symptom                                  | Fix                                                              |
|------------------------------------------|-----------------------------------------------------------------|
| `DATABASE_URL is required` FATAL at boot | Non-mock mode without a DB — run `pnpm dev`, or set `DATABASE_URL`. |
| Port 9003 in use                         | `lsof -ti:9003 \| xargs kill -9` or `PORT=9999 pnpm dev`.        |
| `docker compose` hangs                   | Docker Desktop isn't running — start it.                         |
| `pnpm dev`: "Docker Compose v2 is not installed" | Engine-only `docker.io` lacks Compose — `sudo apt install docker-compose-v2` (Ubuntu); Docker Desktop bundles it. |
| `relation "..." does not exist`          | `pnpm db:migrate`.                                               |
| Stale / corrupt local data               | `docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v && pnpm dev` (wipes the pg volume). |
| `mediforce: missing API key`             | Set `MEDIFORCE_API_KEY` (see [GETTING-STARTED §3](../../GETTING-STARTED.md#3-run-the-cli)). |
| `Unable to find image '...' locally` (script step) | Build local agent images: `./scripts/rebuild-docker-images.sh` ([GETTING-STARTED](../../GETTING-STARTED.md#build-images-for-script-executor-steps)). |
| `DATABASE_URL must be set to seed Postgres for E2E` | Remote env (CI, Claude Code web, fresh box) with no Postgres — `pnpm dev` once, then export `DATABASE_URL`. `auth-setup.ts` and the E2E server must share one database. |
| Every authenticated journey redirects to `/login`  | `AUTH_SECRET` missing — NextAuth can't sign the session. `playwright.config.ts` carries a fixed test-only fallback. |
| Playwright: "chromium executable not found"        | `npx playwright install --with-deps chromium`. Binary must match the `@playwright/test` version. |
| Stale E2E server on 9007                           | `fuser -k 9007/tcp`.                                             |

## Gotchas

Two invariants that look like bugs when you trip them.

### Workspace packages export source TypeScript directly

Edit `packages/platform-core/src/` and `platform-ui` picks it up with no
rebuild; Vitest reads the TS directly. That is deliberate, not a misconfigured
build.

Workspace package `exports` maps point directly at `./src/*.ts`; there is no
development-only condition and no `dist/` fallback. TypeScript, Vitest, Next.js,
and Playwright consume the same source entry points.

Don't add a build step to dev, and don't import `@mediforce/*/dist/…`
anywhere. Adding a subpath export means touching `package.json` exports and
`tsconfig.json` paths; consumers follow automatically. New package? Copy the
smallest existing package with the same entry-point shape.

### Runtime skill paths are hardcoded in `.wd.json`

Move or rename a runtime skill directory and the step fails at execution:
`BaseContainerAgentPlugin.readSkillFile()` can't find it. `skillsDir` in the
WorkflowDefinition is a literal path, not a registry lookup.

Two tiers, different resolution — don't confuse them:

| Tier | Location | Resolved by |
|------|----------|-------------|
| Runtime | `apps/*/plugins/*/skills/` | `agent-runtime` via `skillsDir` in `.wd.json` |
| Development | `skills/` (symlinked into `.claude/skills/`) | Claude Code slash-command loader |

Each app indexes its own runtime skills in a local `_registry.yml`. Before
refactoring: `grep -rn 'skillsDir' apps/ packages/`.
