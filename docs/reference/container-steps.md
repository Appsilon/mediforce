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

Why `/workspace` and `/output` stay separate — and why `/output` is a bad name
for a channel that carries inputs — is argued in the header comment of
[`container-plugin.ts`](../../packages/agent-runtime/src/plugins/container-plugin.ts).
Deliverables written to `/output` are copied into `.mediforce/output/<stepId>/`
in the worktree before the commit, so the commit captures them.

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
| `image`, `dockerfile`, `repo`, `commit`, `repoAuth` | `ContainerSchema` (step level, merged into agent and script config) | Where the **image** comes from. `repo` + `commit` is the Docker build context, not the agent's working repo. |

Both live in
[`workflow-definition.ts`](../../packages/platform-core/src/schemas/workflow-definition.ts).
`commit` is an exact SHA in both cases — pinned, cannot drift.

With `dockerfile` + `repo` + `commit` set, the image is built lazily on first
use and tagged `mediforce-built:<hash>`, keyed on the build inputs; a rebuild
happens only when the pinned commit moves. With `image` alone, it must already
exist locally or be pullable. Without either, the step fails unless
`ALLOW_LOCAL_AGENTS=true` — a dev-only escape hatch that runs the step on the
host with no isolation.

## Build provenance

The derived tag is a hash, so the image carries what the tag cannot say. Every
build writes `mediforce.build.repo`, `.commit`, `.dockerfile`, `.workflow` and
`.namespace`, plus `org.opencontainers.image.source` and `.revision`
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

`GET /api/workflow-definitions/by-image` recomputes the derived tag for
build-mode steps, so a `mediforce-built:*` row still names the workflows and
steps that use it — matching only the stored `image` string would be blind to
exactly the steps that leave it unset.

## Where the container runs

`getDockerSpawnStrategy()` picks one
([`docker-spawn-strategy.ts`](../../packages/agent-runtime/src/plugins/docker-spawn-strategy.ts)):

- **Local** (default) — `docker run` as a child process, stdout streamed live.
- **Queued** (`REDIS_URL` set) — enqueued to the BullMQ `container-worker`,
  which may run on another machine. Output is buffered and replayed through the
  same line reader after exit, so event payloads are byte-identical; only the
  timing differs.

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
