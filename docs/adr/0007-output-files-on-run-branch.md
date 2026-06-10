# Output Files live on the run branch of the git workspace

Status: accepted (2026-06-10)

Container agents write files into an ephemeral `/output` mount that is
deleted after each step — everything except one whitelisted-extension
"deliverable" was lost, and users had no way to list or download what an
agent produced. Meanwhile every Workflow Run already provisions a git
worktree (`/workspace`) backed by a local bare repo, committed after every
step (success or failure) on a never-pushed run branch.

**Decision:** after each agent step, copy the contents of `/output` —
minus internal runtime files (`auth.json`, `prompt.txt`, `result.json`,
`git-result.json`, `mock-result.json`, `opencode.json`) and minus files
over a per-file size cap (platform config, default 100 MB) — into
`.mediforce/output/<stepId>/` inside the workspace, so the existing
per-step commit captures them on the run branch. Listing reads
`git ls-tree` and downloads read `git show` against the bare repo; no new
storage system is introduced. `.mediforce/` is a reserved namespace, so
repos that legitimately contain an `output/` directory never conflict.

## Considered options

- **Object storage (S3 / GCS / Firebase Storage):** new infrastructure,
  credentials, and lock-in for a single-tenant, on-prem-capable product —
  rejected for v1; the git workspace already exists on every deployment.
- **File metadata persisted in the agent envelope / DB:** creates a second
  source of truth next to the git tree; rejected — git is the single
  source, one `ls-tree` per run page serves both the Files section and
  per-step counts.

## Consequences

- Output Files become part of the run's audit trail: versioned per step,
  captured even for failed steps (✗ commits), immutable.
- Large binaries enter the immutable history of the *local* bare repo —
  disk-only impact today because run branches are never pushed. If run
  branches ever get pushed to a remote, revisit (exclude `.mediforce/`
  from the push, or git-lfs).
- The platform API host must share a filesystem with
  `~/.mediforce/bare-repos` (already an existing assumption — the
  deliverable-file route reads host tmpdir today).
