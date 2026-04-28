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
  Dockerfile.cdisc              python:3.12-slim + cdisc-rules-engine (TBD)
  docker-compose.sftp.yml       Mock SFTP via atmoz/sftp (TBD)
  legacy/
    pawel.md                    Pre-workshop draft (CDISC CORE 9-step plan, partially reused)
    scope.md
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

## References

- [`legacy/pawel.md`](legacy/pawel.md) — earlier 9-step plan; `validate.py` reuses the CDISC CORE wrapper concept and structured findings layout
- [PR #213](https://github.com/Appsilon/mediforce/pull/213) — per-run git worktree (workspace foundation)
- [PR #217](https://github.com/Appsilon/mediforce/pull/217) — `inputForNextRun` (SFTP listing carry-over)
- [`docs/PREVIOUS_RUN.md`](../../docs/PREVIOUS_RUN.md) — carry-over mechanism docs
- [`docs/running-workspace-locally.md`](../../docs/running-workspace-locally.md) — workspace setup
