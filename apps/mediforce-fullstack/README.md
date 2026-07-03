# mediforce-fullstack

An autonomous **issue → PR** agent for `Appsilon/mediforce`. On a 15-minute cron
it triages open issues **once** (persisting the verdict as `fullstack:` labels),
implements the confident ones as ready-for-review PRs, gates the ambiguous ones
for a human, self-reviews with a bounded revise loop, and auto-closes issues it
finds already fixed. Idempotent and self-healing via labels and a 2-hour lease.

## Pipeline (16 steps)

```
fetch-candidates ─┬─ triage ─ apply-verdicts ─ select ─┬─ (go)             claim ─ implement ─┐
 (list + partition,│  (classify   (write labels) (pick, │                                        │
  reclaim leases,  │   batch once)                deterministic)                                │
  attemptCount)    └─ (nothing new) ────────────── select ─┴─ (needs-approval) draft-plan ─ notify-gate ─ clarify-approve(human)
                                                          └─ (nothing)  done-empty                    approve ┘   reject → mark-needs-info

implement ─┬─ changed        → self-review ⇄ revise (≤2)  → publish → done
           ├─ already-fixed  → mark-fixed (comment + close) → done
           └─ confused/broken→ mark-needs-info → done
```

Only `triage`, `draft-plan`, `implement`, `self-review`, `revise` are LLM agents.
Everything else is deterministic script/action — no MCP, no `agentId`, no external
Agent Definition to configure.

## Label state machine (`fullstack:` namespace)

GitHub auto-creates these on first use; no pre-setup required.

| Label | Meaning | Set by |
|-------|---------|--------|
| `fullstack:go` | Confident → auto-implement (agent verdict **or** human override) | `apply-verdicts` / a human |
| `fullstack:needs-approval` | Doable, needs human sign-off first | `apply-verdicts` |
| `fullstack:manual` | Not automatable; needs a human | `apply-verdicts` |
| `fullstack:prio-high/med/low` | Selection order (on go / needs-approval) | `apply-verdicts` |
| `fullstack:in-progress` | Active lease (TTL 2h; reclaimed if stale) | `claim` |
| `fullstack:awaiting-human` | Gate plan posted; a human owns it (never reclaimed) | `notify-gate` |
| `fullstack:pr-open` | PR opened — done | `publish` |
| `fullstack:needs-info` | Parked after a gate rejection / bail | `mark-needs-info` |

**Analysed once:** an issue carrying any `fullstack:` verdict label is never
re-triaged, except a `manual` issue *edited since it was declined* (re-judge on
edit) or one a human force-labels `fullstack:go`.

## Environment & secrets

| Name | Secret | Scope | Used by | Meaning | How to set |
|------|--------|-------|---------|---------|-----------|
| `GITHUB_TOKEN` | **yes** | workflow | every script + implement/self-review/revise | GitHub PAT with **`contents:write` + `pull-requests:write`** on `Appsilon/mediforce` (branch push + PR + labels + close) | Workflow secrets |
| `OPENROUTER_API_KEY` | **yes** | workflow | all agent steps | OpenRouter key; bridged to the Claude Code CLI via `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL` | Workflow secrets |
| `FULLSTACK_REVIEWER_MAP` | **yes** | workflow | `notify-gate` | JSON `{ "githubLogin": "email-or-uid" }` of dev-team reviewers (must include the admin) | Workflow secrets |
| `FULLSTACK_DEFAULT_ADMIN` | **yes** | workflow | `notify-gate` | Fallback admin's **GitHub login** — must be a key in `FULLSTACK_REVIEWER_MAP` (their Mediforce id + cc handle are derived from it) | Workflow secrets |
| `APP_BASE_URL` | no | workflow/ns | `notify-gate` | Mediforce base URL for the gate comment link | Workflow/namespace env |
| `FULLSTACK_REPO` | no | workflow | all scripts | Target repo (default `Appsilon/mediforce`) | `build/env.json` |
| `LEASE_TTL_HOURS` | no | workflow | `fetch-candidates` | Stale-lease reclaim threshold (default `2`) | `build/env.json` |
| `MAX_ATTEMPTS` | no | workflow | `triage` | Poison-pill cap — after N failed attempts → `manual` (default `3`) | `build/env.json` |
| `REVIEW_MAX` | no | workflow | `publish` (+ transition) | Max revise passes before push-as-draft (default `2`) | `build/env.json` |

> **`GITHUB_TOKEN` write scope is the single most important thing to get right.**
> The whole pipeline pushes branches and opens PRs. A read-only token makes every
> `implement` fail → the lease is reclaimed in 2h → retried → a silent loop.

### The gate reviewer (how a human is selected + notified)

