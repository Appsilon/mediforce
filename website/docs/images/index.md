---
title: Container images
sidebar_label: Container images
sidebar_position: 3
---

# Container images

`script` and `agent` steps run inside a container image, and that image must
already be on the **deployment's Docker daemon** before the run starts. There is
no Mediforce image registry: the platform never pushes, holds no registry URL
and manages no registry credentials. "Available to the platform" always means
"present on that daemon".

Getting an image to a step takes two things:

1. **Create** it — get the image onto the daemon: build it, upload it or pull it.
2. **Register** it — catalogue it in your workspace's **Image Catalog**
   (**Workspace → Images**, `mediforce images`) with one sentence saying what it
   is *for*. The catalog is what the step editor's image picker offers.

Most paths below do both in one act. Any workspace member can create and
register images; only **Delete** needs workspace admin or owner.

## What a workspace starts with

A new workspace comes with five entries: `mediforce-golden-image`, which an
agent step runs in when it names no image, and the four an inline script step
runs in — `mediforce-node`, `python`, `rocker/r-ver` and `alpine`. They are
ordinary entries you can edit.

A workspace created before this became automatic opens on an empty catalog;
catalogue the same five with:

```bash
pnpm exec mediforce images seed --namespace <handle>
```

## Pick your path

Replace `<handle>` with your workspace handle throughout.

