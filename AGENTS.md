# Agents Guidelines

<context>
Mediforce is a workflow + agent orchestration platform for pharma. Source treats
clinical terms (drug names, adverse events, CTCAE grades incl. Grade 5 = death,
Hy's Law, RECIST, CDISC SDTM/ADaM) as **technical content**: Zod fields,
fixtures, workflow config. No wellbeing check-ins, no hedging, no inflated
complexity estimates because of medical vocabulary.
</context>

<stack>
```
packages/
  platform-core/    Zod schemas, repo interfaces, in-memory test doubles
  platform-api/     Contract + framework-free handlers
  platform-infra/   Firestore, Firebase Auth, SendGrid
  platform-ui/      Next.js 15 App Router (dev :9003, e2e :9007)
  workflow-engine/  Engine, transitions, expression DSL
  agent-runtime/    PluginRegistry, AgentRunner, Docker spawn
  container-worker/ BullMQ worker (activated by REDIS_URL)
  example-agent/    Reference plugin implementation
  cli/              `mediforce` CLI (server-to-server)
apps/  per-domain apps   docs/  strategy, vision, architecture
```
Inter-package imports use `@mediforce/source` TS condition → `./src/index.ts`
in dev (no build).
</stack>

<development_rules>

Per-task flow: understand → plan & simplify → RED test → GREEN code →
self-test → self-review → report.

1. **Simplify first.** Before coding, ask: *can this be smaller?* Cut layers,
   abstractions, scope. KISS. The simplest change that solves the actual
   problem wins.

2. **Test first (RED → GREEN).** Write a failing test at the right level
   (see "Testing pyramid" below) before implementation. Skip ONLY for
   trivial edits (typo, comment, single-line config) and say so.

3. **Dogfood the CLI.** You MUST use `pnpm exec mediforce` for any operation
   it covers. NEVER curl REST when the CLI does it. If the needed command is
   missing, add it in the same task. Auth: `MEDIFORCE_API_KEY` from shell.
   Base URL: `MEDIFORCE_BASE_URL` (default localhost; staging =
   `https://staging.mediforce.ai`). NEVER hit production.

4. **REST fallback**, only when no CLI command exists:
   - Browser (`"use client"`): `mediforce.<domain>.<method>()` from
     `@/lib/mediforce`, or `apiFetch('/api/...')` if off-contract. NEVER raw
     `fetch('/api/...')` — middleware will 401 silently.
   - Node S2S: `new Mediforce({ apiKey, baseUrl })` from `@mediforce/cli`, or
     `fetch(url, { headers: { 'X-Api-Key': ... } })`.

5. **Self-test.** `pnpm typecheck` + `pnpm test:affected` after every edit;
   `pnpm test` before reporting done. Pick the lowest test level that
   gives real signal — see "Testing pyramid". Use `/e2e-test`
   (Playwright UI) only when the change is genuinely UI-only and lives
   in the browser — delegate to a background subagent. If a check fails
   for environment reasons (remote / emulator / proxy / weird state),
   check `docs/knowledge-base/wiki/gotchas/` or run `/knowledge-base`
   before debugging from scratch. If you can't run a check the change
   requires, say so. Do NOT claim success.

6. **Self code review — MUST run before reporting done.**
   (a) `git diff origin/main...HEAD` and read every line.
   (b) Run `/code-review` on your branch.
   (c) Reject your own hacks, dead code, scope creep, unjustified `any`,
   missing edge cases, "should work but I didn't try it". Iterate until the
   diff is something you'd approve in someone else's PR.

7. **Ask, don't sneak.** If the codebase lacks something the task needs
   (missing CLI command, endpoint, unmocked dep, blocking refactor), STOP
   and offer in plain text:
   a. Open a GitHub issue and continue without it.
   b. Open a separate PR for the missing piece first.
   c. Spawn a new Claude Code thread / chip in parallel (desktop / web only).
   d. Spawn a subagent here to add it inline.
   Default: small + mechanical → (d); larger or architectural → (b).

8. **Main thread is the architect, not an IC.** Delegate to subagents for
   multi-file research, scans >3 queries, test runs >30s, design, code
   review. Parallelize independent work. Verify the diff, not the agent's
   summary. NEVER delegate when it slows things down — a 30-second edit
   doesn't need a subagent.

9. **Style.** English everywhere. No `any` — Zod + `z.infer`. No one-letter
   names. Self-documenting code over comments; NEVER add docstrings/types/
   comments to code you didn't change. Explicit boolean comparisons. Scripts
   in Python, not bash. Native platform > third-party. First-principles >
   clever workarounds. Voice input: interpret intent. NEVER use the
   `AskUserQuestion` tool — write a/b/c/... in plain text.

10. **Log it in CHANGELOG.md.** Every non-trivial PR appends a one-line
    bullet under `## [Unreleased]` in `CHANGELOG.md` via
    `/add-release-notes`, using Keep-a-Changelog categories (Added /
    Changed / Deprecated / Removed / Fixed / Security / Dependencies).
    Group several PRs covering one thing as a nested list. Skip only for
    trivial edits (typos, single-line config, comment-only diffs).
    Weekly cut is automated — never edit dated `## [YYYY-MM-DD]` sections
    by hand.

</development_rules>

## Testing pyramid

Five levels. **Every feature MUST be solidly covered at L3 (API E2E)** —
that is the foundation, the proof it actually works against real
Firestore + middleware + auth. L1/L2 cover logic. L4 is sparse, on top.
L5 is opt-in.

| L | Name             | Runner     | Location                                  | What runs real                                                | When to add |
|---|------------------|------------|-------------------------------------------|---------------------------------------------------------------|-------------|
| 1 | Unit             | vitest     | `src/**/__tests__/*.test.{ts,tsx}` (co-located) | Pure functions, no I/O                                  | Always for pure logic — fastest signal |
| 2 | Integration      | vitest     | `packages/platform-ui/src/test/integration/*.test.ts` | Route handlers + engine + repos with in-memory fakes  | Multi-component logic; handler wiring with mocked services |
| 3 | API E2E          | Playwright | `packages/platform-ui/e2e/api/`           | Real Next server + Firebase emulators, HTTP only (no browser) | **Every feature.** Proves real wiring: Firestore queries, middleware, auth, contract |
| 4 | UI E2E           | Playwright | `packages/platform-ui/e2e/ui/`            | Real Next + emulators + browser; agent mocked (`MOCK_AGENT`)  | Main user paths only — sparse |
| 5 | External / Tier 2 | vitest    | `packages/platform-ui/e2e/external/`      | Real LLM (OpenRouter) + real MCP subprocesses                 | Touching agent-runtime / MCP / LLM integration. Off CI, opt-in (`pnpm test:external`), costs cents per run |

**UI E2E (L4) rules — read before writing one:**
- A UI test is a **real multi-step user journey**. Click → fill → navigate →
  assert outcome. NOT "is the button visible". Visibility/render assertions
  belong in unit / integration tests against the component.
- UI E2E proves the glue holds — pages, routing, client state, server
  actions, real Firestore reads. It does NOT test engine behaviour or
  edge cases — those belong at L2/L3.
- Default answer to "should this be a UI test?" is **no**. Write L3
  first. Add L4 only if the behaviour genuinely lives in the browser
  (rendering, focus, keyboard, drag, client-side state machines).

**API E2E (L3) rules:**
- HTTP-only Playwright tests using the `request` fixture. No `page`.
- Lives in the `api` Playwright project — no browser launched. Runs
  serial today; bumping workers > 1 is gated on per-test data isolation
  audit (single `MEDIFORCE_DATA_DIR` shared on the server).
- Real Next server (`webServer` in `playwright.config.ts`), real
  Firebase emulators, mocked agent (`MOCK_AGENT=true`).
- Every new endpoint / handler ships with an L3 covering the journey
  end-to-end through HTTP.

**Integration (L2) rules:**
- vitest in-process. Import route handlers directly
  (`import * as route from '@/app/api/.../route'`), mock
  `getPlatformServices()` with in-memory fakes.
- Fast (ms). Covers logic + wiring of handlers/services, but NOT
  Firestore queries, NOT real middleware. Don't claim "API works"
  from L2 alone — add L3.

**External / Tier 2 (L5) rules:**
- Run when changing code that talks to real LLM providers or spawns
  real MCP subprocesses.
- Gated by `OPENROUTER_API_KEY`. Skips with diagnostic if missing.
- NOT required for every PR. Run before merging changes to
  `agent-runtime` / `mcp-client` / model-related code.

## Skills router

Invoke before starting work when the task matches:
- `/code-review` — review a PR or branch diff
- `/e2e-test` — write or run E2E journey tests (incl. GIF recording)
- `/agent-browser` — visual UI verification in a live browser
- `/renovate-review` — review a Renovate dependency PR
- `/community` — Discord community update
- `/generate-pitch` — pitch deck
- `/knowledge-base` — wiki / synthesise architecture
- `/add-release-notes` — append bullet under `[Unreleased]` in `CHANGELOG.md`

Two tiers: `skills/` (dev-time slash commands, indexed in `skills/_registry.yml`)
and `apps/*/plugins/*/skills/` (runtime, loaded by `agent-runtime` via
workflow-definition `skillsDir` — paths hardcoded, don't move).

## Quick reference

```bash
# Dev
pnpm dev                                # platform-ui on :9003
pnpm dev:local                          # + local agent execution (claude on PATH)
pnpm dev:test                           # platform-ui :9007 + emulators + MOCK_AGENT
pnpm dev:redis                          # Redis :6379 — separate terminal
pnpm dev:worker                         # BullMQ worker — separate terminal (queue mode)

# Test — L1 unit + L2 integration (vitest)
pnpm typecheck
pnpm test:affected                      # <1s, changed files only
pnpm test                               # full L1 + L2 (~9s)
npx vitest run path/to/file.test.ts     # single file

# Test — L3 API E2E + L4 UI E2E (Playwright; delegate to background subagent)
python3 packages/platform-ui/scripts/bootstrap_e2e.py
cd packages/platform-ui && NEXT_PUBLIC_USE_EMULATORS=true pnpm test:e2e:auth          # all e2e (build + run ~4min; rebuild only on source/config change)
cd packages/platform-ui && NEXT_PUBLIC_USE_EMULATORS=true pnpm test:e2e:auth --project=api  # L3 only
cd packages/platform-ui && NEXT_PUBLIC_USE_EMULATORS=true pnpm test:e2e:auth --project=authenticated  # L4 only
# Iterating on a UI feature? Use `next dev` for hot-reload instead of next start:
cd packages/platform-ui && NEXT_PUBLIC_USE_EMULATORS=true E2E_DEV_SERVER=true pnpm test:e2e:auth --grep '<name>'
# After editing source, rebuild before next test:e2e:auth (or use E2E_DEV_SERVER=true):
cd packages/platform-ui && pnpm build:e2e

# Test — L5 External / Tier 2 (real LLM, opt-in, costs cents)
cd packages/platform-ui && OPENROUTER_API_KEY=... pnpm test:external

# CLI
pnpm exec mediforce --help
```

## Reminder — re-read at the top of every task

1. Simplify before coding.
2. Test first (RED → GREEN) at the lowest level with real signal.
   API E2E (L3) is the foundation for every feature. UI E2E (L4) is
   sparse — real multi-step journeys only, never "is button visible".
3. CLI > REST. `pnpm exec mediforce` first; add the command if missing.
4. Self code review (`git diff` + `/code-review`) before reporting done.
5. Ask, don't sneak, when a capability is missing.
6. Delegate to subagents when it parallelises. Not as ceremony.
7. Log non-trivial changes in `CHANGELOG.md` (`/add-release-notes`).

See `README.md` for one-time env setup (Node, pnpm, Firebase CLI, `.env.local`).