`clarify-approve.assignedTo` = `${steps.notify-gate.reviewerId}`. `notify-gate`
resolves it:

1. Issue **reporter's** GitHub login is a key in `FULLSTACK_REVIEWER_MAP` →
   assign the reporter (they own the issue), cc them.
2. Reporter is **not** in the map (external contributor / non-dev) → assign the
   fallback admin, cc **both** the reporter (fyi) and the admin (please pick up).

The fallback admin is `FULLSTACK_DEFAULT_ADMIN` — a single value holding the
admin's **GitHub login**. Their Mediforce id for `assignedTo` is looked up from
`FULLSTACK_REVIEWER_MAP[admin]`, and the same login is the cc handle — so there
is one admin value, not two. **The admin must therefore be a key in the map**;
if they aren't, `notify-gate` logs a misconfig warning and `assignedTo` would
fall back to the cron phantom.

Values in the map may be emails (resolved to a uid via `getUserByEmail`) or a
Mediforce uid directly. Being in the map == has a Mediforce account and is an
eligible approver.

**Two platform limitations this works around** (file/track separately):
- The platform does **not** dispatch `task_assigned` notifications — the GitHub
  cc comment is the *only* human ping. Don't remove it.
- Cron runs assign human tasks to a phantom `cron-heartbeat` user unless
  `assignedTo` is set — which is why the reviewer is always resolved explicitly
  and never left to the `pending`/role default.

## Output contracts (per step)

- `fetch-candidates` → `{ unclassifiedCount, unclassified[]:{number,title,body,url,author,attemptCount,poison,createdAt,updatedAt} }`
- `triage` (agent) → `{ verdicts[]:{issueNumber,suitability:go|needs-approval|manual,priority:high|med|low,reason} }`
- `apply-verdicts` → `{ applied, results[] }`
- `select` → `{ selected, issueNumber, suitability, priority, title, body, url, author }`
- `claim` → `{ issueNumber, claimed }`
- `draft-plan` (agent) → `{ issueNumber, planSummary, questions[] }`
- `notify-gate` → `{ issueNumber, reviewerId, reviewerIsCreator, creatorLogin, commented }`
- `implement` (agent) → `{ issueNumber, changed, branch, baseBranch, prTitle, prBody, summary, testsNote, reason?, evidence? }`
- `self-review` (agent) → `{ issueNumber, verdict:ship|flag|revise, concerns[] }`
- `revise` (agent) → `{ issueNumber, reviewCount, reviseLog[], applied[] }`
- `publish` → `{ issueNumber, prUrl, prNumber, branch, draft }`

## Build & edit

The `.wd.json` is **generated** — the inline scripts and agent prompts are
authored as readable files under `scripts/` and `prompts/`, then embedded (with
correct JSON escaping) by the assembler:

```bash
python3 build/build_wd.py        # regenerates src/mediforce-fullstack.wd.json
node   tests/run_tests.mjs        # pure-logic tests (19, no secrets)
for f in scripts/*.mjs; do node --check "$f"; done   # syntax
```

Non-secret env + tunables (`FULLSTACK_REPO`, `LEASE_TTL_HOURS`, `MAX_ATTEMPTS`,
`REVIEW_MAX`, and the `{{…}}` secret references) live in
[`build/env.json`](build/env.json). Edit `scripts/*.mjs` / `prompts/*.md` /
`build/env.json` and re-run the assembler — do **not** hand-edit the embedded
strings in the `.wd.json`.

## Register

```bash
pnpm exec mediforce workflow register \
  --file apps/mediforce-fullstack/src/mediforce-fullstack.wd.json --namespace appsilon
```

Reads the working tree — no commit needed (inline scripts, golden image, no
pinning). Validate first with `--dry-run`.

## Known gaps (intentional, documented — not silently accepted)

- **No in-container test execution.** `implement`/`self-review` cannot
  `pnpm install`, so they *write* tests but never run them; CI + the human
  reviewer are the typecheck/test gate.
- **`awaiting-human` has no TTL.** A gate assigned to a reporter who never
  answers sits indefinitely (the human owns it, unlike the `in-progress` lease).
  Planned: escalate stale `awaiting-human` (> N days) → re-ping / reassign to
  admin, alongside the Phase 2 stale-PR shepherd.
- **Rare duplicate PR** is accepted (the TOCTOU window between `select` and
  `claim`); recoverable by closing one PR.

## Deferred (Phase 2 — separate "shepherd" workflow)

Nudging stale open PRs (ping reviewers), stale-`awaiting-human` escalation, and
conditional auto-merge. These fan out over *existing* PRs/gates rather than
picking a single new issue, so they belong in their own workflow, not this
linear pipeline.