| You have… | Path | Platform can rebuild it? |
|---|---|---|
| A Dockerfile in a git repo the deployment can clone | [Git repository](#git-repository) | Yes, at any commit |
| A Dockerfile you want to ship inside the workflow | [Workflow files](#workflow-files) | Yes, on every file change |
| A Dockerfile in a local folder, no reachable repo | [Local folder](#local-folder) | No |
| An image already on the daemon | [Existing image](#existing-image) | No |
| An image in a registry (Docker Hub, `ghcr.io/…`) | [Registry image](#registry-image) | No — pull another tag |

Prefer the **git repository** path whenever the Dockerfile can live in a
clonable repo: the platform keeps the inputs, links every version to its
Dockerfile at a commit, and needs no host access.

An image moved with `docker save` / `docker load`, or a build that needs secrets
the platform cannot supply, needs shell access to the host. Ask an administrator
to put it on the daemon, then register it as an [existing image](#existing-image).

### Git repository

In the browser: **Workspace → Images → Add image → Git repository**. Give the
repository (`owner/repo`, or a full `git@…` / `https://…` URL), the Dockerfile
path if it is not `Dockerfile` at the root, a [build context](#build-context) if
the Dockerfile copies files from outside its own directory, a name and the
description. **Add to the catalog** creates the entry with no versions yet;
**Build** on the card, pick a commit, and the version appears a few minutes
later.

From the CLI:

```bash
pnpm exec mediforce images create --namespace <handle> --name "My agent" \
  --intent "Runs the SDTM mapping agent with pinned R packages" \
  --repo acme/workflow-repo [--dockerfile container/Dockerfile] [--context apps/my-workflow]

pnpm exec mediforce images build --namespace <handle> --repo acme/workflow-repo --commit <sha> \
  [--dockerfile container/Dockerfile] [--context apps/my-workflow]
```

You can also skip registering first: a step set to **Built from a git repo**
builds the image on its first run, tagged `mediforce-built:<hash>`. It then
appears in **Workspace → Images** within about 30 seconds, marked **Needs a
description** — **Describe** on the card registers it.

#### Build context

Every path a Dockerfile `COPY`s is resolved against the **build context**. With
no context set, it is the directory holding the Dockerfile, so a Dockerfile in a
subdirectory cannot reach files in its parent. Given
`apps/my-workflow/container/Dockerfile` containing `COPY scripts/ …`, the build
fails with `"/scripts": not found` even though `apps/my-workflow/scripts/`
exists.

Set `context` to the directory the Dockerfile should see — a path from the repo
root. Once it is set, `dockerfile` is read **from the context**, the way
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

`"context": "."` is the repo root. A path that climbs out of the repository is
refused before anything is cloned. The same field is **Build context** in the
browser and `--context` on the CLI.

### Workflow files

1. In the workflow editor, add the Dockerfile and everything it `COPY`s to the
   workflow's **Files** panel. Upload a folder to keep its structure, e.g.
   `container/Dockerfile` plus `scripts/`.
2. On the step, set **Image source → Built from workflow files** and pick the
   Dockerfile. All carried files are the build context.
3. Run or dry-run the workflow. The first run builds the image
   (`mediforce-artifacts:<hash>`); any edit to a carried file builds a new
   version.
4. **Workspace → Images** shows it as **from workflow `<name>`**, marked **Needs
   a description** — **Describe** registers it.

Such an image lasts as long as the workflow carries its files. To keep one after
the files move on, **Publish as image** on a version rebuilds it as
`<handle>/<name>:<tag>`, an ordinary entry any workflow can use:

```bash
pnpm exec mediforce images publish <entry-id> --namespace <handle> \
  --version <image-tag> --reference <handle>/<name> [--tag <tag>] [--intent "…"]
```

### Local folder

For a Dockerfile in no repository the deployment can clone, upload the folder it
builds from. **Workspace → Images → Add image → Local folder**, or:

```bash
pnpm exec mediforce images build --namespace <handle> --reference <handle>/my-agent \
  --context ./my-agent [--dockerfile container/Dockerfile] [--tag v1] \
  --intent "What this image is for"
```

- **The folder is the build context**, as `docker build ./my-agent` reads it.
  Everything the Dockerfile copies must be inside it.
- **The upload limit is 100 MiB.** What `.dockerignore` excludes is never
  uploaded; a folder over the limit is refused naming its largest entries.
- **The name starts with your workspace** — `<handle>/<name>`. Every workspace
  builds on one shared daemon, and the prefix stops one tagging over another's
  image.
- **A tag is never replaced.** `--tag` defaults to the upload time, and a tag
  already on the daemon is refused, since a workflow pinning it would start
  running something else.
- **The first upload describes the entry; later ones only add versions**
  (**Upload version** on the entry). Change the name or description with **Edit**.
- **The platform cannot rebuild it** — it deletes the folder once built.
- **Browser uploads lose executable bits.** Add `RUN chmod +x` to the
  Dockerfile, or upload with the CLI, which keeps them.

### Existing image

For an image already on the daemon — pulled or loaded by hand, or built on the
host — **Workspace → Images → Add image → Existing image**. Pick the repository,
give it a name and description, and **Add to the catalog**. Nothing is built;
every tag of that repository becomes a version of the entry.

```bash
pnpm exec mediforce images create --namespace <handle> --reference rocker/r-ver \
  --name "R 4.4 base" --intent "Plain R runtime for script steps"
```

### Registry image

**Workspace → Images → Add image → Registry image**: type the image reference
without a tag (`rocker/r-ver`, `ghcr.io/my-org/my-agent`), a tag (empty means
`latest`), a name and the description, then **Pull and add**. A later tag of the
same reference only adds a version.

```bash
pnpm exec mediforce images pull --namespace <handle> --reference ghcr.io/my-org/my-agent \
  --tag v1.0.0 --name "My agent" --intent "What this image is for"
```

- **A tag already on the daemon is refused, never re-pulled.** For a moving tag
  like `latest`, pull a pinned tag instead.
- **A tag, not a digest.** A reference with `@sha256:…` is refused.
- **A private registry needs an administrator.** The pull runs inside the
  `container-worker` container, so an administrator runs `docker login` on the
  host as the user whose config directory `DOCKER_CONFIG_DIR` points at (default
  `/home/deploy/.docker`) and restarts the worker. Until then the pull fails
  with the registry's `unauthorized`.

## Using the image in a step

Each agent and script step in the workflow editor has an **Image source**:

| Mode | Use for | Step fields it writes |
|---|---|---|
| **Ready image** | Local folder, existing, registry and published images | `image`, chosen from the catalog |
| **Built from workflow files** | Workflow files | `dockerfile` (a carried file) |
| **Built from a git repo** | Git repository | `repo`, `commit`, `dockerfile`, `context` |

The picker offers only catalogued images suited to the step: an agent step sees
agent-capable images, an inline script sees images with its runtime. An image
nobody has catalogued can still be typed in with **Name an image the catalog
does not list**, but registering it is what makes it discoverable for the next
author.

### Choosing a base image

A step runs its command *inside* the image, so the image must contain what the
command needs:

| Step | Needs in the image |
|------|--------------------|
| `agent` | The agent CLI (`claude` or `opencode`) and a shell — start from `mediforce-golden-image` |
| `script` with `command` | Whatever the command invokes (`python`, `Rscript`, `node`, …) |
| `script` with `inlineScript`, no `image` | Nothing — the runtime image is selected automatically |
| `script` with `inlineScript` and an explicit `image` | The runtime's binary: `python3`, `node`, `Rscript`, or `sh` for `bash` |

Minimal images (`alpine`, `scratch`, distroless) ship none of this. `alpine` has
BusyBox `sh` but no `bash` and no agent CLI, so an agent step pointed at it
fails at container start. Use them as the `FROM` line of an image you build.

## Check it worked

```bash
pnpm exec mediforce images list --namespace <handle>             # catalog entries and version counts
pnpm exec mediforce images show <entry-id> --namespace <handle>  # versions, base, layers
pnpm exec mediforce system images                                # every image on the daemon
pnpm exec mediforce system status                                # Docker daemon reachability
```

An entry reading `(no image on the daemon)` is registered but not created yet —
build, upload or pull it. The [readiness check](../run/verify.md) also reports a
step whose image is missing before a run starts.

## Editing and deleting

**Edit** on an entry changes its source, name and description
(`mediforce images update <entry-id>`). An entry's id is derived from its source,
so changing the repository or Dockerfile moves the entry to a new id; versions
built from the old source reappear as an entry marked **Needs a description**.

**Delete** removes the entry **and** every image behind it (`docker rmi` on each
tag it offered). It cannot be undone — there is no registry to restore from —
and it needs workspace admin or owner:

```bash
pnpm exec mediforce images delete <entry-id> --namespace <handle>
```

A delete is refused while a **live** workflow version pins one of the images;
the dialog names the workflow, version and steps and offers to archive that
version. The five default images keep their images on delete: steps that name
no image fall back to them across the whole deployment.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `"/<path>": not found` on a `COPY`, for a path that exists | The build context is the Dockerfile's own directory. Set a [build context](#build-context). |
| `exec: "<binary>": executable file not found in $PATH` | The image lacks the tool. Use an image that ships it, or [build on top](#choosing-a-base-image) of the minimal one. |
| `permission denied` running a script from an uploaded folder | Browser uploads drop executable bits. Add `RUN chmod +x`, or upload with the CLI. |
| The image still shows as missing | The check reads the daemon, not a registry. Pull or build it onto the host; `mediforce system images` confirms. |
| `is already on the daemon … so pull another tag` | That tag is already there. Pull a different tag, or catalogue it as an [existing image](#existing-image). |
| `not found locally and no repo+commit configured for auto-build` | A build-mode step has no inputs to build from. Set `repo` and `commit`, or use an image already present. |
