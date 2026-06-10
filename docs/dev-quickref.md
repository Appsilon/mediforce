# Dev quick reference

Terse command-first reference for agents and devs. For zero-to-running setup see
[GETTING-STARTED.md](../GETTING-STARTED.md). Deeper guides:
[development.md](development.md), [postgres-local-dev.md](postgres-local-dev.md).

## Which dev command?

| Command              | Backend                                   | Agents            | Docker | Port | Use when                                  |
|----------------------|-------------------------------------------|-------------------|--------|------|-------------------------------------------|
| `pnpm dev:mock`      | In-memory + Firebase emulators            | Mocked            | No     | 9007 | UI work, fastest spin-up (~30s)           |
| `pnpm dev`           | Postgres (auto-migrate)                   | Docker containers | Yes    | 9003 | Default full stack — most realistic       |
| `pnpm dev:no-docker` | Postgres on :5432 (must already be up)    | Host `claude` CLI | No     | 9003 | Agent debugging without containers        |
| `pnpm dev:queue`     | Postgres + Redis                          | BullMQ worker     | Yes    | 9003 | Queue-based agent runs (bull-board :3100) |

Notes:
- `dev` starts Postgres via `docker-compose.dev.yml` (shared volume `mediforce-dev-pgdata`,
  project `mediforce-dev` — same data across all worktrees), runs `pnpm db:migrate`, then `next dev`.
- `DATABASE_URL` is hardcoded in the `dev` / `dev:queue` scripts; `dev:no-docker` defaults to
  the same `localhost:5432` URL but does **not** start Postgres — run `pnpm dev` once first
  (or bring your own DB on :5432).
- `dev:mock` is the only mode that runs without `DATABASE_URL`.
- Port override: `PORT=9999 pnpm dev`.

## Test levels

| Command              | Scope                                  |
|----------------------|----------------------------------------|
| `pnpm typecheck`     | `tsc -b --noEmit`                      |
| `pnpm test:affected` | vitest `--changed` only                |
| `pnpm test:unit`     | vitest L1 + L2 (unit + integration)    |
| `pnpm test:e2e:api`  | L3 API E2E, no browser                 |
| `pnpm test:e2e:ui`   | L4 UI E2E (Chromium)                   |
| `pnpm test:e2e`      | L3 + L4 (emulators on :9007)           |
| `pnpm test`          | Everything (unit + e2e)                |

Level definitions (L1–L5) + the rules: [E2E-STRATEGY.md](E2E-STRATEGY.md).
Product features must land at **L3**.

## CLI cheat sheet

Dogfood rule: **CLI > REST.** Full guide: [use-mediforce skill](../.claude/skills/use-mediforce/SKILL.md).

```bash
pnpm exec mediforce --help                 # discover commands
pnpm exec mediforce workflow list          # example read
pnpm exec mediforce workflow list --json   # machine-readable
```

Auth: `MEDIFORCE_API_KEY`. Base URL: `MEDIFORCE_BASE_URL` (default `http://localhost:9003`).
**Never hit production.** Missing a command? Add it in the same PR (see the skill).

## Tracing (Phoenix)

Agent runs emit OTel spans ([ADR-0007](adr/0007-llm-evaluation-observability.md)).
Opt-in — without `OTEL_EXPORTER_OTLP_ENDPOINT` they are no-ops.

```bash
docker compose up -d phoenix                              # trace viewer on :6006
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:6006 pnpm dev
```

Run any workflow with an agent step, then open http://localhost:6006 —
spans `mediforce.agent.run` (workflow correlation attributes) and
`openrouter.chat.completion` (model + token usage) land in the `default`
project. Add `MEDIFORCE_OTEL_CAPTURE_CONTENT=true` to also record
prompt/completion text (dev/demo only — prompts may contain patient data).
Any OTLP-HTTP backend works in place of Phoenix.

## Add a migration

```bash
# 1. edit a schema file
#    packages/platform-infra/src/postgres/schema/
pnpm db:generate    # 2. emit NNNN_*.sql + journal entry (drizzle-kit)
pnpm db:migrate     # 3. apply locally (pnpm dev also auto-runs this)
# 4. commit the .sql + meta/_journal.json
```

Branch-collision rename rule: [postgres-local-dev.md](postgres-local-dev.md).

### Pull staging data locally

Clone the staging DB into your local dev Postgres so you can work against real data without touching staging:

```bash
python3 scripts/db-pull-staging.py <staging-ip>          # e.g. 204.168.165.57
python3 scripts/db-pull-staging.py <staging-ip> --keep-dump  # keep the .dump file for reuse
```

Requires SSH access to the staging host (uses `deploy` user by default, override with `--user`).

## Port map

| Port | Service                          |
|------|----------------------------------|
| 9003 | dev UI (`dev`, `dev:no-docker`, `dev:queue`) |
| 9007 | e2e + `dev:mock` UI              |
| 5432 | Postgres                         |
| 6379 | Redis (`dev:queue`)             |
| 9099 | Firebase Auth emulator          |
| 9199 | Firebase Storage emulator       |
| 3100 | bull-board (`dev:queue`)        |
| 6006 | Phoenix trace viewer (opt-in)   |

## Troubleshooting (top 5)

| Symptom                                  | Fix                                                              |
|------------------------------------------|-----------------------------------------------------------------|
| `DATABASE_URL is required` FATAL at boot | Non-mock mode without a DB — run `pnpm dev`, or set `DATABASE_URL`. |
| Port 9003 in use                         | `lsof -ti:9003 \| xargs kill -9` or `PORT=9999 pnpm dev`.        |
| `docker compose` hangs                   | Docker Desktop isn't running — start it.                         |
| `pnpm dev`: "Docker Compose v2 is not installed" | Engine-only `docker.io` lacks Compose — `sudo apt install docker-compose-v2` (Ubuntu); Docker Desktop bundles it. |
| `relation "..." does not exist`          | `pnpm db:migrate`.                                               |
| Stale / corrupt local data               | `docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v && pnpm dev` (wipes the pg volume). |
