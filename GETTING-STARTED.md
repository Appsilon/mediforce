# Getting Started

Zero to a running local Mediforce, first time. Once it runs, daily commands,
ports, env vars and troubleshooting live in
[docs/start/dev-quickref.md](docs/start/dev-quickref.md).

## Prerequisites

- **Node.js 24** (what CI runs) and **pnpm 10+**
  (`corepack enable && corepack prepare pnpm@latest --activate`).
- **Docker + Docker Compose v2.** Every mode needs it: Postgres is the only data
  backend (ADR-0001) and agent steps run in containers. Docker Desktop bundles
  Compose; on an engine-only Linux install add it separately —
  `sudo apt install docker.io docker-compose-v2`, then check
  `docker compose version`.

That is all you need to start. An API key (section 3), locally built agent images
([below](#build-images-for-script-executor-steps)) and a Google/OIDC client
([below](#google-or-oidc-sign-in-optional)) are each needed only for the specific
path that names them.

## 1. Fastest start — `pnpm dev:mock`

```bash
pnpm install
pnpm dev:mock
```

Open **http://localhost:9007** and sign in as `test@mediforce.dev` /
`test123456`.

[`dev-mock.py`](packages/platform-ui/scripts/dev-mock.py) starts the dev
Postgres, applies migrations, seeds that demo user plus a populated workspace,
and runs the UI with agents mocked and no cloud keys. "Mock" means mocked agents
and no cloud — **not** no database; it uses the same Docker Postgres as
`pnpm dev`. Best for UI work and for seeing the app full of data before
configuring anything real.

`MEDIFORCE_DEV_MOCK_SEED=false` skips the seed. Every other baked-in default is
overridable by exporting it — see dev-quickref § `dev:mock` env overrides.

## 2. Full local stack — `pnpm dev`

```bash
cp packages/platform-ui/.env.example packages/platform-ui/.env.local
# set AUTH_SECRET in that file:  openssl rand -hex 32
pnpm dev
```

Open **http://localhost:9003**. [`dev-infra.py`](scripts/dev-infra.py) brings up
Postgres and blocks on its healthcheck, `pnpm db:migrate` applies migrations,
then the UI runs with agents executing in real Docker containers.
`DATABASE_URL` is wired by the script.

Email + password sign-in is on unless you set `ENABLE_PASSWORD_AUTH=false`, but
unlike `dev:mock` this mode **seeds nothing** — the UI starts empty and no user
exists. Run `pnpm seed` once for the same demo user and fixture, or create
workflows yourself (sections 3–4).

Data persists in the `mediforce-dev-pgdata` volume under the `mediforce-dev`
compose project, so **every git worktree shares one Postgres and one dataset**,
and it survives restarts.

Other modes (`dev:no-docker`, `dev:queue`), the port map and the "which command"
table: [dev-quickref](docs/start/dev-quickref.md#which-dev-command).

### Build images for script-executor steps

Steps with `"executor": "script"` run in images that are **built locally, never
pulled** — `mediforce-golden-image:latest` (Node + tooling, the base for inline
`runtime: javascript` scripts) and `mediforce-node:latest` (the fallback when a
script step omits `script.image`). Build them plus the per-app agent images in
one go:

```bash
./scripts/rebuild-docker-images.sh
```

Re-run it after pulling changes to `packages/agent-runtime/container/` or any
`apps/*/container/Dockerfile`. Skip it entirely if you only run `dev:mock` or
workflows without `script` steps — without it a `script` step fails with
`Unable to find image '...' locally`.

## 3. Run the CLI

`mediforce` is the supported way to drive the platform from a terminal — the
dogfood rule is **CLI > REST**. Add to your shell profile and reload:

```bash
export MEDIFORCE_API_KEY="test-api-key"    # must match PLATFORM_API_KEY in .env.local
export MEDIFORCE_BASE_URL="http://127.0.0.1:9003"
# 127.0.0.1, not localhost — Node prefers IPv6 while the dev server binds IPv4,
# which surfaces as a misleading "fetch failed".
```

```bash
pnpm exec mediforce --help
pnpm exec mediforce workflow list
```

Full command list and the REST fallback ladder:
[use-mediforce skill](skills/use-mediforce/SKILL.md).

## 4. Register and run your first workflow

A workflow is a JSON definition ([`.wd.json`](docs/workflow-examples/README.md)).
Register one of the tutorial examples and start it — this one has a script step,
so build the images first:

```bash
pnpm exec mediforce workflow register \
  --file docs/workflow-examples/01-linear-pipeline.wd.json \
  --namespace test

pnpm exec mediforce run start --workflow tutorial-linear-pipeline --namespace test
pnpm exec mediforce run list --namespace test
```

`--namespace test` is the handle the seed creates; use your own workspace handle
otherwise. `workflow register --dry-run` schema-checks the file without calling
the API. In the UI the same thing lives at `/catalog` → **Create Workflow**, and
`/workflows` → your workflow → **Run**.

Where to go from a first run:

- What a workflow can do → [workflow-capabilities.md](docs/reference/workflow-capabilities.md)
- One example per concept → [workflow-examples/](docs/workflow-examples/README.md)
- Authoring end to end → [create-workflow.md](docs/guides/create-workflow.md)
- Rules a production workflow must satisfy →
  [workflow-authoring-golden-rules.md](docs/reference/workflow-authoring-golden-rules.md)

Workflows are **trigger-free**: how a run starts (manual, cron, webhook) is not
part of the definition. Manual start works by default; attach a schedule or
webhook afterwards with `mediforce workflow trigger-add` or the UI **Triggers**
tab ([ADR-0011](docs/adr/0011-triggers-detached-unified-resource.md)).

## Google or OIDC sign-in (optional)

Authentication is NextAuth (Auth.js v5) over the Postgres `auth_*` tables
(ADR-0002). Password sign-in covers local dev; add Google only if you want real
accounts:

1. [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services →
   Credentials → **Create OAuth client ID** (Web application).
2. Authorized redirect URI `http://localhost:9003/api/auth/callback/google`.
3. Put `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in
   `packages/platform-ui/.env.local`.
4. Set `ALLOWED_EMAIL_DOMAINS` — with an OAuth provider on, the `signIn` callback
   rejects every address outside the allowlist.

`OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` enable customer SSO the
same way. Every variable is documented in
[`packages/platform-ui/.env.example`](packages/platform-ui/.env.example).

## When it breaks

Symptom-to-fix table (missing `DATABASE_URL`, port in use, Compose v2 missing,
migration errors, resetting local data, missing API key, missing images):
[dev-quickref § Troubleshooting](docs/start/dev-quickref.md#troubleshooting).

Sign-in failing is the one first-run symptom not in that table: check
`AUTH_SECRET` is set in `packages/platform-ui/.env.local`, that you ran
`pnpm seed` (`pnpm dev` seeds no users), and — if `ALLOWED_EMAIL_DOMAINS` is set
— that your address matches it.

## Next steps

- [Dev quick reference](docs/start/dev-quickref.md) — commands, ports, env, tests
- [Development guide](docs/start/development.md) — conventions, deployment
- [Postgres local dev](docs/start/postgres-local-dev.md) — migrations, DB internals
- [Architecture](docs/concepts/architecture.md) — how the packages fit together
- [AGENTS.md](AGENTS.md) — how work is done in this repo
