---
status: living
audience: engineers
last_reviewed: 2026-08-19
---

# Container step execution

How a step actually runs: one Docker container per step, one git worktree per
run. This is the cross-package view — which plugins exist is
[`packages/agent-runtime/src/plugins/README.md`](../../packages/agent-runtime/src/plugins/README.md),
and the author-facing config surface is
[`workflow-capabilities.md`](workflow-capabilities.md).

## The model

Steps do not each get their own repo. A run gets **one** git worktree, shared by
every step in it, and each step commits into it at its boundary. The engine
drives git from the host — nothing inside the container knows about git, and
there is no entrypoint script.

Per workflow definition, the host caches a bare repo. Per run, it creates a
worktree on branch `run/<runId>`, branched from `main`. Every step of that run
bind-mounts the worktree at `/workspace`.

```
~/.mediforce/                       (or $MEDIFORCE_DATA_DIR)
  bare-repos/<namespace>/<name>.git
  worktrees/<namespace>/<name>/<runId>
```

`WorkspaceManager` owns this
([`workspace-manager.ts`](../../packages/agent-runtime/src/workspace/workspace-manager.ts));
path and branch conventions live in `workspace-paths.ts` so the read-only
`WorkspaceReader` can never drift from it.

## Mounts

| Path | Mode | Lifetime | Carries |
|---|---|---|---|
| `/workspace` | rw | the run | The git worktree. Deliverables go here; it is the working directory. |
| `/output` | rw | the step | Engine ↔ step channel. Host seeds `input.json`, `prompt.txt`, `previous_run.json`, `mcp-config.json`, `script.<ext>`; the step writes `result.json` and optional `presentation.md`. |
| `/data` | ro | the step | Uploaded attachments the host downloaded for this step. |
| `/artifacts` | ro | the definition | The files the workflow carries (`artifacts` on the definition): scripts, a Dockerfile, skills. Materialized to a content-addressed host directory per file set, so every step of every run of an unchanged workflow shares one write. Absent when the workflow carries none. |
| `/plugin` | ro | the step | The Claude Code plugin root, when an agent step sets `skillsDir`. Its parent is the resolved skills directory: carried skills, then the `externalSkillsRepo` cache, then the repo checkout on the host. |

Why `/workspace` and `/output` stay separate — and why `/output` is a bad name
for a channel that carries inputs — is argued in the header comment of
[`container-plugin.ts`](../../packages/agent-runtime/src/plugins/container-plugin.ts).
Deliverables written to `/output` are copied into `.mediforce/output/<stepId>/`
in the worktree before the commit, so the commit captures them.

A dry run builds the image and mocks the step. Execution is swapped for
`MockAgentPlugin` — no agent runs, no container starts, nothing external is
called — but whether the image compiles is the one thing a mock cannot answer,
and it is the part that takes minutes and fails, so the build is real. A build
failure fails the dry run, which is what the person asked by running it.

A carried `Dockerfile` is also a build source. When a step sets `dockerfile`
and the workflow carries a file at that path, the image is built from the
materialized directory with no clone anywhere. `dockerfile` is a path from the
root of the carried files and the whole set is the build context, so `COPY
scripts/ /scripts/` from a `container/Dockerfile` works as it does in a
repository; a `context` on such a step is ignored. The tag is derived from the
carried files, the Dockerfile, and the workflow and namespace
(`mediforce-artifacts:<hash>`), so an edit to any carried file builds a new
image and a rerun of unchanged files finds the one already there. A
step that also names its own `image` keeps that tag, which says nothing about
the files, so the build labels the content hash (`mediforce.build.artifacts`)
and an existing image is reused only when the label matches — otherwise it is
rebuilt under the same tag, as a repo build is when its commit moves. An
explicit step-level `repo` + `commit` still wins; `externalSkillsRepo` remains
the fallback. The first build takes as long as a `docker build` does, which is
minutes for a sizeable image. The image appears in the Image Catalog as a
`carried` entry ([ADR-0022](../adr/0022-image-catalog.md)).

In the step editor these are one choice, not six fields: **ready image**, **built
from workflow files**, or **built from a git repo**. The mode is read back from
the step with the same precedence the runtime applies, so the editor cannot
offer a combination that resolves to something else, and switching clears the
fields the new source does not use. A stored step that sets more than one
source keeps them until an author clears them — the editor says which are
ignored rather than dropping anyone's work on open. `image` is the one field
that changes meaning: in the two build modes it is the tag to build under, and
it is labelled as such.

A step that names a file the workflow does not carry is flagged before the run
(preflight, beside missing secrets and images): a command reading
`/artifacts/<path>` with no such file, or a `dockerfile` with neither a carried
file nor a repo to build from. A `skillsDir` is not flagged, because with
neither carried skills nor an `externalSkillsRepo` it resolves against the
repository on the host, which the browser cannot see.

A step names a carried file by its container path: `python3
/artifacts/scripts/poll.py`. Files are written executable, so a command may be
the file itself. They are text and capped (64 KiB a file, 256 KiB the set) by
[`WorkflowArtifactSchema`](../../packages/platform-core/src/schemas/workflow-definition.ts);
data and installed dependencies belong in an image.

Containers run `--rm -i`, capped at 8 GB / 2 CPUs, named
`mediforce-<runId>-<stepId>`. Network is unrestricted.

## Commits

Every step commits, **always** — on success, on failure, and when nothing
changed (`--allow-empty`). The branch is meant to be isomorphic to the step
timeline, so an empty commit is signal, not noise.

