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
  platform-infra/   Postgres, NextAuth session store, email (Mailgun/SMTP)
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
understand → simplify → write test (RED) → implement (GREEN) → self-review → log → docs → ship
```

1. **Simplify first.** Before coding, ask: *can this be smaller?* Cut layers,
   abstractions, scope. KISS. The simplest change that solves the actual
   problem wins. For plans worth stress-testing (architectural change,
   new domain concept, anything you'd struggle to explain in two
   sentences), invoke `/grill-with-docs` — it challenges the plan against
   the codebase's language and surfaces fuzzy terms before you write code.
   Optional, not every task needs it.

2. **No tech debt — fix the rzeźba inline.** If you notice handmade code
   where a standard pattern would fit (custom string format where a
   library / JSON / Zod schema does it, per-domain helper where a
   generic in `platform-core` belongs, inline auth check where the
   wrapper exists, raw `fetch` where the CLI / client covers it), and
   the refactor is small + mechanical (≤ ~100 LOC, ≤ ~3 call sites,
   no behaviour change), **do it in the same PR**. Don't file a
   follow-up issue, don't leave a `TODO`, don't ship "we'll generalise
   when the second consumer lands". A follow-up that requires the
   next reader to remember context is debt; an inline refactor with
   the same diff that touches the code is free. Only defer when the
   change is architectural (new ADR, cross-package surface) or
   genuinely large — and then file the issue with a concrete fix
   shape, not a vague "improve X".

3. **Test first via `/new-test` — for product code.** Write a failing test at
   the lowest level that gives real signal before implementation. `/new-test`
   picks the level (L1 unit / L2 integration / L3 API E2E / L4 UI / L5
   external), scaffolds the file, and walks RED → GREEN. Product features
   MUST land at **L3** (proves storage backend + middleware + auth). For L4 UI
   journeys, use `/e2e-test`.

   **Don't test infra/tooling/workflow code.** CI scripts, build glue, dev
   tooling, workflow configs (`apps/*/workflow.yaml`), one-off migrations —
   these don't get unit tests. They get exercised by the thing they support
   (the actual CI run, the actual workflow execution). Writing tests for
   tests-of-tests is over-engineering. Use judgement; if you're unsure
   whether something is "product" or "tooling," ask. Also skip the test for
   trivial product edits (typo, comment, single-line config) — and say so
   out loud.

4. **Dogfood the CLI via `/use-mediforce`.** Any operation `pnpm exec mediforce`
   covers MUST go through it — never curl REST when the CLI does it. If the
   command is missing, add it in the same task. `/use-mediforce` also covers the
   dev environment (`pnpm dev*`), the REST fallback ladder (browser:
   `@/lib/use-mediforce` → `apiFetch` → never raw `fetch`; node: `Mediforce`
   client), and the recipe for adding a CLI command. **Never hit
   production.**

5. **Self-review before reporting done via `/self-review`.** Always invoke as
   a **subagent** — clean context yields honest review. The skill runs
   typecheck, affected tests, diff inspection, style audit, and
   `/code-review`, returning SHIP or ITERATE. Iterate until the diff is
   something you'd approve in someone else's PR.

6. **Ask, don't sneak.** If the codebase lacks something the task needs
   (missing CLI command, endpoint, unmocked dep, blocking refactor), STOP
   and offer:
   a. Open a GitHub issue and continue without it.
   b. Open a separate PR for the missing piece first.
   c. Spawn a new Claude Code thread / chip in parallel (desktop / web only).
   d. Spawn a subagent here to add it inline.
   Default: small + mechanical → (d); larger or architectural → (b).

7. **Main thread is manager and lead architect.** Owns the outcome,
   decomposes, delegates, narrates. Subagents are ICs doing the heavy
   lifting (sometimes architects themselves — Plan, code-review).
   Owning the outcome means verifying actual results, not avoiding
   spawn to stay "safe".

   - **NEVER run subagents or non-trivial bash in foreground.** ALWAYS
     `run_in_background: true` unless it's trivial bash (`ls`, `mv`,
     single `grep`). Foreground long work physically blocks the harness —
     UI won't accept user messages until it returns.
   - **Never go silent.** Decompose long work into small spawns
     (5×3min beats 1×20min). Tell the user upfront what's spawned +
     expected duration. Main-thread tool-calling between spawns
     naturally produces narration. One huge spawn = dead silence.
   - **Pick the right worker:**
     - Long command, output IS the answer (`pnpm test`, `docker build`)
       → `Bash(run_in_background: true)` + `Monitor`. Zero prompt-prep,
       prefer over subagent.
     - Multi-file exploration (>3 searches), parallel independent edits,
       fresh-eyes review of own diff, anything that'd dump significant
       output into main context → `Agent` subagent. Spawn parallel
       agents in one message when work is independent. To iterate on
       prior work with full context, `SendMessage` to the agent's ID
       instead of new `Agent`.
     - Heuristic: prompt-prep <30s AND task >2min → spawn. Otherwise
       main thread does it.

8. **No new Server Actions.** Phase 2/3 of the headless-platform-API
   migration is deleting `'use server'` files; do not introduce new ones.
   Every new mutation lands as `(input, scope) => output` in
   `packages/platform-api/src/handlers/` + a Zod contract + a route adapter
   in `packages/platform-ui/src/app/api/`. UI calls via `mediforce.X.Y()`
   from `@/lib/mediforce`; CLI / agents / tests reuse the same handler.
   Server Actions can only be called from React over RPC — they fork the
   contract from every other client. If a function genuinely needs
   `revalidatePath` / form-action / `redirect` semantics, ask before
   adding. See ADR-0005.

9. **Style.** English everywhere. No `any` — Zod + `z.infer`. No one-letter
   names. Self-documenting code over comments; NEVER add docstrings/types/
   comments to code you didn't change. Explicit boolean comparisons. Scripts
   in Python, not bash. Native platform > third-party. First-principles >
   clever workarounds. Voice input: interpret intent. NEVER use the
   `AskUserQuestion` tool — write a/b/c/... in plain text.

10. **Log it via `/add-changelog-entry`.** Every non-trivial PR appends a
   one-line bullet under `## [Unreleased]` in `CHANGELOG.md` using
   Keep-a-Changelog categories. Group several PRs covering one thing as a
   nested list. Skip only for trivial edits. Weekly cut is automated —
   never edit dated `## [YYYY-MM-DD]` sections by hand.

11. **Sync the docs via `/sync-docs`.** Before reporting done, run it — with no
    arguments it checks what *this session* changed and what that made untrue,
    then fixes it in the same diff. It routes each change to the doc that owns
    it: **colocated first** (touched `packages/foo/src/` → `packages/foo/README.md`
    is the file that now lies), then the routing table in `docs/README.md` for
    anything cross-cutting. Renamed a symbol → every doc naming it is stale;
    `/sync-docs` greps for them. New package or app → its README ships in this
    PR (`pnpm check:readmes` fails the build otherwise). `pnpm check:docs`
    catches broken links, never stale prose — passing CI is not evidence the
    docs are true. A doc fix is never a follow-up issue: the reader who hits the
    stale line has no way to know it is stale, which is how the retired wiki got
    to "`platform-infra` = Firestore repositories" (ADR-0017).

12. **No regressions.** Every migration / refactor / rewrite must keep the
    user-observable surface intact unless the user explicitly accepts the
    change. Before opening the PR, diff OLD vs NEW behaviour on every
    replaced read / write / endpoint / hook: visible rows, polled freshness,
    error messages, retry behaviour, ordering, defaults, pagination. Silent
    `.limit()` caps where the old code fetched everything, silent default
    flips, missing parity branches in the new abstraction — all regressions.
    Call them **regressions**, never "regression risk" — if you'd write
    "risk", reproduce the failing input first and either fix it in the PR
    or get explicit user acceptance with a tracked follow-up. `/code-review`
    checklist §3a enforces this; treat it as a SHIP gate.

13. **Safe defaults — new features ship deployable.** Every new env var /
    feature gets a safe default or degrades gracefully, so deploying new code
    needs no per-deployment config change and never breaks an environment that
    hasn't set it. Pick the default that keeps the common deployment working (a
    login method on by default, `false` only for the rare estate that opts
    out); **derive, don't require** (`APP_BASE_URL` from `NEXT_PUBLIC_APP_URL`);
    an unconfigured feature degrades to "not offered," never a crash. **Wire the
    whole path:** an env var read in code must also be forwarded in
    `docker-compose.prod.yml` (and any other runtime), or it silently never
    arrives — a `${VAR:-}` line missing there is why a "set it in `.env`"
    toggle does nothing. Fail loud (boot-fail) **only** when silent behaviour
    would actively harm users (e.g. emailing dead `localhost` login links) —
    and even then keep a default so a normal deploy never trips it. Complements
    §12: §12 protects existing surface, this protects new-feature rollout.

## Skills

Claude auto-loads every skill under `.claude/skills/` at session start —
descriptions are the router, no manual table needed. Reach for one when its
trigger phrases match the action you're about to take. List with
`ls .claude/skills/`.

For Codex: repo skills live in `skills/<name>/SKILL.md` and may be symlinked
under `.codex/skills/` for discovery. Treat them as shared workflow
instructions, but translate Claude-specific tool syntax instead of executing it
literally: `Agent(...)` → Codex subagents, `Bash` / `Read` / `Edit` / `Write` /
`Grep` / `Glob` → Codex shell and file tools, `WebFetch` → Codex web or GitHub
tools, and `agent-browser` CLI steps → the Codex Browser plugin when available.
Slash commands like `/new-test` mean "read and follow
`skills/new-test/SKILL.md`".

## Reminder — re-read at the top of every task

1. Simplify before coding.
2. No tech debt — small/mechanical refactor of adjacent rzeźba happens
   in this PR, not in a follow-up issue.
3. Test first via `/new-test` (RED → GREEN) at the lowest level with real
   signal. L3 is the foundation for every feature.
4. CLI > REST. `/use-mediforce` first; add the command if missing.
5. `/self-review` as a subagent before reporting done.
6. Ask, don't sneak, when a capability is missing.
7. No new Server Actions. Headless handler + route adapter + `mediforce.X.Y()`.
8. Main thread = manager + lead architect. NEVER fg subagent or
   non-trivial bash. Decompose, narrate, verify actual output.
9. Log non-trivial changes via `/add-changelog-entry`.
10. `/sync-docs` before reporting done — it checks this session's diff and
    fixes what it made untrue, in the same diff. Colocated README first,
    then the `docs/README.md` routing table. Never a follow-up issue.
11. No regressions. Diff OLD vs NEW user-observable behaviour on every
    replaced read / write / endpoint / hook. Silent `.limit()` caps, silent
    default flips, missing parity branches all count. Word them
    "regression", never "risk".
12. Safe defaults — a new env var/feature has a safe default or degrades
    gracefully; deploy needs no config change; wire the whole path (code +
    `docker-compose.prod.yml`); fail loud only on user-harming silence.

See `README.md` for one-time env setup (Node, pnpm, Firebase CLI, `.env.local`).
For the day-to-day dev loop (which `pnpm dev*` to run, test levels, CLI,
migrations, ports, troubleshooting) see [`docs/start/dev-quickref.md`](docs/start/dev-quickref.md).

**For everything else in `docs/`, read [`docs/README.md`](docs/README.md) first.**
It is the routing table: topic → path → audience → status. Every doc declares
`status: living | draft | historical` in its frontmatter — act on `living`, treat
`draft` as undecided, and cite `historical` only as a record of what was true
then.
