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
same `--dockerfile` and `--context`.
`images delete` removes an entry **and** the images behind it — one act,
because a record whose images stay is re-derived on the next read — which needs
admin of that workspace, audits under `_system` since the daemon is
deployment-wide, and is refused while a live workflow version still pins one of
them (`--keep-images` for the rare record-only case; `system rmi` still removes
one image by id or tag).
`images build --repo --commit [--dockerfile] [--context]` builds one version of a built
source there and then, instead of waiting for a workflow run to build it
lazily: it mints the same tag a build-mode step pinning that commit resolves
to, so that step finds the image cached rather than rebuilding it. It holds the
connection for the whole build — minutes, not the sub-second every other
command takes.

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
