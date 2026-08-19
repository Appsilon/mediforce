---
status: living
audience: operators
last_reviewed: 2026-08-19
---

# Landing Zone — onboarding a new study

For a data manager registering one new clinical-trial study against an already-deployed Mediforce platform.

Prerequisite: the `mediforce-landing-zone:latest` image exists on the platform host (`scripts/rebuild-docker-images.sh` builds it). All studies share it — build once, not per study.

## One repo per study

Each study gets its own GitHub repo holding the contract (`config.yaml`), the study-owned validation layer (`validation-rules.yaml`, `validate_custom.R`), `templates/`, and `CODEOWNERS`. Data managers own that repo; engineers own the platform monorepo. Separate repos keep review cadence, sign-off, and audit trail per study.

Canonical example: [`Appsilon/mediforce-landing-zone-study-demo`](https://github.com/Appsilon/mediforce-landing-zone-study-demo) — the demo for `CDISCPILOT01`. Fork it for every new study.

## 1. Create the study repo

GitHub UI → "Use this template" on the demo repo. Name it `mediforce-landing-zone-{study-id}` (lowercase, e.g. `mediforce-landing-zone-cdiscpilot02`). Public unless the sponsor requires otherwise.

## 2. Edit `config.yaml`

- `studyId`, `title`, `sponsor`, `cro`
- `contract.timeline` — enrollment start, last-patient-last-visit, database lock, submission target, `currentPhase`
- `contract.expectedDeliveries[]` — per delivery type: `cadence` (`weekly` / `monthly` / `ad-hoc`), `day`, `slaHours`, `requiredDomains`
- `sftp` — leave `host: host.docker.internal` and the other fields as placeholders; the real CRO endpoint belongs in workflow secrets, never in this file
- `validation` — `standard`, `igVersion`, `rulesets`, `defineXml`, `routerThresholds`, `customRules`

No runtime step reads `config.yaml` today — it is the human-readable contract. The executable copy is the workflow definition's `env` block (step 5), so keep the two in sync: `requiredDomains` → `EXPECTED_DOMAINS`, `validation.standard` → `VALIDATION_STANDARD`, `validation.igVersion` → `VALIDATION_IG_VERSION`, `studyId` → `STUDY_ID`.

## 3. Keep the study validation layer

`validate_custom.R` and `validation-rules.yaml` stay in the repo — the workflow clones it to `/workspace`, and the `validate-custom` step reads both from there. If either is missing, that step emits a failure envelope instead of findings. Start from the demo's copies and `templates/validation-rules.template.yaml`.

## 4. Set CODEOWNERS

Replace the placeholder with the team handle for the responsible data managers:

```
* @appsilon/data-managers-cdiscpilot01
```

GitHub then auto-requests their review on every PR touching the contract — including the rules PRs the workflow opens itself.

## 5. Create the workflow definition

Copy `apps/landing-zone/src/landing-zone-CDISCPILOT01.wd.json` and adjust:

- `name` — `landing-zone-<STUDY_ID>`, study id verbatim (uppercase, as in the demo); the filename follows
- `title` and `description` — study-specific
- `env.STUDY_ID`, `env.EXPECTED_DOMAINS`, `env.VALIDATION_*`, and the `{{SECRET_<STUDY_ID>}}` refs
- `workspace.remote` — `"{org}/{repo}"` from step 1
- `workspace.remoteAuth` — `"GITHUB_TOKEN"` (the **name** of a secret, not the token itself)

## 6. Set workflow secrets

Secrets are scoped per workflow definition:

```bash
pnpm exec mediforce secret set \
  --namespace <namespace> \
  --workflow landing-zone-<STUDY_ID> \
  --key SFTP_PASS_<STUDY_ID> --stdin
```

| Secret | Value |
|---|---|
| `SFTP_HOST_<STUDY_ID>`, `SFTP_USER_<STUDY_ID>`, `SFTP_PASS_<STUDY_ID>` | Real CRO SFTP endpoint and credentials |
| `CRO_CONTACT_EMAIL_<STUDY_ID>` | Recipient of the rejection email |
| `DATA_MANAGER_EMAIL_<STUDY_ID>` | `replyTo` on that email |
| `GITHUB_TOKEN` | Token with `contents:write` + `pull-requests:write` on the study repo — clones the config and pushes rules PRs |
| `OPENROUTER_API_KEY` | Model access for the agent steps |

Study-suffixed secrets are per study and never shared. The two unsuffixed ones can be set workspace-level (omit `--workflow`) so every study reuses them.

## 7. Register the workflow definition

```bash
pnpm exec mediforce workflow register \
  --file apps/landing-zone/src/landing-zone-<STUDY_ID>.wd.json \
  --namespace <namespace>
```

Add `--base-url <url>` to target a deployed platform (default `http://localhost:9003`); `--dry-run` schema-checks the file without calling the API.

## 8. Verify with a manual run

```bash
pnpm exec mediforce run start \
  --workflow landing-zone-<STUDY_ID> \
  --namespace <namespace>
```

Watch the run in the UI. The first poll lists whatever is currently on the CRO SFTP; if there are new files, CDISC validation and the study's R rules run, and an HTML report lands in the human-review task.

## What stays in the platform monorepo

The study repo owns the contract and its validation rules. Everything else is a platform-engineering change in `Appsilon/mediforce`:

- `apps/landing-zone/scripts/` — SFTP poll, CDISC validation, custom-validation wrapper, accept-delivery, rules PR
- `apps/landing-zone/plugins/landing-zone/skills/` — agent prompts (`data-validator`, `draft-rejection-note`, `propose-rules`)
- `apps/landing-zone/container/Dockerfile` — the shared image
- `apps/landing-zone/src/*.wd.json` — workflow definitions

## Audit trail and the rules loop

- Each run commits its step outputs and human verdicts to a `run/<runId>` branch in a bare repo on the platform host. Those branches are never pushed — the study repo only ever receives rules PRs.
- After a rejection the workflow drafts a CRO note, emails it, then proposes new `validation-rules.yaml` entries for human approval; approving opens a PR against the study repo's `main`.

Roadmap: [`apps/landing-zone/FUTURE.md`](../../apps/landing-zone/FUTURE.md).
