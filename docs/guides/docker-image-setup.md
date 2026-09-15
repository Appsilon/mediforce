---
status: living
audience: workflow-authors
last_reviewed: 2026-09-11
---

# Getting a Docker image onto the platform

A step runs inside an image that must already be on the **deployment's Docker
daemon** — the one the platform reaches over `/var/run/docker.sock`. There is no
Mediforce image registry: the platform never pushes, holds no registry URL, and
manages no registry credentials. "Available to the platform" always means
"present on that daemon", which is what `mediforce system images` lists.

There are three ways an image gets there.

## 1. Build from a repo (the self-service path)

Set `repo` + `commit` (and optionally `dockerfile` and `context`) on the step. The platform
clones at that commit and builds before the run, tagging the result
`mediforce-built:<12 hex>` and labelling it with its provenance.

To build **before** a run — preparing an image, or checking a Dockerfile builds
at all — trigger the same build directly:

```bash
mediforce images build --namespace <handle> --repo <repo> --commit <sha> [--dockerfile <path>] [--context <dir>]
```

**Workspace → Images** has the same action as **Build** on any entry built from
a repo. Both mint the tag a step pinning that commit resolves to, so the step
then finds the image already built instead of rebuilding it. Any workspace
member can do this; a build takes minutes and the command waits for it.

