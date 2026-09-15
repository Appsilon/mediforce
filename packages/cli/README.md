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
to hunt disk, `postgres` and dangling layers included.

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
