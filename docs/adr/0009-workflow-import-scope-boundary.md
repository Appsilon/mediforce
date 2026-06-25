---
status: accepted
---

# Workflow git import is a one-time copy from public GitHub only

Importing a Workflow Definition from git fetches a single `.wd.json` over the
public `raw.githubusercontent.com` endpoint, validates it through the same path
as `workflow register`, and stores it as a normal versioned definition with a
`source: { repo, path, commit }` provenance record. The import is a **one-time
copy**: there is no live link back to the repo and no automatic sync — updating
an imported workflow means re-importing, which creates a new version. Scope is
deliberately bounded to **public GitHub repos** (no auth header is sent;
non-GitHub hosts are rejected).

## Considered options

- **Live sync / subscription** to the upstream repo (re-pull on push). Rejected:
  it makes the upstream the source of truth, which collides with the platform's
  versioning, namespace secrets, and audit model, and turns a benign read into
  an ongoing trust + availability dependency. A copy keeps the Deployment
  self-contained and auditable; the immutable `source.commit` still records
  exactly what was imported if a future "check for updates" affordance is wanted.
- **Private repos / other hosts (GitLab, Bitbucket, self-hosted) now.** Deferred:
  each needs an auth + token-storage story (where the clone token lives, who can
  use it) that is out of scope for the first cut. The handler rejects them
  explicitly rather than failing obscurely.

## Consequences

- Required secrets are **not** carried by import — they must be configured in the
  target namespace before a run, identical to `workflow register`. Import success
  does not imply run-readiness.
- Adding sync, private-repo, or non-GitHub support later reopens this ADR; the
  stored `source.commit` is the forward-compatible hook for an update check.
