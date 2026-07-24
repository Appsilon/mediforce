# Running the workspace demo locally

End-to-end flow for clicking through the run-scoped git workspace in the UI, with real Docker execution. Useful for dogfooding the feature before it hits staging.

## Prerequisites

- Docker daemon running (Postgres + agent containers)
- Node 24 + pnpm 10

## Steps

### 1. Configure env + bring up Postgres

```bash
cp packages/platform-ui/.env.example packages/platform-ui/.env.local
# set AUTH_SECRET (openssl rand -hex 32) and keep ENABLE_PASSWORD_AUTH=true
pnpm dev   # starts Postgres, runs migrations — Ctrl-C once it is up
```

Auth is NextAuth / Auth.js v5 with database sessions in Postgres (ADR-0002) —
there is no Firebase emulator to start.

### 2. Seed demo data

```bash
pnpm seed
```

Seeds the test user (an `auth_users` row with a bcrypt `password_hash`, so the
Credentials provider accepts it) and the workflow definitions into Postgres.
Includes the **Sales CSV Report** workflow — a two-step pipeline that exercises
the workspace (generates `data/sales.csv`, summarises to `report/summary.md`).

Credentials: `test@mediforce.dev` / `test123456`

### 3. Start dev server with workspace env

```bash
pnpm dev:mock
```

Runs Next on port **9007** with:
- `MOCK_AGENT=true` — LLM agent plugins run the mock bash command instead of Claude/OpenCode. Script-container is unaffected — runs real inline scripts.
- `MEDIFORCE_DATA_DIR=/tmp/mediforce-e2e-data` — workspace bare repos + worktrees land here instead of `~/.mediforce`
- `NEXT_PUBLIC_APP_URL=http://localhost:9007` — auto-runner self-calls hit the right port
- `NO_PROXY=localhost,127.0.0.1` — defends against corporate proxies that mangle self-calls

### 4. Click through the UI

1. Open `http://localhost:9007`, sign in as `test@mediforce.dev`
2. Navigate to workflows → **Sales CSV Report**
3. Trigger a manual run
4. Watch it progress through `generate-data` → `summarize` → `done`
5. Inspect artefacts on disk:

```bash
WDIR="/tmp/mediforce-e2e-data/worktrees/test/Sales CSV Report"
ls "$WDIR"/                                    # worktree per run
cat "$WDIR"/*/data/sales.csv                   # step 1 output
cat "$WDIR"/*/report/summary.md                # step 2 output
git --git-dir="/tmp/mediforce-e2e-data/bare-repos/test/Sales CSV Report.git" \
    log --oneline --all
```

The bare repo holds one `run/<runId>` branch per trigger, each with three commits: the seed `.gitignore`, step 1's `generate-data`, and step 2's `summarize`.

## Reset between runs

Database state + workspace state are independent.

```bash
# Re-seed the test user + fixtures into Postgres
cd packages/platform-ui && pnpm seed:dev

# Wipe workspace state
rm -rf /tmp/mediforce-e2e-data
```

## Troubleshooting

- **Redirected back to `/login` in a loop** — `AUTH_SECRET` is unset or changed between server restarts, which invalidates the session cookie. Set it in `.env.local` and re-seed.
- **Trigger returns 201 but run stays in `created`** — `NEXT_PUBLIC_APP_URL` / `NO_PROXY` unset; auto-runner self-call can't reach port 9007.
- **Docker step fails** — check `docker ps -a` for the container. Test with `docker run --rm debian:bookworm-slim echo ok`.
- **Worktree exists but no commits** — the step's bash command didn't write to `/workspace`. Check `scripts/examples/sales-csv-report.wd.json`.
