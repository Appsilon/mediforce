# Landing Zone — onboarding a new study

## Audience

You are a data manager about to onboard a new clinical-trial study to the Mediforce Landing Zone. This guide assumes the platform itself is already deployed — your task is to register one new study against it.

## Pattern

**One GitHub repository per study.** Each study has a dedicated repo that holds the study's contract (`config.yaml`), its CODEOWNERS for review, and templates for future cleaning rules. The canonical example is [`Appsilon/mediforce-landing-zone-study-demo`](https://github.com/Appsilon/mediforce-landing-zone-study-demo) — the demo for `CDISCPILOT01`.

Why per-study, not per-namespace or monorepo:

- **Separation of concerns.** Data managers own the study contract. Engineers own the platform. They evolve at different rates and need different review cadences.
- **Granular CODEOWNERS.** Each study can require sign-off from the specific data managers responsible for it without coupling them to every other study's reviews.
- **Self-contained audit trail.** The contract changes for one study live in one place; rolling back or auditing is straightforward.
- **Forkable template.** New studies start from a copy of the demo repo, so the layout stays consistent.

## Steps

### 1. Create a new GitHub repository from the demo

Either use the demo as a template (GitHub UI: "Use this template") or copy the structure manually. Suggested name:

```
mediforce-landing-zone-{STUDY_ID}
```

with `{STUDY_ID}` lowercased (e.g. `mediforce-landing-zone-cdiscpilot02`). Make the repo public unless the sponsor requires otherwise.

### 2. Edit `config.yaml`

In the new repo, update `config.yaml`:

- `studyId` — the canonical identifier (uppercase, must match the workflow definition's env var).
- `title` — full study title.
- `sponsor` and `cro` — names.
- `contract.expectedDeliveries[]` — cadence (`weekly`, `monthly`, `ad-hoc`), day, and required SDTM/ADaM domains for each expected delivery type.
- `sftp.host` — leave as `host.docker.internal` placeholder; the **real** CRO host belongs in workflow secrets, not in this file.
- `validation.standard` / `igVersion` / `rulesets` — pick the validation profile matching the study phase.

### 3. Set CODEOWNERS

Replace the placeholder in `CODEOWNERS` with the team handle for the data managers responsible for this study, e.g.:

```
* @appsilon/data-managers-cdiscpilot01
```

GitHub will then auto-request review from that team on every PR that touches `config.yaml`.

### 4. Create the workflow definition

In the Mediforce platform UI (or by editing a JSON file in the platform monorepo), create a workflow definition for the study. The fastest path is to copy `apps/landing-zone/src/landing-zone-CDISCPILOT01.wd.json` and adjust:

- `name` — `landing-zone-{STUDY_ID}` (lowercase study id)
- `title` and `description` — study-specific
- `env.STUDY_ID` and the `*_<STUDY_ID>` secret refs
- `workspace.remote` — `"{org}/{repo}"`, e.g. `"Appsilon/mediforce-landing-zone-cdiscpilot02"`
- `workspace.remoteAuth` — `"GITHUB_TOKEN"` (this is the **name** of a workflow secret, not the token itself)

### 5. Configure workflow secrets

Workflow secrets are scoped **per-WD** (per workflow definition), not per-namespace. In the platform UI, on the workflow definition's secrets page, set:

- `SFTP_HOST_<STUDY_ID>` — real CRO SFTP hostname
- `SFTP_USER_<STUDY_ID>` — SFTP username
- `SFTP_PASS_<STUDY_ID>` — SFTP password / key passphrase
- `GITHUB_TOKEN` — a Personal Access Token (or fine-grained token) with `repo` scope on the study repo, so the runtime can clone configs and (in v0.2) push cleaning-rule PRs

Each new study needs its own secrets — they do not share across studies.

### 6. Register the workflow definition

Use the CLI to register the WD against the running platform:

```bash
mediforce workflow register \
  --file apps/landing-zone/src/landing-zone-{study-id}.wd.json \
  --namespace <namespace> \
  --base-url http://127.0.0.1:9003
```

Replace `--base-url` with the production endpoint when registering against the deployed platform.

### 7. Verify with a manual run

Trigger a manual run to confirm the SFTP poll → validate → human-review pipeline works end-to-end:

```bash
mediforce run start \
  --workflow landing-zone-{study-id} \
  --base-url http://127.0.0.1:9003
```

Watch the run in the UI. The first poll should list whatever is currently on the CRO SFTP; if there are deliveries, validation should run and produce an HTML report for human review.

## What stays in the platform monorepo

The study repo only owns the **contract** and **config**. Everything else stays in the platform monorepo (`Appsilon/mediforce`):

- Skills (the prompts agents run): `apps/landing-zone/plugins/landing-zone/skills/`
- Scripts (SFTP poll, validate, accept-delivery): `apps/landing-zone/scripts/`
- Container Dockerfile and image build: `apps/landing-zone/Dockerfile`
- Plugin code (the runtime container plugin): `apps/landing-zone/plugins/landing-zone/`
- Workflow definitions: `apps/landing-zone/src/*.wd.json`

Updating any of these is a platform-engineering change, not a data-manager change. Updating `config.yaml` is the reverse — a data-manager change with no platform code involved.

## v0.1 limitations and v0.2+ roadmap

See [`apps/landing-zone/FUTURE.md`](../apps/landing-zone/FUTURE.md) for the full roadmap. Highlights relevant to onboarding:

- **v0.1**: per-run audit trails (one branch per workflow run, with every script output and human verdict committed) accumulate inside the platform host's local bare repo. They do **not** push to the study GitHub repo.
- **v0.2**: cleaning-rules-PR pattern. A new step in the workflow will detect deterministic value mismatches (e.g. `NY` vs `New York`), generate a feature branch on the study repo, and open a pull request proposing the mapping rule. Reviewing data managers approve or reject; merged rules feed back into validation. The `templates/cleaning-rule.template.yaml` file in the study repo is the placeholder for that shape.
