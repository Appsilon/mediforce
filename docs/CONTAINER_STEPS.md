# Container Steps — Agent Execution Model

> Design document for the unified container + git execution model for AI agent steps.

## Problem

Agent steps currently spawn `claude` as a bare child process on the host:

```
spawn('claude', ['-p', '--verbose', '--output-format', 'stream-json', ...])
```

No isolation, no persistent outputs, no reproducibility. Reviewer sees a JSON blob — not the actual code the agent wrote.

## Design

Each agent step runs inside a **Docker container** that works on a **git repo**. The agent's work is committed to a run-specific branch. Reviewers see the diff on GitHub. The platform records commit SHAs for audit trail.

### Agent Config — The Triple

Each Claude Code agent step defines three execution coordinates in `agentConfig`:

```json
{
  "stepId": "generate-adam",
  "executorType": "agent",
  "plugin": "claude-code-agent",
  "autonomyLevel": "L3",
  "agentConfig": {
    "skill": "sdtm-to-adam",
    "image": "mediforce-golden-image:clinical",
    "repo": "org/STUDY-001-outputs",
    "commit": "a1b2c3d4e5f6"
  }
}
```

| Field | What | Notes |
|-------|------|-------|
| `image` | Docker image for the execution environment | One image for now; can be per-skill or per-department later |
| `repo` | Git repo URL where agent commits outputs | One repo per study, provided in config |
| `commit` | Exact commit SHA — the immutable starting point | Per-step. Cannot drift. If someone updates the starting point, they change the config explicitly. |

### Each Step Is a Self-Contained Unit

Steps do NOT chain via git. Each step has its own `repo` + `commit` — its own codebase, its own starting point. They can be completely different repos.

Example: `generate-tlg-shells` might work on a TLG template repo at commit `abc123`. `generate-adam` works on an ADaM generation repo at commit `def456`. Different code, different purpose.

**Data flows between steps via mounting, not via git.** The outputs of `generate-tlg-shells` (markdown files) are stored in the platform's data layer (Firebase Storage / KMS) and mounted into the `generate-adam` container at `/data` alongside the SDTM files. The git repo is strictly for the agent's working code within that step.

```
generate-tlg-shells                    generate-adam
┌──────────────────────┐              ┌──────────────────────┐
│ image: tlg-shells    │              │ image: adam-gen       │
│ repo: org/tlg-templates              │ repo: org/adam-scripts │
│ commit: abc123       │              │ commit: def456       │
│                      │              │                      │
│ /data (ro):          │  outputs →   │ /data (ro):          │
│   protocol.pdf       │  stored in   │   sdtm/*.xpt         │
│   metadata.json      │  platform    │   tlg-shells.md  ←── mounted from previous step │
│                      │              │   metadata.json  ←── mounted from earlier step  │
│ /workspace (rw):     │              │ /workspace (rw):     │
│   git repo @ abc123  │              │   git repo @ def456  │
│   agent writes here  │              │   agent writes here  │
└──────────────────────┘              └──────────────────────┘
```

### Runtime Flow

```
1. Platform gathers input data for this step:
   - User uploads (SDTM files from Firebase Storage)
   - Previous step outputs (TLG shells, metadata — from platform data layer)
   - Downloads all to a host temp directory
2. Platform creates Docker container from `image`:
   - Mounts input data at /data (read-only)
   - Mounts entrypoint.sh (from platform, not baked into image)
   - Mounts git credentials (deploy key)
   - Passes env vars: repo URL, commit SHA, branch name, step ID
3. Entrypoint runs:
   a. Clone `repo` at `commit`
   b. Create branch `run/{instanceId}`
   c. Claude Code executes `skill`, works in /workspace
   d. git add + commit + push
4. Platform records:
   - output commit SHA
   - branch name
   - list of changed files
5. Platform stores step outputs (generated files) in data layer
   for downstream steps to consume
6. Reviewer sees diff on GitHub, approves/revises in platform
7. On revise → new container, same branch + commit, agent gets feedback
```

### What Goes Where

| Data | Location | Why |
|------|----------|-----|
| Code outputs (R scripts, specs, markdown) | Git repo | Reviewable, versioned, reproducible |
| Input files (SDTM .xpt, PDFs) | Firebase Storage → mounted at `/data` | Large binaries don't belong in git |
| Agent activity logs | Platform (Firestore) | Real-time observability |
| Commit SHAs, branch names | Platform (Firestore, on step execution record) | Audit trail linking run to exact code |
| Reviewer feedback (revise comments) | Platform (Firestore, via verdict form) | Fed to agent as step input on retry |

### Branching Model

Each agent step creates a branch in **its own repo**: `run/{instanceId}`. Since steps can use different repos, branches are per-step-per-repo, not shared across steps.

