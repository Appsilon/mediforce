# Landing Zone

Auto-ingest workflow for clinical trial data deliveries from CRO SFTP servers.

The system polls a CRO SFTP server, detects new deliveries, validates them against CDISC standards, and routes them through a Human-in-the-Loop approval flow. Goal: catch data quality issues before they reach downstream pipelines, with the agent doing the heavy lifting and humans deciding only where judgment is required.

## Architecture overview

```
[cron */1 *] → sftp-poll → validate-script → interpret-validation → human-review ──┬─ accept-delivery → accepted
                  │                                                                │
                  └─ no-deliveries (terminal)                                       └─ draft-rejection-note → rejected-with-note
```

| Step | Executor | Purpose |
|------|----------|---------|
| `sftp-poll` | script | Diff SFTP listing vs `previousRun.previousListing`, output `newFiles` |
| `validate-script` | script | Run CDISC CORE rules engine; catch errors internally, write `scriptStatus` |
| `interpret-validation` | agent (Claude Code) | Read findings + `scriptStatus`, classify, render HTML report |
| `human-review` | human | Review HTML report in task UI; accept or reject |
| `accept-delivery` | script | Copy files to `data/lake/`, hash, write status |
| `draft-rejection-note` | agent (Claude Code) | Compose rejection note for operator to forward to CRO |

## Why "landing zone"

Borrowed from data engineering — the first staging area where raw data arrives before being processed. In pharma context: the buffer between CRO and the sponsor's analytics pipelines, where contract-level expectations meet reality.

## Status

**v0.1 in progress** — single hardcoded study (`CDISCPILOT01`), mock SFTP via docker-compose, local data lake.

See [`FUTURE.md`](FUTURE.md) for deferred items and roadmap (v0.2–v0.6).

## Layout

```
apps/landing-zone/
  README.md                     This file
  FUTURE.md                     Deferred items + roadmap
  PITCH.md                      Landing-page-ready overview (non-technical)
  container/Dockerfile          mediforce-golden-image + cdisc-rules-engine
  docker-compose.sftp.yml       Mock SFTP via atmoz/sftp
  studies/
    CDISCPILOT01/
      config.yaml               Contract, schedule, expected files
      data/                     Demo data: clean / injection / mess variants
  src/
    landing-zone-CDISCPILOT01.wd.json
    scripts/
      sftp_poll.py
      validate.py
      accept_delivery.py
  plugins/landing-zone/
    skills/
      data-validator/SKILL.md
      draft-rejection-note/SKILL.md
```

## Local development

For v0.1 the workflow runs against a local mock SFTP server (`atmoz/sftp` in Docker), not a real CRO endpoint. Hetzner staging is v0.2+.

### Start the mock SFTP

From the repo root:

```bash
docker compose -f apps/landing-zone/docker-compose.sftp.yml up -d
```

This binds `127.0.0.1:2222` to the SFTP container and mounts `sample-data/sftp-staging/` as the `cro` user's `/upload` dir. Credentials are `cro` / `cro` — local dev only, not a real secret.

### Drop demo files

```bash
python apps/landing-zone/scripts/seed_sftp.py --variant clean
```

Available variants: `clean`, `injection`, `mess-late`, `mess-encoding`, `mess-missing-domain`, `mess-inconsistent-values`. The `mess-late` variant additionally backdates file mtimes by 14 days to simulate an overdue delivery against `contract.expectedDeliveries[].cadence`. The script clears `sftp-staging/` first so each call models a fresh delivery.

The variant directories under `sample-data/{variant}/` are populated by the demo data prep step (separate task); the seed script fails gracefully if they are missing.

### Test the connection

```bash
sftp -P 2222 cro@localhost
# password: cro
```

You should see the files dropped by `seed_sftp.py` under the user's home directory at `upload/`.

### Stop the mock SFTP

```bash
docker compose -f apps/landing-zone/docker-compose.sftp.yml down
```

## References

- [PR #213](https://github.com/Appsilon/mediforce/pull/213) — per-run git worktree (workspace foundation)
- [PR #217](https://github.com/Appsilon/mediforce/pull/217) — `inputForNextRun` (SFTP listing carry-over)
- [`docs/PREVIOUS_RUN.md`](../../docs/PREVIOUS_RUN.md) — carry-over mechanism docs
- [`docs/running-workspace-locally.md`](../../docs/running-workspace-locally.md) — workspace setup
