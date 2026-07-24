---
name: use-mediforce
description: Work with the mediforce CLI, the dev environment, and the platform API. Use when running the app locally, invoking the platform from a script, calling the API from client code, or adding a CLI command that's missing. Triggers include "use the CLI", "run mediforce", "start dev", "start the app", "call the API", "list/get/create via API", "the CLI doesn't have X", "add a CLI command". Enforces the dogfood rule: CLI > REST. Never targets production.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
metadata:
  author: Mediforce
  version: "1.1"
  domain: development
  complexity: intermediate
  tags: cli, dev-env, api, dogfood
---

# Using Mediforce — CLI, Dev Env, and Platform API

## Dogfood rule

**Any operation the `mediforce` CLI covers MUST go through the CLI.** Never curl REST when `pnpm exec mediforce` does the job. If the command is missing, add it in the same task — see "Adding a command" below.

```bash
pnpm exec mediforce --help                 # discover commands
pnpm exec mediforce workflow list          # example
pnpm exec mediforce workflow list --json   # machine-readable
```

Auth: `MEDIFORCE_API_KEY` from your shell. Base URL: `MEDIFORCE_BASE_URL` (default `http://localhost:9003`; staging = `https://staging.mediforce.ai`).

**NEVER hit production.** No env var, no flag, no exception.

## REST fallback — only when no CLI command exists

### From the browser (`"use client"`)

```ts
// Preferred: typed contract client
import { mediforce } from '@/lib/mediforce';
const items = await mediforce.workflows.list();

// If the endpoint is not on the contract:
import { apiFetch } from '@/lib/api-fetch';
const res = await apiFetch('/api/custom-path');
```

**NEVER** use raw `fetch('/api/...')` from client components — middleware will 401 silently because the Firebase ID token isn't attached.

### From Node (server-to-server)

```ts
import { Mediforce } from '@mediforce/platform-api/client';
const client = new Mediforce({ apiKey: process.env.MEDIFORCE_API_KEY!, baseUrl: process.env.MEDIFORCE_BASE_URL });

// or raw, if needed:
await fetch(`${baseUrl}/api/...`, { headers: { 'X-Api-Key': apiKey } });
```

Only `@mediforce/platform-api/client` (and `/contract`, `/services`) are exported subpaths — never deep-import from `@mediforce/platform-api/src/*`. The CLI commands themselves all use this client; copy them as templates.

## Dev environment

| Command              | What runs                                                | Port  | When to use                                |
|----------------------|----------------------------------------------------------|-------|--------------------------------------------|
| `pnpm dev`           | Real Firebase + Docker agents                            | 9003  | Default — most realistic local setup       |
| `pnpm dev:mock`      | Mocked agents + seeded demo data                         | 9007  | Fastest spin-up, no cloud keys             |
| `pnpm dev:no-docker` | Agents via host `claude` CLI (no Docker)                 | 9003  | Local agent debugging without containers   |
| `pnpm dev:queue`     | Queue mode: BullMQ worker + Redis (`docker compose up`)  | 9003 + bull-board on 3100 | Testing queue-based agent runs |

For `dev:queue`: run `docker compose up -d` first (Redis + worker + bull-board), `docker compose down` after.

For `dev` to actually start: see `README.md` for one-time `.env.local` + Firebase CLI setup.

## Adding a CLI command

When you need an operation that the CLI doesn't have, add it in the same PR.

### Layout

```
packages/cli/src/
  commands/<domain>-<action>.ts        # one file per command
  cli.ts                                # dispatch table — wire here
  __tests__/<domain>-<action>.test.ts   # cover happy path + error
```

Existing examples: `workflow-list.ts`, `agent-get.ts`, `run-start.ts` — 21 commands in `packages/cli/src/commands/`. Copy the closest one as a template.

### Steps

1. **Copy a template** — pick the closest existing command (e.g. `workflow-list.ts` for a read, `secret-set.ts` for a write).
2. **Rename + edit** — adjust `HELP`, `_OPTIONS`, and the exported `<domain><Action>Command` function. Hit the platform via `Mediforce` client from `@mediforce/platform-api/client`.
3. **Wire in `cli.ts`** — import the new function, add a `case` in the dispatch and a line to the help text.
4. **Add a test** — co-located in `packages/cli/src/__tests__/`. Cover the happy path with `--json` output and at least one error case.
5. **Self-test** — `pnpm exec mediforce <domain> <action> --help` and a real invocation against `pnpm dev:mock`.

### When NOT to add a command

If the operation is:
- A one-off script for a single migration → write a Python script in `scripts/`, not a CLI command.
- UI-only (no value from terminal) → keep it in the UI.
- An internal handler called by the engine, not by users → keep it in `platform-api`.

## Missing capability decision tree

If the task needs something the codebase lacks (CLI command, endpoint, unmocked dep, blocking refactor), pause and pick:

- **a.** Open a GitHub issue, continue without it.
- **b.** Open a separate PR for the missing piece first.
- **c.** Spawn a new Claude Code thread / chip in parallel (desktop / web only).
- **d.** Spawn a subagent here to add it inline.

Default: small + mechanical → **d**. Larger or architectural → **b**.