```
org/adam-scripts repo:                 org/tlg-templates repo:
  main                                   main
    └── run/2d437238                       └── run/2d437238
          └── commit: ADaM R code                └── commit: TLG shell specs
```

When a step's output is approved → merge the run branch to main in that repo. Each repo's `main` = approved code for that domain.

## Decisions

### Repo lifecycle

The repo URL is provided in `agentConfig` at configuration time. The user (or org admin) creates the repo. The platform does not create repos.

Each step can reference a different repo. A step's repo contains the codebase relevant to that step's domain (e.g., ADaM derivation scripts, TLG templates). Steps may share a repo or use separate ones — it's a configuration choice.

### Image strategy

Start with a single base image (`mediforce-golden-image`) containing:
- Claude Code CLI
- R + common packages (tidyverse, haven, etc.)
- Python 3
- Git

The architecture supports per-step images — if `generate-tlg` needs different R packages than `generate-adam`, they can use different images. But start with one.

### Input file mounting

Agent steps that need uploaded files (e.g., SDTM datasets):
1. Platform downloads files from Firebase Storage to a host temp directory
2. Directory is mounted into the container at `/data` (read-only)
3. Agent reads from `/data`, writes code to the git repo
4. Temp directory cleaned up after container exits

Download time for large datasets is accepted for now. The UI shows progress/status to the user during download.

### Starting commit — per step, exact SHA

Each step's `commit` is an exact commit SHA. Not a branch name, not a tag — a specific point in history that cannot change.

Every step always starts from its configured `commit`. There is no "previous step commit" override — steps are independent. The config declares: "this agent was designed to work starting from exactly this code." If the repo evolves, the config doesn't silently drift. To update the starting point, change the config explicitly.

### Revise flow

