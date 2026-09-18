# @mediforce/cli

The `mediforce` command — a server-to-server client for the platform, and the
supported way to drive Mediforce from a script, an agent, or your shell.

```bash
pnpm exec mediforce workflow list
pnpm exec mediforce run start <workflow>
pnpm exec mediforce task complete <taskId>
```

## Why it exists

**If the CLI covers an operation, use it — never hand-rolled REST.** Curling an
endpoint duplicates auth, error handling and output shaping that already exist
here, and it silently forks from the contract the moment a handler changes. When
a command is missing, add it in the same task rather than reaching for `fetch`.

Commands are thin: each one parses flags, calls a handler through
[`@mediforce/platform-api`](../platform-api/README.md), and prints. Business
logic belongs in the handler, where the UI and agents get it too.

## Layout

```
bin/mediforce.cjs        Executable entry
src/cli.ts               Command wiring
src/define-command.ts    Command definition helper — start here to add one
src/commands/            One file per command
src/config.ts            Profile / credential resolution
src/output.ts            Human and JSON output shaping
src/errors.ts            Exit-code mapping
```

Sixty-plus commands across workflows, runs, tasks, agents, namespaces,
users, secrets, models, cowork, config, images and system.

`mediforce images` and `mediforce system images` are different things and the
names are close enough to be worth stating: `images` is the per-namespace
**Image Catalog** — the images a workspace offers for steps, one row per source
with a sentence saying what each is for ([ADR-0022](../../docs/adr/0022-image-catalog.md)).
`system images` is the raw, deployment-wide Docker daemon listing an admin uses
to hunt disk, `postgres` and dangling layers included. `images list` indents each
entry under the one its images were built on — computed from image layers, not
from a `FROM` string — and `images show` prints, per version, that base and the
layer summary the version adds over it. A row reading *"built here, not
described yet"* is a source the platform built for that namespace which nobody
has written a sentence for; `images create` on its source registers it
([ADR-0022](../../docs/adr/0022-image-catalog.md) decision 7). `images update`
changes an entry's name, intent or **source** — and since the id derives from
the source (decision 1), `--repo` / `--reference` re-key the entry, so the
command prints the id it moved to rather than the one you passed. `--repo`
replaces the whole built source, so pass `--dockerfile` and `--context` with it;
either one left out resets to its default. `images create --repo` takes the
same `--dockerfile` and `--context`; `images create --workflow <name> --dockerfile
<path>` describes a Dockerfile a workflow carries (a `carried` source), whose
versions `images show` prints with their content hash where a built one prints
its commit.
`images publish <entry-id> --version <image-tag> --reference <handle>/<name>
[--tag] [--intent]` copies one version of a carried entry into a `referenced`
one, so the image outlives its workflow: the platform rebuilds that version's
build context from the workflow version that carried it, through the same path
as `images build --reference`, and under the same rules.
`images delete` removes an entry **and** the images behind it — one act,
because a record whose images stay is re-derived on the next read — which needs
admin of that workspace, audits under `_system` since the daemon is
deployment-wide, and is refused while a live workflow version still pins one of
them (`--keep-images` for the rare record-only case; `system rmi` still removes
one image by id or tag). An entry naming an image the engine falls back to when
a step names none refuses the image half outright and takes only `--keep-images`:
a `runtime: python` step pins nothing, so the live-pin check cannot see what
deleting `python` would break across the deployment.
`images seed` catalogues exactly those engine defaults — the golden image and
the four script runtimes. Every workspace is created with them (#1376), so this
is for a workspace created before that, or one whose seed lost a race with an
outage; it is idempotent, and `scripts/migrations/seed_default_image_catalogs.py`
runs it over a list of handles.
`images build --repo --commit [--dockerfile] [--context]` builds one version of a built
source there and then, instead of waiting for a workflow run to build it
lazily: it mints the same tag a build-mode step pinning that commit resolves
to, so that step finds the image cached rather than rebuilding it. It holds the
connection for the whole build — minutes, not the sub-second every other
command takes.
`images build --reference <handle>/<name> --context <dir> [--dockerfile] [--tag]`
is the same command for a Dockerfile in no repo the deployment can clone: it
packs the local directory into a tar (`src/build-context.ts`, with
`platform-core`'s packer rather than the system `tar`, whose macOS build adds
`._*` files a `COPY .` would carry into the image), leaving out what its
`.dockerignore` excludes — read by `platform-core`'s `buildContextFilter` the
way `docker build` reads it, `<Dockerfile>.dockerignore` first. The walk only
stats, skips an excluded directory whole, and refuses a context over the limit
naming its largest entries before reading a byte. It then checks the archive with
`checkBuildContextArchive` before uploading, and the platform builds and
catalogues it as a `referenced` entry. `--intent` is required the first time a
reference is uploaded; `--declared-*` record where it came from, as declared.
`--name`, `--intent` and `--declared-*` describe the entry the first upload
creates: a later upload may repeat them unchanged, and is refused if they differ.
`images pull --reference <registry image> [--tag] [--name] [--intent]` puts a
registry image on the deployment's daemon with `docker pull` and catalogues it
as a `referenced` entry, under the upload's rules: the first pull of a reference
needs `--intent`, a later tag only adds a version, and a tag already on the
daemon is refused. `--tag` defaults to `latest`; Docker Hub references are stored
as the daemon lists them (`docker.io/library/python` → `python`), and a name
under another workspace's handle is refused.

## Rules

**Never point it at production.** Development targets a local platform; staging
is explicit and deliberate.

**A secret the platform shows once, the CLI prints first.**
`namespace create-join-link` leads with the URL and then says the token cannot
be shown again, because only its hash is stored
([ADR-0021](../../docs/adr/0021-workspace-join-links.md)). A command that buries
a once-only value under its metadata is a command whose output gets truncated
past the part that mattered.

**Every command supports machine-readable output.** Agents parse this. Adding a
command that only prints prose makes it unusable by half its callers.

Recipe for adding a command, plus the dev-environment and REST fallback ladder:
the `use-mediforce` skill.
