# Landing Zone — Future Items

Items deferred from v0.1 scope. Re-evaluate when phase noted starts.

## Configs storage — extract to dedicated repo (C1)

**v0.1:** Configs in monorepo at `apps/landing-zone/studies/{study-id}/config.yaml`.

**Future:** Move to dedicated repo `mediforce-landing-zone-study-demo` when any of:
- 2+ studies onboarded
- Separate review cadence needed for configs vs platform code
- Cleaning rules PR target (v0.2) makes more sense in dedicated repo (cleaner audit, separate access control for data managers)

At cutover: set `WD.workspace.remote = "Appsilon/mediforce-landing-zone-study-demo"`. Cleaning rules step pushes feature branch + opens PR there.

## SFTP integrity hash

**v0.1:** SFTP listing diff = `{filename, size, mtime}` only. Hash computed once on ingest (when copying file to `data/lake/`), stored in audit trail.

**Edge case missed:** CRO replaces file with same size+mtime in place. Rare but possible (deliberate manual fix, auto-tooling on CRO side).

**Add hash to listing if:** we hit that edge case in production. Cost: re-hash all SFTP files per poll = full download. Mitigation: hash only on `mtime > previousMtime || size != previousSize`, treat unchanged size+mtime as identical.

## Configurable approval RBAC

**v0.1:** Zero auth (demo mode).

**Future:** Reuse platform-core RBAC. Role `data-manager` per study in config (`approver: "filip@appsilon.com"`). Manager override role for cross-study escalations.

## Multi-study overview dashboard

**v0.1:** Zero new UI. Reuse `platform-ui` task UI + agent HTML reports.

**Future (v0.5+):** Build `apps/landing-zone/src/app/` dashboard when:
- 3+ studies onboarded
- Operator needs cross-study SLA monitoring ("co dziś spłynęło, co eskalowane, czy CRO X jest on track")
- Aggregated view of in-flight runs across all studies

## Real cloud lake

**v0.1:** `data/lake/` lokalnie + status flag.

**Future:** GCS bucket per study (`gs://mediforce-data-lake/{study}/{delivery-id}/`). Per-delivery hash manifest. Webhook signal dla downstream konsumentów po accept.

## Validation router → cleaning rules path (v0.2)

Skipped in v0.1. Adds:
- 4-class router output from agent B: `clean | minor-fix | recovery | escalate`
- `minor-fix` path → agent generates deterministic rules (NY → New York etc.) → commits to feature branch → opens PR to configs repo
- Loopback do `validate-script` po merge PR (re-run validation z zaaplikowanymi rules)

Wymaga: `WD.workspace.remote` (zob. C1 future).

## Missing data + CRO email path (v0.3)

Skipped in v0.1. Adds:
- Step `missing-data-handler` przed `sftp-poll` — porównuje delivery vs contract schedule, decyduje czy spóźnione
- Skill `cro-email-writer` — Claude Code z templates
- Approval gate dla email send (operator review draft, edit, send)
- Path z `escalate` z routera → cro-email

## Medical screening (v0.4)

Skipped in v0.1. Adds:
- Skill `medical-screener` — Claude Code + PubMed MCP
- Step `medical-screen` po `interpret-validation` (sekwencyjnie, G1 z dyskusji)
- Time-boxed medical team handoff: configurable timeout w configu, fallback `proceed-without-medical`
- Output: `medicalFlags`, dołączane do htmlReport

## Dynamic action router (v0.5)

Skipped in v0.1. Adds:
- Trial phase jako pole w study config (`phase: recruitment | mid | closeout | urgent`)
- Skill `action-router` — agent rekomenduje akcję wzgledem phase
- Bypass logic dla `urgent`/`closeout` (np. skip pełnego loop, direct-to-CRO escalation)
- Multi-study overview dashboard (zob. wyżej)

## Real SFTP infra

**v0.1:** docker-compose `atmoz/sftp` lokalnie (lub Hetzner staging od v0.2).

**Production:** SFTP creds w Mediforce secrets. Real CRO endpoints. Per-study creds w configu (reference do secret).

## Standalone landing-zone Next.js app

**v0.1:** Brak — używamy istniejącego `platform-ui` task UI.

**Future:** Jeśli okaże się że potrzebujemy custom UI (multi-study dashboard, drill-down do specific delivery, cleaning rules review interface poza GitHubem), wydzielamy `apps/landing-zone/src/app/` jako standalone Next.js (wzór: `apps/supply-intelligence`).
