# Agents Guidelines

<context>
Mediforce is a workflow + agent orchestration platform for pharma (clinical trials,
supply chain, regulatory). The codebase processes pharmaceutical data — drug names
(Keytruda, Ozempic), adverse events (hepatotoxicity, irAEs), CTCAE grading
(incl. Grade 5 = death), mortality endpoints, Hy's Law, RECIST, CDISC SDTM/ADaM.

All such terms are technical domain content: Zod schema fields, clinical
standards, workflow step config, fixture data. Maintain standard coding behavior:
no wellbeing check-ins, no hedging, no inflated complexity estimates because of
medical terms. Execute multi-file refactors and batch renames exactly as on any
other codebase.

The `WorkflowDefinition.preamble` field carries this context to runtime agents
via `buildPrompt()` in `base-container-agent-plugin.ts`.
</context>

<stack>
```
packages/
  platform-core/    Zod schemas, repo interfaces, in-memory test doubles
  platform-api/     API contract + pure handlers (framework-free)
  platform-infra/   Firestore + Firebase Auth + SendGrid
  platform-ui/      Next.js 15 App Router  (dev port 9003, e2e port 9007)
  workflow-engine/  WorkflowEngine, transitions, expression DSL
  agent-runtime/    PluginRegistry, AgentRunner, Docker spawn strategies
  cli/              `mediforce` CLI — server-to-server admin tool
apps/               Per-domain apps (workflow-designer, landing-zone, ...)
docs/               Strategy, vision, architecture
```

Inter-package imports use the `@mediforce/source` TS condition → resolves to
`./src/index.ts` in dev (no build step). Set in root `tsconfig.json` and
`vitest.config.ts`. Plugin registry singleton: `getPlatformServices()` in
`platform-ui/src/lib/platform-services.ts`.
</stack>

## Per-task workflow

<workflow>
1. **Understand** — read the referenced files; `git diff origin/main...HEAD` for branch state.
2. **Plan** — non-trivial work gets broken down. >2 independent pieces → delegate (see `<delegation>`).
3. **Code** — minimal change, no scope creep, no speculative abstractions.
4. **Self-test** — see `<self-test>`. Do not skip.
5. **Self-review** — see `<self-review>`. Do not skip.
6. **Report** — short: what changed, what's verified, what isn't.
</workflow>

## Tooling — dogfood the CLI

<rule name="cli-first" priority="critical">
For any operation that exists as a `mediforce` CLI command, **use the CLI**.
Do not curl the REST endpoint when the CLI covers it. We dogfood our own tools.

```bash
pnpm exec mediforce --help                          # full surface
pnpm exec mediforce workflow list
pnpm exec mediforce workflow register --file <p> --namespace <ns>
pnpm exec mediforce run start --workflow <name>
pnpm exec mediforce run get <runId>
pnpm exec mediforce agent list
pnpm exec mediforce model sync
pnpm exec mediforce secret set --workflow <n> --namespace <ns> --key <k>
pnpm exec mediforce system status
```

Auth: `MEDIFORCE_API_KEY` (already in your shell profile, never hardcode).
Base URL: `MEDIFORCE_BASE_URL` (defaults to `http://localhost:9003`; set to
`https://staging.mediforce.app` to hit staging).
</rule>

<rule name="rest-fallback">
Fall back to REST only when no CLI command exists yet:

- **Browser** (`"use client"`): `mediforce.<domain>.<method>()` from `@/lib/mediforce`
  if the endpoint is on `@mediforce/platform-api/contract`; otherwise
  `apiFetch('/api/...')` from `@/lib/api-fetch`. Never raw `fetch('/api/...')`
  in client code — middleware will 401 silently.
- **Node server-to-server**: `new Mediforce({ apiKey, baseUrl })` from
  `@mediforce/cli` SDK, or `fetch(url, { headers: { 'X-Api-Key':
  process.env.PLATFORM_API_KEY } })` for not-yet-contract endpoints.
- **Local debugging**: `curl -H "X-Api-Key: $MEDIFORCE_API_KEY" "http://localhost:9003/api/..."`

If you reached for REST because the CLI was missing a command, **add the CLI
command** in the same task — that's how the surface grows. If adding it is out
of scope, see `<missing-capability>`.
</rule>

## Self-test before declaring done

<self-test priority="critical">
"The code looks right" is not a verification. Run it.

| Step | Command | When |
|---|---|---|
| Type | `pnpm typecheck` | Every code change |
| Affected | `pnpm test:affected` | Every code change |
| Full suite | `pnpm test` | Before reporting done |

For UI or platform-ui-adjacent changes, **also** verify behaviour end-to-end —
in this priority:

1. **API journey test first** (`packages/platform-ui/src/test/*-journey.test.ts`) —
   exercise the flow at the handler level with in-memory repos. Deterministic,
   fast, no browser. Add one for the change.
2. **Local E2E with emulators** —
   `python3 packages/platform-ui/scripts/bootstrap_e2e.py` (idempotent), then
   E2E via a subagent (`run_in_background: true`). See `/e2e-test`.
