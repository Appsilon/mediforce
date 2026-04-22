# Running the workspace demo locally

End-to-end flow for clicking through the run-scoped git workspace in the UI, with Firebase emulators and real Docker execution. Useful for dogfooding the feature before it hits staging.

## Prerequisites

- Docker daemon running
- Firebase CLI (`npm i -g firebase-tools`)
- Node 24 + pnpm 10

## Steps

### 1. Bootstrap emulators

```bash
python3 packages/platform-ui/scripts/bootstrap_e2e.py
```

Starts Firebase Auth (9099) + Firestore (8080), writes `.env.local` with demo creds, installs Playwright chromium and ffmpeg if missing. Idempotent — safe to re-run.

### 2. Seed demo data

```bash
cd packages/platform-ui
pnpm seed:dev
```

Seeds the test user + workflow definitions into the emulator Firestore. Includes the **Sales CSV Report** workflow — a two-step pipeline that exercises the workspace (generates `data/sales.csv`, summarises to `report/summary.md`).

Credentials: `test@mediforce.dev` / `test123456`

### 3. Start dev server with workspace env

```bash
cd packages/platform-ui
pnpm dev:test
```

Runs Next on port **9007** with:
- `NEXT_PUBLIC_USE_EMULATORS=true` — Firebase SDK points at emulators
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

Emulator data + workspace state are independent.

```bash
# Reset emulator Firestore + re-seed
cd packages/platform-ui && pnpm seed:dev

# Wipe workspace state
rm -rf /tmp/mediforce-e2e-data
```

## Troubleshooting

- **"Cannot connect to Firebase emulator"** — emulators died, re-run bootstrap.
- **Trigger returns 201 but run stays in `created`** — `NEXT_PUBLIC_APP_URL` / `NO_PROXY` unset; auto-runner self-call can't reach port 9007.
- **Docker step fails** — check `docker ps -a` for the container. Test with `docker run --rm debian:bookworm-slim echo ok`.
- **Worktree exists but no commits** — the step's bash command didn't write to `/workspace`. Check `scripts/examples/sales-csv-report.wd.json`.