```
◆ <step name> → +path/to/file               regular success
✓ <step name> → +path/to/file               last agent step of the run
✗ <step name> — failed: <first error line>  failure, commits what it produced
```

The body carries the change list plus agent reasoning; trailers (`Step-Id`,
`Run-Id`, `Step-Status`, `Step-Duration-Ms`, `Agent-Plugin`, `Agent-Image`,
`Start-Commit`) are structured metadata tooling can parse back out.

Before committing, the staged diff is scanned for secret-shaped content
(PEM keys, `AKIA…`, `ghp_…`, `sk-…`); a match resets the index and fails the
step. `.git/info/exclude` also carries a baseline ignore list for common secret
filenames.

**Run branches are never pushed.** They are local to the host, which is why
`GitMetadata.repoUrl` is the bare repo path rather than a remote URL — a GitHub
URL there would render `/commit/<sha>` links that 404. The step page shows the
metadata as plain text (`GitSection`); the review panel has no git view.

## Config

Two independent config surfaces, easy to confuse:

| Field | Schema | Means |
|---|---|---|
| `workspace.remote`, `workspace.remoteAuth` | `WorkflowWorkspaceSchema` (workflow level) | Where the run worktree comes from. Unset → the bare repo is local-only. |
| `image`, `dockerfile`, `context`, `repo`, `commit`, `repoAuth` | `ContainerSchema` (step level, merged into agent and script config) | Where the **image** comes from. `repo` + `commit` is what the Docker build clones, not the agent's working repo; `context` picks the directory inside it the build sees (default: the Dockerfile's own), and `dockerfile` is then read from it. |

Both live in
[`workflow-definition.ts`](../../packages/platform-core/src/schemas/workflow-definition.ts).
`commit` is an exact SHA in both cases — pinned, cannot drift.

With `dockerfile` + `repo` + `commit` set, the image is built lazily on first
use and tagged `mediforce-built:<hash>`, keyed on the build inputs — `context`
folds in only when set, so a step without one keeps the tag it always had; a rebuild
happens only when the pinned commit moves. A step that names only `dockerfile`
builds from the workflow's `externalSkillsRepo` the same way. No build lands on
the golden image: a step with a build source that names `mediforce-golden-image`
builds and runs under its derived tag. With `image` alone, it must already
exist locally or be pullable. Without either, the step fails unless
`ALLOW_LOCAL_AGENTS=true` — a dev-only escape hatch that runs the step on the
host with no isolation.

## Build provenance

The derived tag is a hash, so the image carries what the tag cannot say. Every
build writes `mediforce.build.repo`, `.commit`, `.dockerfile`, `.workflow` and
`.namespace`, and `.context` — written empty when the step named none, so it
overrides a context inherited from the base image — plus `org.opencontainers.image.source` and `.revision`
([`image-provenance.ts`](../../packages/platform-core/src/utils/image-provenance.ts),
emitted by both the in-process and the `container-worker` builder). Overriding
the two OCI keys is a correctness fix, not just interoperability: labels are
inherited from the base image, so without our own values an image built on
`rocker/tidyverse` reports *its* repository as the source.

The daemon listing reads them back into the optional `build*` fields of
`DockerImageInfoSchema`. `docker images` cannot emit labels, so this costs a
second `docker image inspect` over the distinct ids; a failure leaves every row
unannotated rather than failing the listing, and an image built before the
labels existed simply carries none.

A build from a carried Dockerfile writes `.workflow`, `.namespace`,
`.dockerfile` and `.context` as the step named them, and `.artifacts` (the
content hash) — what the Image Catalog keys a `carried` entry on — and writes
`.repo` and `.commit` empty, as an upload does, so an image built `FROM` a repo
build is not read back as a version of that repo.

`GET /api/workflow-definitions/by-image` recomputes the derived tag for
build-mode steps with the runtime's own `resolveStepImage`, so a
`mediforce-built:*` or `mediforce-artifacts:*` row still names the workflows and
steps that use it — matching only the stored `image` string would be blind to
exactly the steps that leave it unset.

## Where the container runs

`getDockerSpawnStrategy()` picks one
([`docker-spawn-strategy.ts`](../../packages/agent-runtime/src/plugins/docker-spawn-strategy.ts)):

- **Local** (default) — `docker run` as a child process.
- **Queued** (`REDIS_URL` set) — enqueued to the BullMQ `container-worker`,
  which may run on another machine.

Both write the step's activity log live, as the container produces lines. Which
process does the writing differs — the orchestrator locally, the worker through
the queue — so the *format* travels in the job payload (`lineFormat`) rather than
as a callback, and both apply the same `formatAgentLogLine` from `platform-core`.
A build that happens before the container exists is bracketed with `stage`
entries, so a cold image build reads as progress instead of an empty log.

A script step uses `raw`, since its stdout has no event structure. When caller
and worker are on different machines (the `inputFiles` case), the worker's live
writes land on its own disk, so the queued strategy rebuilds the log from
buffered stdout after exit — that topology cannot stream through a file at all.

The agent's result envelope is still assembled from buffered stdout after exit;
only the activity log streams.

## Git auth

Cloning uses anonymous HTTPS first, then an SSH deploy key
(`$DEPLOY_KEY_PATH`, default `~/.ssh/deploy_key`) — a public repo needs no
credentials, a private one still reaches its key. For HTTPS, `repoAuth` /
`remoteAuth` name a workflow secret holding a token. Secrets are never an
interpolation source and never reach a commit or an audit snapshot.

## Not built

Run-branch GC and retention · automatic merge back to `main` · pushing run
branches to a remote · network restriction on step containers · shallow
worktree clones (full history is kept for audit).