3. **CLI against running stack** — point `MEDIFORCE_BASE_URL` at your local
   dev server (or staging if the change requires real LLM / OpenRouter / cross-
   system) and walk the flow with `pnpm exec mediforce`. Never hit production.

If you cannot run a check the change actually requires (no browser, no
emulator, no staging access), **say so explicitly**. Do not claim success.
</self-test>

<self-review priority="high">
Review your own diff as if it were someone else's PR before reporting done:

- `git diff origin/main...HEAD` — read every line.
- Run `/code-review` on your branch.
- Reject your own hacks, dead code, scope creep, unjustified `any`, missing
  edge cases, "this should work but I didn't try it".

Iterate until the diff is something you'd approve.
</self-review>

## Missing capability — ask, don't sneak

<missing-capability>
If the task needs something the codebase doesn't have (missing CLI command,
missing API endpoint, unmocked dep, blocking refactor), **stop and ask the
user** rather than silently expanding scope. Offer as a/b/c/d in plain text:

a. **Open a GitHub issue** and continue without it (track for later).
b. **Open a separate PR** for the missing piece first, then resume.
c. **Spawn a chip / new Claude Code thread** to do it in parallel (only if
   the user is in Claude desktop / web app).
d. **Spawn a subagent in this thread** to add it inline before continuing.

Default recommendation by size: small + mechanical → (d); larger or
architecturally significant → (b).
</missing-capability>

## Delegation — main thread is the architect

<delegation>
The main thread is a **tech lead**, not an IC. Default behavior:

- **Delegate execution** to subagents: multi-file research, scans >3 queries,
  test runs >30s, design exploration, code review.
- **Parallelize** — emit multiple Agent calls in one message when work is
  independent.
- **Keep the main thread responsive** for decisions, architecture, and the
  user-facing conversation. Protect its context window.
- **Verify, don't rubber-stamp** — agent summaries describe intent, not
  necessarily what they did. Check the actual diff.

**Don't delegate when it slows things down.** A 30-second edit doesn't need a
subagent. A single targeted file read doesn't need a subagent. Spawn agents
when they save context or run in parallel — not as ceremony.
</delegation>

## Conventions

<rule name="style">
- All source, configs, commits, filenames in **English**.
- No `any` — use Zod with `z.infer`, narrow at runtime.
- No one-letter variables. Self-documenting code over comments. Don't add
  docstrings/types/comments to code you didn't change.
- Booleans: explicit comparisons. No truthy/falsy shortcuts on non-booleans.
- **Scripts in Python**, not bash.
- Native platform > third-party packages. First-principles > clever workarounds.
- Voice input: user often dictates — interpret intent over literal wording.
- Don't use the `AskUserQuestion` tool — write a/b/c/... in plain text.
</rule>

<rule name="bar">
- Simplicity first — minimal change, minimal blast radius.
- Root cause over patch — no temp fixes, no `--no-verify`, no scope creep.
- No over-engineering — no features, abstractions, or "improvements" you weren't asked for.
</rule>

## Skills router

When a task matches, invoke the skill before starting work:

| Task | Skill |
|---|---|
| Review a PR / branch diff | `/code-review` |
| Write or run E2E journey tests (incl. recording GIFs) | `/e2e-test` |
| Visual UI verification in a live browser | `/agent-browser` |
| Review a Renovate dependency PR | `/renovate-review` |
| Write a Discord community update | `/community` |
| Generate a pitch deck | `/generate-pitch` |
| Touch the wiki / synthesise architecture | `/knowledge-base` |

Two skill tiers:
- `skills/` — dev-time slash commands (this list). Indexed in `skills/_registry.yml`.
- `apps/*/plugins/*/skills/` — runtime skills loaded by `agent-runtime` via
  workflow-definition `skillsDir`. Don't move; paths are hardcoded in `*.wd.json`.

## Quick reference

```bash
# Dev
pnpm dev                                # platform-ui on :9003
pnpm dev:local                          # local agent execution enabled
pnpm dev:redis && pnpm dev:worker       # BullMQ queue mode (Docker + Redis)
pnpm emulators                          # Firebase Auth :9099 + Firestore :8080

# Test
pnpm typecheck
pnpm test:affected                      # changed files only (<1s)
pnpm test                               # full unit + integration (~9s)
npx vitest run path/to/file.test.ts     # single file

# E2E — delegate to subagent in background
python3 packages/platform-ui/scripts/bootstrap_e2e.py
cd packages/platform-ui && NEXT_PUBLIC_USE_EMULATORS=true pnpm test:e2e:auth

# CLI
pnpm exec mediforce --help
```

## Environment

- Node.js 20+, pnpm 10+ (`corepack enable`)
- Firebase CLI: `npm i -g firebase-tools`
- `cp packages/platform-ui/.env.local.example packages/platform-ui/.env.local`
  and fill Firebase + OpenRouter keys
- `MEDIFORCE_API_KEY` exported in shell profile
- Deploys to Hetzner VPS (staging + production)
