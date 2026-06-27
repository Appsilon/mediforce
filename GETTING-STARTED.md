# Getting Started

Get the app running locally in minutes. Start with mocked agents and demo data,
then move to the full local stack (Postgres data layer + Firebase Auth) and
build your own workflows.

Agents / quick lookups: see [docs/dev-quickref.md](docs/dev-quickref.md).

## Prerequisites

- **Node.js** 20+
- **pnpm** 10+ (`corepack enable && corepack prepare pnpm@latest --activate`)
- **Docker + Docker Compose v2** — for the Postgres data layer and Docker agents.
  Docker Desktop (macOS/Windows) bundles Compose. On a Linux engine-only install
  (Ubuntu's `docker.io`) Compose is a separate package — install both:
  `sudo apt install docker.io docker-compose-v2`. Verify with `docker compose version`.
- **Firebase service account** — only for cloud Auth/Storage (the optional path below).
  **Not** needed for data: all server data lives in Postgres (ADR-0001).
- **`MEDIFORCE_API_KEY`** — only for the CLI (section 3) or calling the API
  directly. Not needed for `pnpm dev:mock` UI-only exploration.
- **Local agent images** — only if you'll run a workflow with `script`
  executor steps (most workflows under `apps/`). See [Build images for
  script-executor steps](#build-images-for-script-executor-steps).

---

## 1. Fastest start — `pnpm dev:mock` (~30s, no Docker)

```bash
pnpm install
pnpm dev:mock
```

Open **http://localhost:9007**.

Zero cloud, zero Docker, zero Postgres: the launcher starts local Firebase
emulators (Auth + Storage), seeds demo data, runs the UI, and mocks agent
execution. Best for UI work and exploring the app before configuring anything
real.

---

## 2. Full local stack — `pnpm dev` (Postgres + UI)

```bash
pnpm install
pnpm dev
```

Open **http://localhost:9003**. `pnpm dev`:

1. starts a local Postgres container (`docker-compose.dev.yml`),
2. applies migrations (`pnpm db:migrate`),
3. runs the UI against it (agents run inline via Docker — no Redis needed).

`DATABASE_URL` is wired by the script; you don't set it. Data persists in the
named volume **`mediforce-dev-pgdata`** under the stable `mediforce-dev` compose
project, so **every git worktree shares the same Postgres + data**, and it
survives restarts.

Port override: `PORT=9999 pnpm dev`.

The UI starts **empty** — create workflows via the UI or CLI to populate it
(see sections 3–4).

### Demo sign-in

When running against emulators (`dev:mock`, or the optional emulator path
below), use:

- **Email**: `test@mediforce.dev`
- **Password**: `test123456`

A real Firebase project uses your own accounts.

### Build images for script-executor steps

Workflow steps with `"executor": "script"` (`plugin: script-container`) run
inside Docker images that are **built locally, not pulled from a registry**.
Most workflows under `apps/` use one or both of:

- `mediforce-golden-image:latest` — Node + common tooling, the base for most
  inline `runtime: javascript` script steps
- `mediforce-node:latest` — plain Node runtime, the fallback image when a
  script step omits `script.image`

Build everything in one go:

```bash
./scripts/rebuild-docker-images.sh
```

This also builds the per-app agent images (`protocol-to-tfl`, `tealflow`,
`community-digest`, `landing-zone`). Re-run it after pulling changes to
`packages/agent-runtime/container/` or any `apps/*/container/Dockerfile`.

Skip this if you're only on `pnpm dev:mock` or running workflows with
`human`/`agent` executor steps only — without it, starting a `script` step
fails with `Unable to find image '...' locally`.

---

## Which dev command?

| Command              | What runs                                                   | Port | When to use                                  |
|----------------------|-------------------------------------------------------------|------|----------------------------------------------|
| `pnpm dev`           | Postgres + auto-migrate + UI, Docker agents                 | 9003 | Default full local stack                     |
| `pnpm dev:mock`      | Mocked agents, in-memory data, Firebase emulators (no Docker) | 9007 | Fastest; best for UI work                 |
| `pnpm dev:no-docker` | UI + host `claude` CLI agents, **no** Docker                | 9003 | Agent debugging without containers           |
| `pnpm dev:queue`     | `pnpm dev` + Redis + BullMQ queue worker                    | 9003 | Testing queue-based agent runs               |

**`dev:no-docker` caveat:** it's docker-free but the app still requires Postgres
on `:5432` (`DATABASE_URL` is required at boot). It does **not** start Postgres —
run `pnpm dev` once to leave a container running, or point `DATABASE_URL` at your
own DB.

Full decision table + ports + migration steps: [docs/dev-quickref.md](docs/dev-quickref.md).

---

## 3. Run the CLI

The `mediforce` CLI is the supported way to drive the platform from a terminal
(dogfood rule: CLI > REST).

### Authenticate (one-time)

The CLI sends `MEDIFORCE_API_KEY` as the `X-Api-Key` header — it must match
`PLATFORM_API_KEY` in `packages/platform-ui/.env.local` (the `.env.example`
default is `test-api-key`). Add to your shell profile (`~/.zshrc` /
`~/.bashrc`), then reload your shell:

```bash
export MEDIFORCE_API_KEY="test-api-key"   # match PLATFORM_API_KEY in .env.local
export MEDIFORCE_BASE_URL="http://127.0.0.1:9003"
# Use 127.0.0.1, not localhost — Node prefers IPv6 and the dev server binds
# IPv4, which surfaces as a misleading "fetch failed".
```

```bash
pnpm exec mediforce --help
pnpm exec mediforce workflow list
```

See the [use-mediforce skill](.claude/skills/use-mediforce/SKILL.md) for the full
command list and the REST fallback ladder.

---

## 4. Add your first workflow

Workflows are defined in JSON. Create them via API or UI.

### Via API

```bash
curl -X POST "http://localhost:9003/api/workflow-definitions?namespace=my-namespace" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: test-api-key" \
  -d '{
    "name": "my-first-workflow",
    "description": "A simple workflow to get started",
    "preamble": "This workflow demonstrates the basic structure.",
    "triggers": [
      { "name": "manual", "type": "manual" }
    ],
    "steps": [
      {
        "id": "do-work",
        "name": "Do the Work",
        "type": "creation",
        "executor": "human",
        "allowedRoles": ["operator"]
      },
      {
        "id": "review",
        "name": "Review",
        "type": "review",
        "executor": "human",
        "allowedRoles": ["reviewer"],
        "verdicts": {
          "approve": { "target": "done" },
          "revise": { "target": "do-work" }
        }
      },
      {
        "id": "done",
        "name": "Done",
        "type": "terminal",
        "executor": "human"
      }
    ],
    "transitions": [
      { "from": "do-work", "to": "review" }
    ]
  }'
```

The API returns:
```json
{ "success": true, "name": "my-first-workflow", "version": 1 }
```

**Key concepts:**
- `namespace` — groups your workflows (used in query param)
- `name` — unique workflow identifier within namespace
- `triggers` — how workflows start (manual, cron, etc.)
- `steps` — human tasks, agent tasks, or both
- `transitions` — rules for moving between steps
- `verdicts` — for review steps, define where each outcome goes

**Step types:** `creation` (creates/modifies data), `review` (human verdict),
`decision` (conditional branch), `terminal` (end).

**Executor types:** `human`, `agent` (AI), `script` (Docker container),
`cowork` (interactive session).

### Via UI

1. Go to http://localhost:9003/catalog
2. Click "Create Workflow"
3. Use the visual editor to add steps and transitions
4. Save

---

## 5. Run your first workflow

### Via API

```bash
curl -X POST http://localhost:9003/api/processes \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: test-api-key" \
  -d '{
    "definitionName": "my-first-workflow",
    "triggeredBy": "test-user"
  }'
```

Returns:
```json
{ "run": { "id": "proc-abc123", "status": "running", "definitionName": "my-first-workflow", ... } }
```

### Via UI

1. Go to http://localhost:9003/workflows
2. Click your workflow → "Run"
3. Configure variables if needed → Start

**What happens:** a new process instance is created, execution begins at the
first step, and tasks appear in the Tasks view as it progresses.

---

## 6. Build your own workflow

Workflows combine human tasks and AI agent tasks with configurable autonomy.

### Autonomy levels

| Level | Agent role     | Human involvement        |
|-------|----------------|--------------------------|
| L0    | None           | Full human control       |
| L1    | Suggests       | Human decides            |
| L2    | Drafts         | Human approves           |
| L3    | Acts, reviews  | Periodic human review    |
| L4    | Autonomous     | Exception handling only  |

### Example: document review with AI assistance

```json
{
  "name": "document-review",
  "description": "Upload documents, AI analyzes, human reviews",
  "preamble": "Review uploaded documents with AI assistance.",
  "triggers": [
    { "name": "manual", "type": "manual" }
  ],
  "steps": [
    {
      "id": "upload",
      "name": "Upload Documents",
      "type": "creation",
      "executor": "human",
      "ui": {
        "component": "file-upload",
        "config": {
          "acceptedTypes": ["application/pdf"],
          "maxFiles": 5
        }
      }
    },
    {
      "id": "analyze",
      "name": "AI Analysis",
      "type": "creation",
      "executor": "agent",
      "autonomyLevel": "L2",
      "plugin": "opencode-agent",
      "agent": {
        "skill": "analyze-documents",
        "skillsDir": "apps/document-review/skills",
        "model": "sonnet"
      }
    },
    {
      "id": "review",
      "name": "Review Results",
      "type": "review",
      "executor": "human",
      "allowedRoles": ["reviewer"],
      "verdicts": {
        "approve": { "target": "done" },
        "revise": { "target": "analyze" }
      }
    },
    {
      "id": "done",
      "name": "Done",
      "type": "terminal",
      "executor": "human"
    }
  ],
  "transitions": [
    { "from": "upload", "to": "analyze" },
    { "from": "analyze", "to": "review" }
  ]
}
```

**Note:** The `skillsDir` path (`apps/document-review/skills`) is illustrative.
Create it if you're building a custom plugin, or reference an existing one like
`apps/community-digest/plugins/community-digest/skills`.

**See real examples:**
- `apps/community-digest/src/community-digest.wd.json` — Daily GitHub digest
- `apps/protocol-to-tfl/src/protocol-to-tfl.wd.json` — Clinical protocol to TFL

---

## Auth & test setup (optional)

You only need this for cloud Firebase Auth/Storage or for running the E2E
suite — **not** for the data layer (Postgres covers that).

### Firebase emulators (for E2E / auth tests)

The Firebase Auth + Storage emulators back authentication in `dev:mock` and the
Playwright suite. They are **not** a data backend.

```bash
pnpm emulators     # Auth :9099, Storage :9199
```

### Your own Firebase project (cloud Auth)

To run against real Firebase Auth instead of emulators:

1. [Firebase Console](https://console.firebase.google.com/) → Add project.
2. Enable **Authentication** → Email/Password provider.
3. Project Settings → General → Your apps (`</>`) → copy the web config.
4. Project Settings → Service Accounts → **Generate new private key**; save the
   JSON outside the repo (e.g. `~/.config/mediforce/firebase-sa.json`).

Configure `packages/platform-ui/.env.local`:

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project
PLATFORM_API_KEY=your-secret-key
GOOGLE_APPLICATION_CREDENTIALS=/Users/<you>/.config/mediforce/firebase-sa.json
# optional: OPENROUTER_API_KEY for agent LLM calls
```

Use an absolute path for `GOOGLE_APPLICATION_CREDENTIALS` — the server validates
the file exists on startup.

---

## 7. Troubleshooting

### `DATABASE_URL is required` (FATAL at boot)

You're in a non-mock mode without a database. Run `pnpm dev` (starts Postgres),
or set `DATABASE_URL` if you have your own. `pnpm dev:mock` is the only mode that
runs without it.

### Port 9003 already in use

```bash
lsof -ti:9003 | xargs kill -9
```

Or run on another port: `PORT=9999 pnpm dev`.

### `docker compose` hangs / Postgres won't start

Docker isn't running — start Docker Desktop (or the engine), then retry.

### `pnpm dev` exits with "Docker Compose v2 is not installed"

`docker compose version` fails because the engine-only `docker.io` package ships
without Compose. Install it:

```bash
sudo apt install docker-compose-v2   # Ubuntu / Debian
```

Docker Desktop (macOS/Windows) already includes Compose — make sure it's running
and up to date. `pnpm dev` now preflight-checks this and stops with an
actionable message instead of booting against a missing database.

### Migration error / `relation "..." does not exist`

```bash
pnpm db:migrate
```

### Reset local data

Wipes the persistent Postgres volume and starts fresh:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v && pnpm dev
```

### Emulators fail to start

Re-run `pnpm emulators`. If a port is occupied it prompts to kill the blocker;
if Java is missing, `brew install openjdk@21` (macOS) or
`apt-get install openjdk-21-jre` (Linux).

### Workflow POST returns 400

Check: `namespace` query param present, valid step `type`
(`creation`/`review`/`decision`/`terminal`), required fields (`name`,
`triggers`, `steps`, `transitions`).

### `mediforce: missing API key`

`MEDIFORCE_API_KEY` isn't set, or doesn't match `PLATFORM_API_KEY` in
`packages/platform-ui/.env.local`. See [Authenticate](#3-run-the-cli) above.

### Workflow run fails with `Unable to find image '...' locally`

A `script` executor step needs a Docker image that's built locally, not
pulled from a registry. Run `./scripts/rebuild-docker-images.sh` (see [Build
images for script-executor steps](#build-images-for-script-executor-steps)).

---

## Commands reference

| Command                | Description                                       |
|------------------------|---------------------------------------------------|
| `pnpm install`         | Install dependencies                              |
| `pnpm dev:mock`        | Mocked agents + emulator demo data, port 9007     |
| `pnpm dev`             | Full local stack: Postgres + migrate + UI, 9003   |
| `pnpm dev:no-docker`   | Docker-free; UI + host `claude` agents (needs Postgres on :5432) |
| `pnpm dev:queue`       | `dev` + Redis + BullMQ queued agent execution     |
| `pnpm emulators`       | Firebase Auth + Storage emulators                 |
| `pnpm db:generate`     | Generate a migration (drizzle-kit)                |
| `pnpm db:migrate`      | Apply migrations                                  |
| `pnpm test:unit`       | vitest unit + integration                         |
| `pnpm test:affected`   | vitest, only changed files                        |
| `pnpm test:e2e`        | All Playwright E2E (L3 + L4)                       |
| `pnpm build:e2e`       | Rebuild the Next.js bundle for E2E (emulator URLs baked in). Run after any schema, Zod, or handler change — `test:e2e` reuses the existing `.next` build and will silently run stale code otherwise. |
| `pnpm test`            | Everything (unit + e2e)                           |

---

## Next steps

- [Dev quick reference](docs/dev-quickref.md) — terse command/decision/port lookup
- [Development Guide](docs/development.md) — monorepo structure, testing, deployment
- [Postgres local dev](docs/postgres-local-dev.md) — reset, migrations, inspecting the DB
- [Architecture](docs/architecture.md) — processes, steps, agents, compliance
- [AGENTS.md](AGENTS.md) — contribution guidelines for AI-assisted development