When reviewer selects "revise" with feedback:
1. Platform creates a new container from the same image
2. Clones repo at the run branch HEAD (includes the agent's previous work)
3. Agent receives reviewer feedback as part of step input context
4. Agent amends/adds commits on the same branch
5. Reviewer sees the new diff

Feedback text comes from the verdict form in the platform UI. Long-term this could include inline code comments, but the form text is sufficient for now.

## Changes Required

### 1. Schema: `AgentConfig` type

Add optional fields to the existing `AgentConfig` type in `platform-core`:

```typescript
interface AgentConfig {
  skill?: string;
  skillsDir?: string;
  prompt?: string;
  model?: string;
  timeoutMs?: number;
  // New: container execution
  image?: string;        // Docker image name/tag
  repo?: string;         // Git repo URL (e.g. "https://github.com/org/study-outputs")
  commit?: string;       // Exact commit SHA — immutable starting point
}
```

All new fields optional — existing bare-process execution still works when `image` is not set.

### 2. Plugin: `claude-code-agent-plugin.ts`

The `spawnClaudeCli` method changes from:

```typescript
spawn('claude', args, { cwd: outputDir })
```

to:

```typescript
spawn('docker', [
  'run', '--rm', '-i',
  // Mount input data
  ...(dataDir ? ['-v', `${dataDir}:/data:ro`] : []),
  // Mount git credentials
  '-v', `${gitCredentialPath}:/root/.git-credentials:ro`,
  // Resource limits
  '--memory', '4g',
  '--cpus', '2',
  // Network (restrict to essentials)
  '--network', agentNetwork,
  // Environment
  '-e', `ANTHROPIC_API_KEY=${apiKey}`,
  '-e', `GIT_REPO=${repo}`,
  '-e', `GIT_BRANCH=run/${instanceId}`,
  '-e', `START_COMMIT=${commit}`,
  // Mount entrypoint (not baked into image)
  '-v', `${entrypointPath}:/entrypoint.sh:ro`,
  // Image + command
  image,
  '/entrypoint.sh',
], { stdio: ['pipe', 'pipe', 'pipe'] })
```

The entrypoint script (mounted into the container) handles:
1. Clone repo at exact commit, create run branch
2. Run `claude` with the skill prompt
3. `git add . && git commit && git push`

stdout/stderr piping stays the same — stream-json output is still parsed by the plugin.

### 3. Container entrypoint (`entrypoint.sh`)

The entrypoint is the startup script that runs when the container starts. Claude Code doesn't know about git — the entrypoint wraps it: clone → run Claude → commit → push.

**Mounted at runtime** (not baked into the image). This means:
- Update the entrypoint without rebuilding images
- Different entrypoints per step if needed
- The image stays generic (just the runtime environment)
- Easier debugging (edit, rerun, no rebuild)

```bash
#!/bin/bash
set -euo pipefail

# 1. Clone repo at exact commit, create run branch
git clone "$GIT_REPO" /workspace
cd /workspace
git checkout "$START_COMMIT"
git checkout -b "$GIT_BRANCH"

# 2. Run Claude Code (prompt piped via stdin by the platform)
claude -p --verbose --output-format stream-json \
  --allowedTools Read,Write,Edit,Glob,Grep \
  --add-dir /data \
  "$@"

# 3. Commit and push whatever the agent changed
git add -A
if ! git diff --cached --quiet; then
  git commit -m "agent: ${STEP_ID:-unknown} — automated output"
  git push origin "$GIT_BRANCH"
fi
```

### 4. Step execution record

After the container exits, the platform records on the step execution:

```typescript
{
  commitSha: "abc123...",
  branch: "run/2d437238",
  changedFiles: ["adsl.R", "adae.R", ...],
  repoUrl: "https://github.com/org/STUDY-001-outputs"
}
```

### 5. Review panel UI

The `AgentOutputReviewPanel` gets a new view when git data is available:

- **Link to diff on GitHub**: `${repoUrl}/commit/${commitSha}` or `${repoUrl}/compare/main...${branch}`
- **Changed files list** with links to each file on GitHub
- **Summary** from the agent's result (same as today)
- **Confidence + metadata** (same as today)

No need to embed a diff viewer — GitHub's UI is purpose-built for this.

### 6. Mock agent for UAT

`MockClaudeCodeAgentPlugin` skips Docker + git but returns fake git metadata:

```typescript
{
  commitSha: "mock-" + crypto.randomUUID().slice(0, 8),
  branch: `run/${context.processInstanceId}`,
  changedFiles: ["adsl.R", "adae.R", "adlb.R", "advs.R"],
  repoUrl: "https://github.com/mock-org/mock-study"
}
```

This lets the review panel UI be developed and tested without real Docker/git infrastructure.

## Sequence Diagram

```
User                Platform              Docker              GitHub
  |                    |                    |                    |
  |  start run         |                    |                    |
  |───────────────────>|                    |                    |
  |                    | download /data     |                    |
  |                    |───────┐            |                    |
  |                    |<──────┘            |                    |
  |                    | docker run         |                    |
  |                    |───────────────────>|                    |
  |                    |                    | git clone + branch |
  |                    |                    |───────────────────>|
  |                    |                    | claude executes    |
  |                    |      stream events |                    |
  |                    |<───────────────────|                    |
  |  progress updates  |                    |                    |
  |<───────────────────|                    |                    |
  |                    |                    | git commit + push  |
  |                    |                    |───────────────────>|
  |                    |  container exits   |                    |
  |                    |<───────────────────|                    |
  |                    | record commit SHA  |                    |
  |                    |───────┐            |                    |
  |                    |<──────┘            |                    |
  |  review task       |                    |                    |
  |<───────────────────|                    |                    |
  |                    |                    |                    |
  |  view diff on GH   |                    |                    |
  |────────────────────────────────────────────────────────────>|
  |                    |                    |                    |
  |  approve/revise    |                    |                    |
  |───────────────────>|                    |                    |
```

## Implementation Order

1. **Mock first**: Update `MockClaudeCodeAgentPlugin` to return git metadata. Update review panel to show GitHub links. UAT the full flow with fake data.
2. **Entrypoint + image**: Build the base Docker image with Claude CLI + R + git. Write `entrypoint.sh`. Test locally with `docker run`.
3. **Plugin swap**: Replace `spawn('claude')` with `spawn('docker', ['run', ...])` in `ClaudeCodeAgentPlugin`. Wire up git credential mounting and env vars.
4. **Schema + recording**: Add git fields to `AgentConfig` and step execution records. Store commit SHA in Firestore.
5. **Network isolation**: Add Docker network rules to restrict container access to essentials only (Anthropic API, GitHub, Firestore).

## Git Auth in Containers

| Option | How | Pros | Cons |
|--------|-----|------|------|
| **GitHub App** (recommended for production) | Org installs a Mediforce GitHub App. Platform requests short-lived tokens per repo, mounted into container. | Scoped permissions, auto-expires, no shared secrets, works for any org repo | Setup overhead (App registration), token refresh logic |
| **Deploy key** (recommended for local dev/UAT) | SSH key per repo, mounted into container | Simple, repo-scoped | One key per repo, manual setup, doesn't scale |
| **PAT** | User's token stored in config | Quick to start | Tied to a person, broad permissions, expires — not for production |

**Path**: Start with deploy keys now. Build GitHub App integration for production later.

## Open Questions

- **Concurrent runs**: Two pipeline runs on the same repo — different branches, no conflict. But if the same step retries, need to handle force-push or sequential commits.
- **Branch cleanup**: When to delete run branches after merge? Immediately? After retention period?
- **Large repos**: If a study repo accumulates many runs, does clone time become a problem? Shallow clones may help.
- **Cloud deployment**: Docker-in-Docker or sidecar containers? Depends on hosting (GKE, Cloud Run, etc.). Deferred.
