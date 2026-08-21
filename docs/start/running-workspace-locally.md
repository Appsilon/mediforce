---
status: living
audience: engineers
last_reviewed: 2026-08-19
---

# Running the workspace demo locally

End-to-end flow for clicking through the run-scoped git workspace with real
Docker execution — dogfooding the feature before it hits staging.

Needs Docker running. Everything else `pnpm dev:mock` does for you: it starts
Postgres, applies migrations, seeds the demo user and fixture, and bakes in the
env below.

## 1. Start

```bash
pnpm dev:mock
```

Serves Next on port **9007** with:
- `MOCK_AGENT=true` — LLM agent plugins run the mock bash command instead of
  Claude/OpenCode. Script-container steps are unaffected — they run real scripts.
- `MEDIFORCE_DATA_DIR=/tmp/mediforce-e2e-data` — workspace bare repos + worktrees
  land here instead of `~/.mediforce`
- `NEXT_PUBLIC_APP_URL` / `APP_BASE_URL` on :9007 — self-calls hit the right port
- `NO_PROXY=localhost,127.0.0.1` — defends against corporate proxies that mangle
  self-calls

Full override list: [dev-quickref.md](dev-quickref.md#devmock-env-overrides).

## 2. Click through the UI

1. Open `http://localhost:9007`, sign in as `test@mediforce.dev` / `test123456`
2. Navigate to workflows → **Sales CSV Report** — a two-step pipeline that
   exercises the workspace (generates `data/sales.csv`, summarises to
   `report/summary.md`)
3. Trigger a manual run
4. Watch it progress through `generate-data` → `summarize` → `done`

## 3. Inspect artefacts on disk

```bash
WDIR="/tmp/mediforce-e2e-data/worktrees/test/Sales CSV Report"
ls "$WDIR"/                                    # worktree per run
cat "$WDIR"/*/data/sales.csv                   # step 1 output
cat "$WDIR"/*/report/summary.md                # step 2 output
git --git-dir="/tmp/mediforce-e2e-data/bare-repos/test/Sales CSV Report.git" \
    log --oneline --all
```

The bare repo holds one `run/<runId>` branch per trigger, each with three
commits: the seed `.gitignore`, step 1's `generate-data`, and step 2's
`summarize`.

## Reset between runs

Database state and workspace state are independent.

```bash
pnpm seed                       # re-seed the test user + fixture into Postgres
rm -rf /tmp/mediforce-e2e-data  # wipe workspace state
```

## Troubleshooting

- **Redirected back to `/login` in a loop** — `AUTH_SECRET` changed between
  restarts, invalidating the session cookie. `dev:mock` bakes a fixed one, so
  this means something else exported it; unset it and re-seed.
- **Trigger returns 201 but run stays in `created`** — the auto-runner self-call
  can't reach :9007. Check `NEXT_PUBLIC_APP_URL` / `NO_PROXY` weren't overridden.
- **Docker step fails** — check `docker ps -a` for the container. Test the daemon
  with `docker run --rm debian:bookworm-slim echo ok`.
- **Worktree exists but no commits** — the step's bash command didn't write to
  `/workspace`. Check `scripts/examples/sales-csv-report.wd.json`.