This is the only route that needs no host access and no registry, so prefer it
whenever the Dockerfile lives in a repo the deployment can clone. It also feeds
the Image Catalog for free — see [below](#images-the-platform-built-are-offered-on-their-own).

### Choosing the build context

Every path a Dockerfile `COPY`s is resolved against the **build context**. With
no `context` set, the platform uses the directory holding the Dockerfile, so
everything the Dockerfile copies must sit **beside it** and a Dockerfile in a
subdirectory cannot reach files in its parent.

This is the failure that looks least like itself. Given
`apps/my-workflow/container/Dockerfile` containing:

```dockerfile
COPY scripts/ /opt/my-workflow/scripts/
```

…the build fails with `"/scripts": not found` even though `scripts/` is plainly
there in `apps/my-workflow/` — because the context is `container/`, which holds
only the Dockerfile.

Name the directory the Dockerfile should see as `context`. It is a path from the
repo root, and once it is set `dockerfile` is read **from the context**, the way
docker-compose reads it:

```json
{
  "script": {
    "repo": "https://github.com/acme/workflow-repo.git",
    "commit": "0123456789abcdef0123456789abcdef01234567",
    "context": "apps/my-workflow",
    "dockerfile": "container/Dockerfile",
    "command": "python /opt/my-workflow/scripts/run.py"
  }
}
```

Now `COPY scripts/` resolves against `apps/my-workflow/`. `"context": "."` is the
repo root. A step with no `context` builds exactly as it always did — the same
context, the same tag. A context or Dockerfile path that climbs out of the
repository (`../..`) is refused before anything is cloned, and one that reaches
outside it through a symlink in the checkout is refused before anything is
built.

The same field is **Build context** in **Add image** and **Edit**, and
`--context` on `mediforce images create`, `update` and `build`.

## 2. A public image reference

Name a pullable reference in the step's `image` field:

```
ghcr.io/my-org/my-agent:v1.0.0
```

`docker run` pulls it on first use if the daemon can reach it. This works
without any platform configuration for a **public** image. A private one needs
`docker login` performed on the host by an administrator — the platform cannot
supply credentials on your behalf.

Note that the step editor's amber "image not found" warning checks the daemon
listing, so it persists until something actually pulls or builds the image onto
the host. Pushing to a registry does not clear it.

## 3. Built or loaded on the host

Anything else — an image built from a local Dockerfile with no repo behind it,
or moved across with `docker save` / `docker load` — requires shell access to
the deployment host. Ask an administrator.

## Verifying

```bash
mediforce images list --namespace <handle>   # the catalog, per namespace
mediforce system images                      # every image on the daemon
mediforce system status                      # Docker daemon reachability
```

Both report the daemon. Neither reports a registry, because there is none.

## Choosing a base image

A step runs its command *inside* the image, so the image must already contain what the command needs:

| Step | Needs in the image |
|------|--------------------|
| `executor: agent` | The agent CLI (`claude` or `opencode`) and a shell — start from `mediforce-golden-image` |
| `executor: script`, `script.command` | Whatever the command invokes (`python`, `Rscript`, `node`, …) |
| `executor: script`, `script.inlineScript` without `script.image` | Nothing — the runtime image is selected automatically |
| `executor: script`, `script.inlineScript` with an explicit `script.image` | The selected runtime (`python3`, `node`, `Rscript`, or `bash`) |

Minimal base images (`alpine`, `scratch`, distroless) ship none of this. `alpine` in particular has BusyBox `sh` but no `bash`, and no agent CLI at all, so an agent step pointed at it fails at container start. They are only useful as the `FROM` line of an image you build on top of.

## Troubleshooting

- **`"/<path>": not found` on a `COPY`, for a path that exists in the repository** — with no `context` set, the build context is the Dockerfile's own directory, so it cannot reach files above it. Set `context`; see [Choosing the build context](#choosing-the-build-context).
- **`exec: "<binary>": executable file not found in $PATH`** — the image has no such executable. The container started and immediately exited 127. Point the step at an image that ships the tooling (see [Choosing a base image](#choosing-a-base-image)), or add it in a Dockerfile that builds `FROM` the minimal image.
- **The image still shows as missing** — check `mediforce system images`. The warning tracks what is on the daemon, not what exists in a registry, so it clears only once the image has actually been pulled or built onto the host. If the reference is private, an administrator must `docker login` on the host.
- **`not found locally and no repo+commit configured for auto-build`** — a build-mode step reached a tag that is not on the daemon and carries no build inputs to make it. Set `repo` and `commit` on the step, or use an image that is already present.
- **Prefer the auto-build path** — set `repo` and `commit` on the step and the platform builds it before the run, with no host access and no registry involved.

## Images the platform built are offered on their own

An image a workflow in your workspace built appears in **Workspace → Images**
within about 30 seconds of the build finishing, marked **Needs a description**.
The build labelled its repository, Dockerfile, commit and the workflow that
triggered it, so every fact on the entry is already there; the one thing missing
is the sentence saying what the image is *for*. **Describe** on the card asks
for that sentence and a name, registers the entry, and probes what is inside it
([ADR-0022](../adr/0022-image-catalog.md) decision 7). Until then the image is
still offered by the step-editor picker, labelled `not described yet`.

This covers only what the platform built **for your namespace**. A pulled or
hand-built image — `python`, `rocker/r-ver`, anything pushed to a registry —
carries no build labels, so nothing can derive its source and it is catalogued
by hand.

## Cataloguing a repository nothing has built yet

**Add image** on **Workspace → Images** registers the repository and Dockerfile
an image is built from before anything has built it — the case **Describe**
cannot cover, since that one only names a source some build already recorded.
Give it the repository (`owner/repo`, or a full `git@…` / `https://…`
reference), the Dockerfile path if it is not the default, a build context if
the Dockerfile copies files from outside its own directory, and the sentence
saying what the image is for. `mediforce images create --repo` is the same
write.

The entry appears with **no versions**, which is the honest state: a catalog
entry is an offer, and nothing has built the image yet. **Build** on the new
card, or `mediforce images build`, gives it its first one.

## Changing what an entry says

**Edit** on any catalogued entry changes everything a human wrote on it: the
**repository**, **Dockerfile** and **build context** (or the **image
reference**), the **name**, and the **intent** sentence. Versions, capabilities
and lineage are derived from the image on every read, so there is nothing else
to edit. The same write is `mediforce images update <entry-id> --namespace
<handle> [--name …] [--intent …] [--repo … --dockerfile … --context …]
[--reference …]`. Any workspace member,
the same gate the entry was created under.

### Changing the source moves the entry

An entry is keyed on its source, and its id is derived from it
([ADR-0022](../adr/0022-image-catalog.md) decision 1), so correcting a
repository or pointing at a different Dockerfile **re-keys** the entry: the row
is written under the id its new source derives and the old one is removed. One
entry, corrected — never the mistake sitting beside its fix. Two consequences
worth expecting:

- **The id changes**, so a bookmarked `?entry=<id>` link goes stale and the CLI
  prints the new id. A source that only *spells* the same key differently
  (`Appsilon/x` for `git@github.com:Appsilon/x.git`) canonicalises to the same
  id and stays put.
- **Versions built from the old source stop belonging to the entry.** They are
  still on the daemon, so they reappear on their own as an undescribed entry
  marked **Needs a description**. Nothing is deleted from the daemon.

The **build context is not part of the key** — the key is the Dockerfile's path
from the repo root. Setting a context on `container/Dockerfile` keeps the id,
and the same Dockerfile built from two contexts is one entry with versions of
both. Because `dockerfile` is read from the context once one is set, a change
that makes the same `dockerfile` string name a different file (`Dockerfile`
with context `container` is `container/Dockerfile`) does move the entry.

Re-keying onto a source some other entry already describes is refused with a
conflict rather than overwriting that entry — edit or delete that one instead.
Switching an entry between a repository and a pushed reference is not offered:
that changes which inputs the platform holds for it, so catalogue it with
**Add image** instead.

An entry marked **Needs a description** offers **Describe** rather than
**Edit**, and its source is read-only there: a build recorded that source, and
re-pointing it would describe a different one while leaving this one still
undescribed. Describe it first, then **Edit** can correct it.

## Removing an entry and its images

**Delete** on an entry removes it **and** every image behind it, running
`docker rmi` on each tag it offered. Admin or owner of the workspace, and
`mediforce images delete <entry-id> --namespace <handle>` is the same write.

The two are one act on purpose. An entry exists *for* its images, and for a
source this workspace built, removing the record alone achieves nothing: the row
is re-derived on the next read and comes back marked **Needs a description**
([ADR-0022](../adr/0022-image-catalog.md) decision 7), the image stays on the
daemon, and the step-editor picker goes on offering it. The only thing lost is
the sentence somebody wrote. When the daemon holds no image for the entry —
catalogued but never built, or the images already gone — the delete is just the
record, and the dialog says so.

Two things to expect, because the daemon is shared by every workspace:

- **It cannot be undone.** A deleted image is rebuilt or pulled again, never
  restored; there is no registry to fall back on.
- **Deletion is by tag, not by image id**, so an image a second tag still
  references survives rather than needing a force that would take a version
  some other entry offers. Docker also refuses an image a running container is
  using, or one another image was built on — and the entry is then kept, since
  it is the only handle anyone has on the versions left behind.

### What blocks a delete

A **live** workflow version pinning one of the images blocks it. Live means the
version a run starts from: the workflow's **default** version when it is itself
live, otherwise its newest non-archived version. That step can still be
re-pointed, so nothing has to break — the delete is refused and names the
workflow, version and steps, with **Archive this version** offered right there.
Archiving one version leaves the rest of the workflow alone, and the dialog says
which version runs fall back to — if that one pins the image too, it blocks next.

When the pinning version is the workflow's **only** runnable one, the button reads
**Archive workflow**, because that is what archiving it does. The workflow is not
deleted: on the workspace page, **Display → Archived workflows** lists it, and
**Unarchive** on its page brings it back — every version of it, including any
archived earlier on purpose. Its step still names the deleted image, so rebuild
or re-point that before running it again.

A version the workflow pins as its **default** is not offered that button, since
archiving it would leave the workflow pointing at a version that cannot run.
Point its step at another image, or make a different version the default first.

A **superseded or archived** version does not block, and is listed anyway. A
registered version is immutable — there is no editing v2 in place — so it could
never be moved off the image, and refusing on its account would mean an image
pinned once could never be reclaimed. Re-running one after the delete fails at
container start.

The check is deployment-wide, because the daemon is: a step in a workspace you
cannot see blocks the delete just the same, and is reported as a count rather
than by name.

`mediforce images delete --keep-images` removes only the record — rarely what
you want, for the reason above — and `mediforce system rmi <id-or-tag>` still
removes one image on its own.

## Backfilling an existing deployment

For those hand-built and pulled images, `scripts/migrations/adopt_daemon_images.py`
backfills the catalog from what the daemon already holds.

It runs in two phases, because `intent` is the one field a human writes
([ADR-0022](../adr/0022-image-catalog.md) decision 2) and a generated sentence
would make the catalog unreadable:

```bash
# 1. Draft. Reads the daemon, groups it into sources, changes nothing.
python3 scripts/migrations/adopt_daemon_images.py --namespace acme --draft images.json

# 2. Fill in every "intent", then register.
python3 scripts/migrations/adopt_daemon_images.py --apply images.json
```

Images are grouped by **source**, so five `mediforce-agent:*` tags become one
entry with five versions rather than five rows. Test artifacts
(`mediforce-test-*`, `mediforce-e2e-*`), dev-infra containers (`postgres`,
`redis`) and images built from a local filesystem path are dropped by default —
`--include-all` keeps them. Re-applying a draft is safe: an already-catalogued
source is skipped, not failed.

## See also

- **Workspace → Images** (`/<handle>/images`) — the same catalog in the browser,
  open to any workspace member: entries grouped under the image each was built
  on, searchable across intent and capability, with each version's commit, size,
  layer summary, "used by" workflows and a permalink to its Dockerfile on GitHub
  where the repository reference supports one.
- `mediforce images list` — the **Image Catalog**: the images your namespace
  offers for steps, one row per source, each with a sentence saying what it is
  for and a cached probe of each version's runtimes and agent suitability
  ([ADR-0022](../adr/0022-image-catalog.md)). Curated and per-namespace, and
  indented under the image each was built on — `mediforce images show` prints
  that base and the layers the version adds over it.
- `mediforce system images` — the raw Docker daemon listing: every image on the
  host, `postgres` and dangling layers included. Deployment-wide and ops-facing;
  the one to reach for when hunting disk, not when choosing a step image.
- `mediforce system status` — check Docker daemon reachability
