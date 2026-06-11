# databricks-job

Deterministic plugin that triggers an **existing** Databricks job via the
Jobs REST API and returns its output as the step result. No LLM involved —
same execution class as [script-container](./script-container.md)
(confidence 1.0, errors fail the step and escalate, autonomy is not
applicable).

Source: `packages/agent-runtime/src/plugins/databricks/databricks-job-plugin.ts`
(REST client: `databricks-client.ts` alongside). Registered as
`databricks-job` in `getPlatformServices()`.

## Step shape

```jsonc
{
  "id": "run-sdtm-checks", "name": "Run SDTM checks", "type": "creation",
  "executor": "script", "plugin": "databricks-job",
  "databricks": {
    "jobId": 829471236054321,
    "notebookParams": { "study_id": "${steps.select-study.studyId}" },
    "pollIntervalMs": 10000,
    "timeoutMinutes": 60
  }
}
```

- `jobId` — id of a job that already exists in the customer's Databricks
  workspace. Job creation/deployment stays in their pipeline (Asset
  Bundles / Terraform); Mediforce only orchestrates runs. A string `jobId`
  supports `${steps.*}` interpolation.
- `notebookParams` / `jobParameters` — forwarded to `jobs/run-now`. Values
  support `${steps.*}` interpolation against earlier step outputs. Secrets
  are deliberately NOT an interpolation source (tokens must never reach
  Databricks run params or audit snapshots).
- `pollIntervalMs` (default 10 000) — run-state poll cadence.
- `timeoutMinutes` (default 30) — on expiry the plugin best-effort cancels
  the Databricks run, then fails the step.

## Secrets

`DATABRICKS_HOST` (workspace origin URL) and `DATABRICKS_TOKEN` (PAT,
`jobs` API scope) — set as namespace secrets; a per-workflow secret of the
same name overrides via the standard merge.

## Result contract

The notebook ends with `dbutils.notebook.exit(json.dumps({...}))`; the
plugin parses that JSON into `envelope.result`, so transitions can route on
`when: 'output.<key> == ...'`. Non-JSON output is wrapped as `{ raw }`.
v1 supports **single-task jobs only** — multi-task jobs fail with a clear
message. Databricks compute cost is not reflected in `totalCostUsd` (LLM
token cost only).

Manual L5 check: `scripts/databricks-spike.py` against a real workspace
(Free Edition works).
