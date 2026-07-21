<div align="center">

# Mediforce

**The open-source platform for human-agent collaboration in pharma**

Define processes. Assign humans and AI agents to each step. Ship compliant workflows — fast.

[Why Mediforce](#why-mediforce) | [How It Works](#how-it-works) | [See It in Action](#see-it-in-action) | [Get Involved](#get-involved)

</div>

---

## Why Mediforce

Pharma is ready for AI. The models are capable, the budgets exist, and the pressure to modernize is real. What's missing is the **infrastructure** — a way to deploy AI agents into regulated workflows with the compliance, auditability, and human oversight that GxP demands.

Mediforce is that infrastructure. Open-source, built for pharma, designed so your compliance team says yes on the first review.

**One platform, every process.** From clinical operations to pharmacovigilance to supply chain — define a process once, configure autonomy levels per step, and deploy. The first process is the hardest. Every one after that is incremental.

**Your rules, your control.** You decide how much autonomy each agent gets. An agent can draft and a human approves. Or the agent acts and a human reviews after the fact. The process stays the same; the configuration adapts to your organization's risk tolerance.

**Compliance is not a bolt-on.** Audit trails, accountability, data integrity, and scoped access are built into the platform from day one — not layered on top.

> **[Read the full vision — why this needs to exist and where we're headed](docs/vision.md)**

## How It Works

Processes are made of steps. Each step can be performed by a human, an AI agent, or both — with clear rules about who decides what.

### Configurable Control Modes

Every step is assigned a Control Mode (CM0–CM4) — the same picker used in the workflow designer's step-type popover:

| Mode | What it means |
|------|----------------|
| **No agent** `CM0` | Human, script, or automated action - no AI involved. Full manual control. |
| **Assist** `CM1` _(coming soon)_ | Human leads and does the work; AI reviews the result afterward. |
| **Cowork** `CM2` | Agent and human work together in real time, via chat or voice. |
| **Human review** `CM3` | Agent completes the step; a human reviews and approves before the workflow proceeds. |
| **Autonomous agent** `CM4` | Agent completes the step and the workflow advances on its own; a human can review after the fact via the audit trail. |

`executor` and `autonomyLevel` remain the underlying schema fields (unchanged); Control Mode is a UI-only classification layered on top — see [`docs/design/AUTONOMY-LEVELS-REFACTOR.md`](docs/design/AUTONOMY-LEVELS-REFACTOR.md).

At any mode, an agent can signal uncertainty and escalate to a human. This isn't a failure mode — it's how the system maintains safety in production.

### What Agents Actually Do

These aren't chatbots. Mediforce agents perform real cognitive work inside structured processes:

- **Document analysis** — review consent forms, flag missing fields, simplify language
- **Anomaly detection** — monitor metrics, alert on unusual patterns across sites
- **Report generation** — draft clinical summaries, compile safety narratives
- **Supply intelligence** — forecast demand, detect risk signals, optimize inventory
- **Quality checks** — validate data integrity, cross-reference against standards

Every agent operates under human oversight, with every action recorded in a complete audit trail.

## See It in Action

### Workflow Dashboard

All your workflows in one place — run counts, active status, and one-click access to any process execution.

<div align="center">
<img src="docs/features/workflow-home.gif" alt="Workflow dashboard showing process overview" width="720" />
</div>

### Human-in-the-Loop Review

The core decision point. Reviewers see full context from the agent's work and submit their verdict — approve, revise, or escalate.

<div align="center">
<img src="docs/features/task-approve-flow.gif" alt="Task approval flow with agent context" width="720" />
</div>

## Why Open Source

In regulated industries, trust and transparency are non-negotiable. Open source is the right model:

- **Full transparency** — your compliance team can inspect every line of code
- **Zero vendor lock-in** — you own your deployment, your data, your customizations
- **Shared standard** — instead of every company building their own AI integration layer, we build one together
- **Community-driven quality** — battle-tested by the people who use it

We're [Appsilon](https://appsilon.com) — we've been building open-source tools for life sciences for over a decade. Mediforce applies that same philosophy to the biggest opportunity in pharma today.

## Get Involved

We're building the standard for human-agent collaboration in pharma — and we're doing it in the open.

- **[Getting Started](GETTING-STARTED.md)** — set up your development environment
- **[Join our Discord](https://discord.gg/Hkb2K7YE)** — follow progress, ask questions, shape the roadmap
- **Star this repo** — helps others in pharma find us
- **Open an issue** — tell us what processes matter most to you

## Development

**[Getting Started Guide](GETTING-STARTED.md)** — Quick start with demo data, no setup required.

> **Datastore (ADR-0001).** Server data layer runs on self-hosted Postgres.
> See [`docs/postgres-local-dev.md`](docs/postgres-local-dev.md) and
> [`docs/adr/0001-firestore-to-postgres.md`](docs/adr/0001-firestore-to-postgres.md).


### Fastest start (no setup)

```bash
pnpm install
pnpm dev:mock        # port 9007, mocked agents, in-memory data + demo data
```

Open `http://localhost:9007`. Use this to click through the UI without configuring cloud keys, Docker, or real agents.

### Dev modes

| Command | What it gives you |
|---|---|
| `pnpm dev` | Default full local stack. Boots a local Postgres via the docker overlay, runs migrations, then starts the UI; agents run inline via Docker (no Redis). Auth via NextAuth (Postgres `auth_*` tables). The main dev loop. |
| `pnpm dev:mock` | In-memory data + mocked agents, port 9007. Sign in via NextAuth's password provider (seeded user). No cloud keys, no Docker. |
| `pnpm dev:no-docker` | Docker-free, UI-only. Agents run via host `claude` CLI instead of Docker. |
| `pnpm dev:queue` | Like `dev`, but agent execution goes through the BullMQ queue (production architecture). Boots `redis` alongside Postgres; requires the worker running — see below. |

### Postgres mode (ADR-0001)

Bring up Postgres and point the app at it. One command does all
of the above:

```bash
pnpm dev                                           # docker compose up + migrate + dev
```

Manual equivalent if you need to wire your own env (e.g. point at an
external Postgres):

```bash
docker compose up postgres -d                      # boot Postgres 16
# in packages/platform-ui/.env.local:
#   DATABASE_URL=postgresql://mediforce:mediforce@localhost:5432/mediforce
pnpm db:migrate                                    # apply Drizzle migrations once
pnpm dev                                           # start the app
```

`pnpm db:migrate` is idempotent — re-run after pulling new migrations
from main. Same script runs inside `pnpm dev` and inside the
production Dockerfile's CMD, so dev and prod share the migration path.
See [Staging / production ops](#staging--production-ops-postgres) below.

Authentication runs on NextAuth ([ADR-0002](docs/adr/)) — no Firebase project or
emulator needed. Set `AUTH_SECRET` (generate with `openssl rand -hex 32`) plus a
provider in `.env.local`: either `ENABLE_PASSWORD_AUTH=true` for email+password,
or `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` for Google sign-in.

Migration mechanics, schema authoring, and troubleshooting live in
[`docs/postgres-local-dev.md`](docs/postgres-local-dev.md).

### Queue mode (production architecture)

`docker-compose.yml` runs Postgres + Redis + container-worker + bull-board (BullMQ UI on :3100):

```bash
docker compose up -d       # bring up queue infra
pnpm dev:queue             # native UI pointed at compose Redis
docker compose down        # stop infra when you're done
```

### Own seed data

```bash
cp packages/platform-ui/.env.example packages/platform-ui/.env.local
pnpm seed                                        # seeds demo workflows + data
pnpm dev                                         # start the app
```

Demo credentials: `test@mediforce.dev` / `test123456` — sign in via NextAuth's
password provider (seeded user; needs `ENABLE_PASSWORD_AUTH=true`). For NextAuth
provider setup (Google client / `AUTH_SECRET`), see the
[Getting Started Guide](GETTING-STARTED.md).

### Tests

```bash
pnpm typecheck       # type checking (~5s)
pnpm test:unit       # vitest L1+L2 (~9s)
pnpm test:affected   # vitest, only files changed since main (<1s)
pnpm test:e2e        # Playwright L3+L4 (~4min, NextAuth password provider, no emulator)
pnpm test            # everything: test:unit + test:e2e
```

E2E variants:

```bash
pnpm test:e2e:api     # L3 only — API E2E, no browser (~30s)
pnpm test:e2e:ui      # L4 only — UI E2E with real Chromium
```

For UI-only journeys, run `pnpm test:e2e --project=authenticated` from the platform-ui directory (or invoke Playwright's interactive UI mode via `pnpm test:e2e:ui` there).

### CLI

`@mediforce/cli` is a thin wrapper around the platform API for registering
workflows, starting runs, and inspecting state from a terminal. The bin
entry runs `tsx` against `src/`, so changes show up without a build.

Run it from the workspace so it always uses the checked-out source:

```bash
pnpm exec mediforce --help
```

Auth + base URL come from env. Add to `~/.zshrc` (or the per-shell
session) so every invocation picks them up:

```bash
export MEDIFORCE_API_KEY="<value of PLATFORM_API_KEY in .env.local>"
export MEDIFORCE_BASE_URL="http://127.0.0.1:9003"
# Use 127.0.0.1 not localhost — Node prefers IPv6 and the dev server
# binds IPv4, which surfaces as a misleading "fetch failed".
```

Common commands:

```bash
pnpm exec mediforce workflow list                                        # all registered workflows
pnpm exec mediforce workflow register --file path/to.wd.json --namespace appsilon
pnpm exec mediforce run start --workflow landing-zone-CDISCPILOT01 --namespace appsilon
pnpm exec mediforce run get <runId>                                      # current status
pnpm exec mediforce <command> --help                                     # per-command flags
```

### Building Docker images for script steps

Workflows with `script` executor steps need Docker images built locally — none
are pulled from a registry. Build everything in one go:

```bash
./scripts/rebuild-docker-images.sh
```

This builds `mediforce-golden-image` and `mediforce-node` (used by most inline
`runtime: javascript` script steps, and as the fallback when a step omits
`agent.image`), plus the per-app images (`community-digest`, `protocol-to-tfl`,
`tealflow`, `landing-zone`).

Skip this if you only use `human` or `agent` executor steps, or run with `MOCK_AGENT=true`.

### Running agents without Docker

By default, agents execute inside Docker containers. To run them using your local `claude` CLI instead (useful for development and reducing costs):

```bash
pnpm dev:no-docker
```

> Requires `claude` to be available on your `PATH`. Use this script (not `ALLOW_LOCAL_AGENTS=true pnpm dev`) — the env var doesn't propagate reliably through pnpm script aliases.

> Full guide: **[docs/development.md](docs/development.md)**

## Staging / production ops (Postgres)

`docker-compose.prod.yml` ships a `postgres:16-alpine` service alongside
Redis. The host needs two things before `platform-ui` will start:

1. `POSTGRES_PASSWORD` set in `/opt/mediforce/.env` (no default — required).
   `POSTGRES_USER` + `POSTGRES_DB` default to `mediforce`.
2. `/var/lib/mediforce/postgres-data` exists on the host, owned by UID
   999 (the postgres-alpine user). `docker-compose.staging.yml` bind-mounts
   that path so `docker compose down -v` cannot wipe data — only an
   explicit `rm -rf` removes it. Local dev keeps a named volume, so
   `docker compose down -v` is still a normal reset workflow on a
   developer machine.

**Fresh server provisioning** is handled by
[`scripts/bootstrap-server.py`](scripts/bootstrap-server.py): it
auto-generates `POSTGRES_PASSWORD` (per ADR-0001, PR #559) and creates
the bind-mount data dir with the right ownership as part of its
`step_env_local` + `step_postgres_dir` flow on a new host.

**Already-bootstrapped deployments** (the current staging) — bootstrap
is not re-run against them. Add `POSTGRES_PASSWORD` + create the dir
manually via ssh.

Drizzle migrations run in a short-lived `migrate` compose service (init
container, see [`docker-compose.prod.yml`](docker-compose.prod.yml))
before `platform-ui` starts. `platform-ui` waits via
`depends_on: { migrate: { condition: service_completed_successfully } }`.
Idempotent (drizzle's `__drizzle_migrations` ledger). No separate
migration step in the deploy pipeline.


## Deep Dives

| | |
|---|---|
| **[Getting Started](GETTING-STARTED.md)** | Set up your development environment — local Postgres data layer plus NextAuth |
| **[Vision](docs/vision.md)** | Why this needs to exist, what agents actually do in pharma, and where we're headed |
| **[Architecture](docs/architecture.md)** | Processes, steps, agents, compliance — the technical foundation |
| **[How We Work](docs/how-we-work.md)** | Building bottom-up, in public, with real processes |
| **[Development](docs/development.md)** | Setup, monorepo structure, testing, deployment |

## License

Apache License 2.0 — see [LICENSE](LICENSE).

---

<div align="center">

*Built by [Appsilon](https://appsilon.com) — data solutions for life sciences since 2013.*

</div>
