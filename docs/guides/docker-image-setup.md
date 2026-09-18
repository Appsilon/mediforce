---
status: living
audience: workflow-authors
last_reviewed: 2026-09-17
---

# Creating and registering Docker images

A step runs inside an image that must already be on the **deployment's Docker
daemon** — the one the platform reaches over `/var/run/docker.sock`. There is no
Mediforce image registry: the platform never pushes, holds no registry URL, and
manages no registry credentials. "Available to the platform" always means
"present on that daemon", which is what `mediforce system images` lists.

Getting an image to a step takes two things:

1. **Create** it — get the image onto the daemon (build, upload, pull, load).
2. **Register** it — catalogue it in your workspace's **Image Catalog**
   (**Workspace → Images**, `mediforce images`), with one sentence saying what
   it is *for*. That catalog is what the step editor's image picker offers
   ([ADR-0022](../adr/0022-image-catalog.md)).

Most paths below do both in one act. Every create and register action is open to
any workspace member; only **Delete** needs workspace admin or owner.

## What your workspace already offers

A workspace is created with five entries: `mediforce-golden-image`, which an
agent step runs in when it names no image, and the four an inline script step
runs in — `mediforce-node`, `python`, `rocker/r-ver` and `alpine`
([ADR-0022](../adr/0022-image-catalog.md) decision 8). They are ordinary rows:
yours to edit, yours to delete, and each carries a version per tag of it the
daemon holds. Everything below is about adding your own image beside them.

A workspace created before that opens on an empty catalog. `mediforce images
seed --namespace <handle>` catalogues the same five, and
`scripts/migrations/seed_default_image_catalogs.py` does it over a list of
handles.

## Pick your path

