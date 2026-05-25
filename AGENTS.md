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

## Per-task workflow

```
understand → simplify → write test (RED) → implement (GREEN) → self-review → log → ship
```

1. **Simplify first.** Before coding, ask: *can this be smaller?* Cut layers,
   abstractions, scope. KISS. The simplest change that solves the actual
   problem wins. For plans worth stress-testing (architectural change,
   new domain concept, anything you'd struggle to explain in two
   sentences), invoke `/grill-with-docs` — it challenges the plan against
   the codebase's language and surfaces fuzzy terms before you write code.
   Optional, not every task needs it.

2. **Test first via `/new-test` — for product code.** Write a failing test at
   the lowest level that gives real signal before implementation. `/new-test`
   picks the level (L1 unit / L2 integration / L3 API E2E / L4 UI / L5
   external), scaffolds the file, and walks RED → GREEN. Product features
   MUST land at **L3** (proves Firestore + middleware + auth). For L4 UI
   journeys with a GIF deliverable, use `/e2e-test`.

   **Don't test infra/tooling/workflow code.** CI scripts, build glue, dev
   tooling, workflow configs (`apps/*/workflow.yaml`), one-off migrations —
   these don't get unit tests. They get exercised by the thing they support
   (the actual CI run, the actual workflow execution). Writing tests for
   tests-of-tests is over-engineering. Use judgement; if you're unsure
   whether something is "product" or "tooling," ask. Also skip the test for
   trivial product edits (typo, comment, single-line config) — and say so
   out loud.

3. **Dogfood the CLI via `/use-mediforce`.** Any operation `pnpm exec mediforce`
   covers MUST go through it — never curl REST when the CLI does it. If the
   command is missing, add it in the same task. `/use-mediforce` also covers the
   dev environment (`pnpm dev*`), the REST fallback ladder (browser:
   `@/lib/use-mediforce` → `apiFetch` → never raw `fetch`; node: `Mediforce`
   client), and the recipe for adding a CLI command. **Never hit
   production.**

4. **Self-review before reporting done via `/self-review`.** Always invoke as
   a **subagent** — clean context yields honest review. The skill runs
   typecheck, affected tests, diff inspection, style audit, and
   `/code-review`, returning SHIP or ITERATE. Iterate until the diff is
   something you'd approve in someone else's PR.

5. **Ask, don't sneak.** If the codebase lacks something the task needs
   (missing CLI command, endpoint, unmocked dep, blocking refactor), STOP
   and offer:
   a. Open a GitHub issue and continue without it.
   b. Open a separate PR for the missing piece first.
   c. Spawn a new Claude Code thread / chip in parallel (desktop / web only).
   d. Spawn a subagent here to add it inline.
   Default: small + mechanical → (d); larger or architectural → (b).

6. **Main thread is the architect, not an IC.** Delegate to subagents for
   multi-file research, scans >3 queries, test runs >30s, design, code
   review. Parallelize independent work. Verify the diff, not the agent's
   summary. NEVER delegate when it slows things down — a 30-second edit
   doesn't need a subagent.

7. **Style.** English everywhere. No `any` — Zod + `z.infer`. No one-letter
   names. Self-documenting code over comments; NEVER add docstrings/types/
   comments to code you didn't change. Explicit boolean comparisons. Scripts
   in Python, not bash. Native platform > third-party. First-principles >
   clever workarounds. Voice input: interpret intent. NEVER use the
   `AskUserQuestion` tool — write a/b/c/... in plain text.

8. **Log it via `/add-changelog-entry`.** Every non-trivial PR appends a
   one-line bullet under `## [Unreleased]` in `CHANGELOG.md` using
   Keep-a-Changelog categories. Group several PRs covering one thing as a
   nested list. Skip only for trivial edits. Weekly cut is automated —
   never edit dated `## [YYYY-MM-DD]` sections by hand.

## Skills

Claude auto-loads every skill under `.claude/skills/` at session start —
descriptions are the router, no manual table needed. Reach for one when its
trigger phrases match the action you're about to take. List with
`ls .claude/skills/`.

## Reminder — re-read at the top of every task

1. Simplify before coding.
2. Test first via `/new-test` (RED → GREEN) at the lowest level with real
   signal. L3 is the foundation for every feature.
3. CLI > REST. `/use-mediforce` first; add the command if missing.
4. `/self-review` as a subagent before reporting done.
5. Ask, don't sneak, when a capability is missing.
6. Delegate to subagents when it parallelises. Not as ceremony.
7. Log non-trivial changes via `/add-changelog-entry`.

See `README.md` for one-time env setup (Node, pnpm, Firebase CLI, `.env.local`).