| You have… | Path | Platform can rebuild it? |
|---|---|---|
| A Dockerfile in a git repo the deployment can clone | [A. Git repository](#a-a-dockerfile-in-a-git-repository) | Yes, at any commit |
| A Dockerfile you want to ship inside the workflow itself | [B. Workflow files](#b-a-dockerfile-the-workflow-carries) | Yes, on every file change |
| A Dockerfile in a folder on your machine, no reachable repo | [C. Local folder](#c-a-local-folder) | No |
| An image already on the daemon (pulled, loaded, built on the host) | [D. Existing image](#d-an-image-already-on-the-daemon) | No |
| An image in a registry the deployment can pull (Docker Hub, `ghcr.io/…`) | [E. Registry image](#e-an-image-in-a-registry) | No — pull another tag |
| An image moved with `docker save`/`load`, or a build needing secrets | [F. Host administrator](#f-anything-else-via-a-host-administrator) | No |
| A deployment full of images nobody catalogued | [G. Backfill script](#g-backfilling-a-whole-deployment) | — |

Prefer **A** whenever the Dockerfile can live in a clonable repo: the platform
keeps the inputs, links each version to its Dockerfile at a commit, and needs no
host access.

Replace `<handle>` below with your workspace handle.

### A. A Dockerfile in a git repository

**In the browser**

1. **Workspace → Images → Add image → Git repository.**
2. Fill in the repository (`owner/repo`, or a full `git@…` / `https://…` URL),
   the Dockerfile path if it is not `Dockerfile` at the root, and a **Build
   context** if the Dockerfile `COPY`s files from outside its own directory
   ([why](#choosing-the-build-context)).
3. Give it a name and the **Description** — one sentence on what the image is
   for. **Add to the catalog** creates the entry with no versions yet.
4. **Build** on the new card, pick the commit, and wait a few minutes. The
   version appears on the card.

**From the CLI**

```bash
mediforce images create --namespace <handle> --name "My agent" \
  --intent "Runs the SDTM mapping agent with pinned R packages" \
  --repo acme/workflow-repo [--dockerfile container/Dockerfile] [--context apps/my-workflow]

mediforce images build --namespace <handle> --repo acme/workflow-repo --commit <sha> \
  [--dockerfile container/Dockerfile] [--context apps/my-workflow]
```

**Or skip registering first.** A step in **Built from a git repo** mode (below)
builds the image lazily on its first run. That image then appears in **Workspace
→ Images** as **Needs a description** within about 30 seconds — **Describe** on
the card registers it ([details](#images-the-platform-built-are-offered-on-their-own)).

### B. A Dockerfile the workflow carries

1. In the workflow editor, add the Dockerfile and everything it `COPY`s to the
   workflow's **Files** panel (upload a folder to keep its structure, e.g.
   `container/Dockerfile` + `scripts/`).
2. On the step, set **Image source → Built from workflow files** and pick the
   Dockerfile. All carried files are the build context.
3. Run or dry-run the workflow. The first run builds the image
   (`mediforce-artifacts:<hash>`); any edit to a carried file builds a new version.
4. **Workspace → Images** shows it as **from workflow `<name>`**, marked **Needs
   a description** — **Describe** registers it. `mediforce images create
   --namespace <handle> --workflow <workflow> --dockerfile container/Dockerfile
   --name … --intent …` does the same.
5. Optional: to keep the image after the workflow's files move on, **Publish as
   image** on a version (or `mediforce images publish`) rebuilds it as
   `<handle>/<name>:<tag>`, an ordinary entry any workflow can use
   ([details](#a-dockerfile-the-workflow-carries)).

### C. A local folder

1. Make sure the folder is the build context: the Dockerfile and everything it
   `COPY`s are inside it, and a `.dockerignore` excludes the rest — the upload
   limit is 100 MiB.
2. **Workspace → Images → Add image → Local folder**, pick the folder, review the
   file tree, give it a name `<handle>/<name>`, a tag (optional) and the
   **Description**.
3. **Upload and build**, and wait a few minutes. Later versions: **Upload version**
   on the entry.

```bash
mediforce images build --namespace <handle> --reference <handle>/my-agent --context ./my-agent \
  [--dockerfile container/Dockerfile] [--tag v1] --intent "What this image is for"
```

Uploading from the browser drops executable bits — add `RUN chmod +x` or use the
CLI ([details](#uploading-a-local-folder)).

### D. An image already on the daemon

1. **Workspace → Images → Add image → Existing image** (or the `+` on the image's
   row in **Admin → Infrastructure**).
2. Pick the repository, give it a name and the **Description**, then **Add to the
   catalog**. Nothing is built; every tag of that repository becomes a version
   of the entry.

```bash
mediforce images create --namespace <handle> --reference rocker/r-ver \
  --name "R 4.4 base" --intent "Plain R runtime for script steps"
```

### E. An image in a registry

**In the browser**

1. **Workspace → Images → Add image → Registry image.**
2. Type the **Image reference** with no tag (`rocker/r-ver`,
   `ghcr.io/my-org/my-agent`) and a **Tag** (empty means `latest`).
3. Give it a name and the **Description**, then **Pull and add**. The deployment
   pulls the image and the entry appears with that tag as its first version.
4. Later tags: the same tab with the same reference. It says **Adds a version
   to …** and asks for nothing else.

**From the CLI**

```bash
mediforce images pull --namespace <handle> --reference ghcr.io/my-org/my-agent --tag v1.0.0 \
  --name "My agent" --intent "What this image is for"
```

A private registry needs an administrator to log the worker in first — the
platform holds no registry credentials ([details](#pulling-a-registry-image)).

### F. Anything else, via a host administrator

An image moved with `docker save` / `docker load`, or a build needing secrets
the platform cannot supply, needs shell access to the host. Ask an administrator
to put the image on the daemon, then register it with
[D](#d-an-image-already-on-the-daemon).

### G. Backfilling a whole deployment

`scripts/migrations/adopt_daemon_images.py --draft` → fill in each intent →
`--apply`. See [Backfilling an existing deployment](#backfilling-an-existing-deployment).

## Using the image in a step

In the workflow editor, each agent and script step has an **Image source**:

| Mode | Use for path | Step fields it writes |
|---|---|---|
| **Ready image** | C, D, E, F, and images published from B | `image` — chosen from the catalog picker |
| **Built from workflow files** | B | `dockerfile` (a carried file) |
| **Built from a git repo** | A | `repo`, `commit`, `dockerfile`, `context` |

The picker offers only catalogued images suited to the step — an agent step sees
agent-capable images, an inline script sees images with its runtime. An image
nobody has catalogued yet can still be typed in with **Name an image the catalog
does not list**, but registering it is what makes it discoverable for the next
author. See [Choosing
a base image](#choosing-a-base-image) for what a step needs inside the image.

## Check it worked

```bash
mediforce images list --namespace <handle>            # catalog entries and version counts
mediforce images show <entry-id> --namespace <handle> # versions, base, layers
mediforce system images                               # every image on the daemon
mediforce system status                               # Docker daemon reachability
```

An entry reading `(no image on the daemon)` is registered but not created yet —
build, upload or pull it.

The sections below are the detail behind each path.

## Building from a git repository

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

It needs no host access and no registry, and — unlike an
[upload](#uploading-a-local-folder) — the platform keeps the inputs, so it
can rebuild the image and link each version to its Dockerfile at a commit. Prefer it
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

## Uploading a local folder

For a Dockerfile in no repository the deployment can clone — no repo at all, or
one the platform cannot reach — upload the folder it builds from:

```bash
mediforce images build --namespace <handle> --reference <handle>/<name> --context ./my-agent \
  [--dockerfile container/Dockerfile] [--tag v1] --intent "What this image is for"
```

**Workspace → Images → Add image → Local folder** does the same from the
browser, and **Upload version** on the entry adds the next one.

- **The folder is the build context**, as `docker build ./my-agent` reads it:
  `--dockerfile` is a path from the folder's root (default `Dockerfile`), and
  everything it `COPY`s must be inside the folder.
- **What its `.dockerignore` excludes is never uploaded**, and the rest must fit
  in **100 MiB**. The file is read as `docker build` reads it — a
  `<Dockerfile>.dockerignore` beside the Dockerfile wins over the folder's root
  one — and the Dockerfile and the ignore file always go up. A folder over the
  limit is refused naming its largest entries: list the ones the build does not
  `COPY` in the `.dockerignore`. For a Dockerfile that copies only `scripts/`:

  ```
  *
  !scripts
  ```

- **Local folder** shows what will go up as a tree. What the `.dockerignore`
  excludes starts unchecked and stays so — the build would drop it anyway — and
  anything else can be unchecked for this upload.
  Chrome and Edge read the folder through their directory picker. Firefox and
  Safari only offer a file input, which counts every file in the folder, excluded
  ones included, and asks whether to upload that many. The excluded files still
  never go up.
- **The name starts with your workspace** — `<handle>/<name>`. Every workspace
  builds on one shared daemon, and the prefix is what stops one tagging over
  another's image.
- **A version is a tag, and a tag is never replaced.** `--tag` defaults to the
  upload time; a tag already on the daemon is refused, because a workflow pinning
  it would start running something else.
- **It is catalogued as it builds**, as a `referenced` entry — the first upload
  of a name needs `--intent`. The platform deletes the folder once built, so it
  can **never rebuild** the image and never claims to know where it came from:
  `--declared-repo` / `--declared-commit` / `--declared-dockerfile` (or *Where it
  came from* in the browser) record what you say, shown as **declared, not
  derived**.
- **The first upload describes the entry; later ones only add versions.** Its
  name, description and declared source are set once — a later upload may repeat
  them unchanged but is refused if they differ. Change them with **Edit** on the
  entry, or `mediforce images update`.
- **The browser cannot read file permissions**, so every file uploaded from
  **Local folder** arrives non-executable. A script the Dockerfile runs directly
  needs a `RUN chmod +x` — or upload it with the CLI, which keeps the bit.

A context that cannot build — too large, not an archive, a path that is absolute,
climbs out of the folder or runs through a symlink, no Dockerfile where you said —
is refused with the reason before it reaches the daemon.

## Pulling a registry image

**Add image → Registry image** and `mediforce images pull` run `docker pull` on
the deployment's daemon and catalogue the result as a `referenced` entry. The
rules are an upload's:

- **The first pull of a reference creates the entry** and needs the Description
  (`--intent`). A later tag of the same reference only adds a version: its name
  and Description belong to the entry, so change them with **Edit**.
- **A tag already on the daemon is refused, never re-pulled.** A workflow pinning
  it would start running something else. For a moving tag like `latest`, pull a
  pinned tag instead — or, if the image is already there, catalogue it with
  [Existing image](#cataloguing-an-image-already-on-the-daemon).
- **The reference is stored the way the daemon lists it.** Docker Hub's host and
  `library/` are dropped, so `docker.io/library/python` and `library/python` both
  become `python`.
- **Another workspace's name is refused.** A reference whose first segment is a
  different workspace's handle (`acme/agent` from workspace `beta`) would land on
  the shared daemon as that workspace's image. A registry host — anything with a
  dot or a port, or `localhost`, like `ghcr.io/acme/agent` — is never mistaken
  for one.
- **A tag, not a digest.** A reference with `@sha256:…` is refused; pull the tag
  that digest belongs to.
- **A private registry needs a login the worker can read.** The pull runs inside
  the `container-worker` container, which reads `/root/.docker` — not the host
  user's `~/.docker`. An administrator runs `docker login` on the host as the
  user whose config directory `DOCKER_CONFIG_DIR` points at (default
  `/home/deploy/.docker`, mounted read-only in `docker-compose.prod.yml`) and
  restarts the worker. Until then the pull fails with the registry's own
  `unauthorized`. A deployment that never sets it mounts an empty directory and
  pulls public images exactly as before.

A step can still name a pullable reference in its `image` field without
cataloguing it — `docker run` pulls it on first use. The step editor's amber
"image not found" warning checks the daemon listing, so it persists until
something actually pulls or builds the image onto the host; pushing to a
registry does not clear it.

## Loading an image on the host

Anything else — an image moved across with `docker save` / `docker load`, or
one built with build secrets the platform cannot supply — requires shell access
to the deployment host. Ask an administrator.

## Choosing a base image

A step runs its command *inside* the image, so the image must already contain what the command needs:

| Step | Needs in the image |
|------|--------------------|
| `executor: agent` | The agent CLI (`claude` or `opencode`) and a shell — start from `mediforce-golden-image` |
| `executor: script`, `script.command` | Whatever the command invokes (`python`, `Rscript`, `node`, …) |
| `executor: script`, `script.inlineScript` without `script.image` | Nothing — the runtime image is selected automatically |
| `executor: script`, `script.inlineScript` with an explicit `script.image` | The binary the selected runtime is run with — `python3`, `node`, `Rscript`, or, for `bash`, `sh` |

Minimal base images (`alpine`, `scratch`, distroless) ship none of this. `alpine` in particular has BusyBox `sh` but no `bash`, and no agent CLI at all, so an agent step pointed at it fails at container start — while a `runtime: bash` step runs there fine, because the engine hands the script to `sh`. They are only useful as the `FROM` line of an image you build on top of.

## Troubleshooting

- **`"/<path>": not found` on a `COPY`, for a path that exists in the repository** — with no `context` set, the build context is the Dockerfile's own directory, so it cannot reach files above it. Set `context`; see [Choosing the build context](#choosing-the-build-context).
- **`exec: "<binary>": executable file not found in $PATH`** — the image has no such executable. The container started and immediately exited 127. Point the step at an image that ships the tooling (see [Choosing a base image](#choosing-a-base-image)), or add it in a Dockerfile that builds `FROM` the minimal image.
- **`permission denied` running a script copied from an uploaded folder** — the browser cannot read file permissions, so **Local folder** uploads every file non-executable. Add `RUN chmod +x <script>` to the Dockerfile, or upload with `mediforce images build --context`, which keeps the bit.
- **The image still shows as missing** — check `mediforce system images`. The warning tracks what is on the daemon, not what exists in a registry, so it clears only once the image has actually been pulled or built onto the host — [pull it](#e-an-image-in-a-registry) to fix that now. If the reference is private, an administrator must `docker login` on the host.
- **`is already on the daemon … so pull another tag`** — that tag is on the daemon already. Pull a different tag, or catalogue what is there with [Existing image](#d-an-image-already-on-the-daemon).
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
carries no build labels, so nothing can derive its source; [cataloguing it is a
few clicks](#cataloguing-an-image-already-on-the-daemon), not a terminal.

### A Dockerfile the workflow carries

A step whose `dockerfile` names one of the workflow's own files builds on its
first run or dry run, with no repository involved, and the image shows up here
the same way, as **from workflow `<name>`**. Its versions are content hashes
rather than commits: an edit to any of the workflow's files builds a new
version. All of those files are the build context, so a `container/Dockerfile`
can `COPY scripts/`. It has no **Build** action, because a run is what builds it. A live workflow version that
runs on it blocks deleting it, like any other pin.

Such an image lasts as long as the workflow carries its files. **Publish as
image** on one of its versions rebuilds that version's files under a name in
your workspace (`<handle>/<name>:<tag>`) and catalogues it as an ordinary entry,
which stays after the workflow moves on. `mediforce images publish <entry-id>
--namespace <handle> --version <image-tag> --reference <handle>/<name>
[--tag <tag>] [--intent "..."]` does the same. The rules match an upload: the
tag must be new, and the first publish of a name needs the intent sentence.

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

## Cataloguing an image already on the daemon

For an image the daemon already holds with no build recipe behind it — pulled
by hand, loaded, or built on the host outside the platform — **Workspace →
Images → Add image → Existing image** picks it from every daemon repository no
entry yet describes and asks only for the name and the intent sentence: no
build, no upload, just a `referenced` entry naming the repository. Every tag it
has — now or added later — resolves as one of its versions, the same as an
uploaded image. A repository holding any image the platform built (a repo or
carried build, `mediforce-built`, `mediforce-artifacts`) is not offered: those
images are already offered as discovered entries, and the shared repositories
hold every workspace's builds. **Admin → Infrastructure** offers the same
action as a `+` on any other row with no catalog match, next to the `Layers`
icon a matched row links to its entry with; it opens the same dialog on that
row's repository, and still catalogues every tag of it. Both call the same
write **Add image**'s other tabs and `mediforce images create --reference
<repository>` do.

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
you want, for the reason above. `mediforce system rmi <id-or-tag>` and
**Admin → Infrastructure** still remove one image on its own, and the same live
pin blocks them: deleting by id weighs every tag that names the image, since
`docker rmi` on an id takes them all. If the daemon cannot be listed at that
moment those other tags cannot be checked, so the delete is refused rather than
guessed at — retry, or name the image as `repository:tag`, which needs no
listing.

**An image the engine falls back to keeps its image.** For the five a workspace
starts with, `--keep-images` is the only accepted form and the browser dialog
offers only the record-only delete. A step that names no image pins nothing, so
the live-pin check above is blind to every `runtime: python` step on the
deployment — and the daemon is shared, so removing `python` from a workspace
minutes old would break all of them
([ADR-0022](../adr/0022-image-catalog.md) decision 8).

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

For the workspaces themselves rather than the daemon,
`scripts/migrations/seed_default_image_catalogs.py --from-file handles.txt --apply`
gives each listed workspace the five entries a new one is created with. It needs
no draft phase — those sentences are written in `platform-core`, beside the
constants the engine runs from — and it is re-runnable: it writes only the
defaults a workspace is missing, reports that count, and never touches a row
somebody has already catalogued or edited.

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
- `mediforce images seed` — catalogue the five images a step falls back to when
  it names none, for a workspace created before that became automatic. Idempotent.
- `mediforce system status` — check Docker daemon reachability
