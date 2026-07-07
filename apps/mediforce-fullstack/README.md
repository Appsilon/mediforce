# mediforce-fullstack

An autonomous **issue → PR** agent for `Appsilon/mediforce`. On a 15-minute cron
it triages open issues **once** — cloning `main` and verifying each issue against
the actual code, then persisting the verdict as `fullstack:` labels and
**auto-closing the ones it proves obsolete** (already fixed, or targeting a
removed/migrated subsystem). It implements the confident ones as ready-for-review
PRs, gates the ambiguous ones for a human, self-reviews with a bounded revise
loop, then **watches CI on the PR and auto-fixes red checks** (bounded, handing
persistent failures to a human). Idempotent and self-healing via labels and a
2-hour lease.

## Pipeline (22 steps)

```
fetch-candidates ─┬─ triage ──── apply-verdicts ──── select ─┬─ (go)          claim ─ implement ─┐
 (list + partition,│  (clone main,  (write labels;    (pick,   │                                     │
  cap batch,       │   verify +      close obsolete   determin- │                                     │
  reclaim leases,  │   classify once)  cc author)      istic)   │                                     │
  attemptCount)    └─ (nothing new) ───────────────── select ─┴─ (needs-approval) draft-plan ─ notify-gate ─ clarify-approve(human)
                                                             └─ (nothing) done-empty                  approve ┘   reject → mark-needs-info

implement ─┬─ changed        → self-review ⇄ revise (≤2)  → publish ─┐
           ├─ already-fixed  → mark-fixed (comment + close) → done    │
           └─ confused/broken→ mark-needs-info → done                 │
                                                                       ▼
      ┌───────────────────── arm-timer → wait-ci → check-ci ─┬─ green  → mark-ci-green  → done
      │                         (deadline)  (~15m)            ├─ fix    → fix-after-tests ┘ (≤ CI_FIX_MAX)
      └─ (re-poll, ≤ CI_POLL_MAX) ──────────────────────────┤ wait                        (loops back to arm-timer)
                                                             └─ giveup → mark-ci-failed → done  (draft + hand to human)
```

The CI loop closes the feedback gap: `check-ci` reads the PR's check-runs, and
because the container cannot `pnpm install` to reproduce a failure, it **harvests
the real error text** (failing check names + annotations, `file:line: message`)
and hands it to `fix-after-tests`, which fixes statically and re-pushes. CI is the
reproduction environment; the loop converges on real signal, bounded by
`CI_FIX_MAX` fix rounds and `CI_POLL_MAX` pending polls.

Only `triage`, `draft-plan`, `implement`, `self-review`, `revise`, and
`fix-after-tests` are LLM agents. Everything else is deterministic script/action
— no MCP, no `agentId`, no external Agent Definition to configure.

## Label state machine (`fullstack:` namespace)

GitHub auto-creates these on first use; no pre-setup required.

| Label | Meaning | Set by |
|-------|---------|--------|
| `fullstack:go` | Confident → auto-implement (agent verdict **or** human override) | `apply-verdicts` / a human |
| `fullstack:needs-approval` | Doable, needs human sign-off first | `apply-verdicts` |
| `fullstack:manual` | Not automatable; needs a human | `apply-verdicts` |
| `fullstack:obsolete` | Proven no longer applicable → labelled **and closed** (reversibly, cc the author) | `apply-verdicts` |
| `fullstack:prio-high/med/low` | Selection order (on go / needs-approval) | `apply-verdicts` |
| `fullstack:in-progress` | Active lease (TTL 2h; reclaimed if stale) | `claim` |
| `fullstack:awaiting-human` | Gate plan posted; a human owns it (never reclaimed) | `notify-gate` |
| `fullstack:pr-open` | PR opened; CI loop may still be running | `publish` |
| `fullstack:ci-failing` | CI stayed red after the auto-fix budget — a human owns it | `mark-ci-failed` |
| `fullstack:needs-info` | Parked after a gate rejection / bail | `mark-needs-info` |

**Analysed once:** an issue carrying any `fullstack:` verdict label is never
re-triaged, except a `manual` issue *edited since it was declined* (re-judge on
edit), one a human force-labels `fullstack:go`, or a run flagged with
`FULLSTACK_REASSIGN=true` (see below).

### Re-assigning labels (`FULLSTACK_REASSIGN`)

`FULLSTACK_REASSIGN=true` (default off) is the deliberate escape hatch out of
"analysed once". While it is on, `fetch-candidates` feeds every issue that is
carrying **only a verdict or `needs-info` label** back into `triage`, and
`apply-verdicts` overwrites the stored verdict:

| Issue currently labelled | Reassign behaviour |
|--------------------------|--------------------|
| `fullstack:go` / `fullstack:needs-approval` | re-triaged; verdict + prio reconciled |
| `fullstack:manual` | re-triaged unconditionally (not just on edit) — this is how the stale-`manual` graveyard gets re-checked for obsolescence |
| `fullstack:needs-info` | `needs-info` stripped, then re-triaged |
| `fullstack:in-progress` (fresh lease) | **untouched** — live implementation work |
| `fullstack:pr-open`, `fullstack:awaiting-human` | **untouched** — in-flight / human-owned |
| `fullstack:in-progress` (stale lease) | reclaimed as usual (self-heal, unchanged) |

Reassigned issues re-judge **fresh** — they carry `attemptCount: 0` (the toggle
deliberately does not spend a rate-limited GitHub `events` call across the whole
backlog to recompute prior attempts), so the poison-pill count does not carry
over.

It is wired as a `{{FULLSTACK_REASSIGN}}` env ref, so you flip it from the
workflow/namespace panel with **no re-registration**. Use it to re-judge a
handful of issues after a prompt tweak — flip on, let a tick run, flip off.

**Do not use `FULLSTACK_REASSIGN` to drain a large backlog.** Since triage now
clones `main` and verifies each issue against the code, a batch of ~90 issues
cannot be judged reliably in one agent call, so `TRIAGE_BATCH_MAX` (default `10`)
caps the per-tick batch. But reassign re-collects the *whole* re-judgeable pool
every tick and only removes issues from it by closing them — so with the cap on,
it re-processes the same front-of-list 10 each tick instead of advancing. For a
full re-triage, reset the labels instead (below).

### Triage-only mode (`TRIAGE_ONLY`)

Set `TRIAGE_ONLY=true` (case-insensitive; default off) to run only the triage
half of the pipeline: classify the batch and **persist the verdict labels**
(including auto-closing proven-obsolete issues), then stop before `select` picks
anything to implement. Use it to audit what the triage brain decides — on its
own, or paired with `FULLSTACK_REASSIGN` to re-label the backlog over several
ticks without a single PR being opened — then review the labels by hand and flip
it off to resume implementation.

It is wired as a `{{TRIAGE_ONLY}}` env ref (no re-registration). Because
transition expressions cannot read env, `fetch-candidates` and `apply-verdicts`
echo the flag into their output as `triageOnly`; the transitions off both steps
route to `done-empty` when it is set, so the run ends right after the labels are
written.

### Re-triaging the whole backlog (`reset-labels.mjs`)

To re-classify every open, not-yet-implemented issue from scratch, strip its
`fullstack:` verdict/parked labels so it looks brand-new. `fetch-candidates` then
triages each **once** and never re-collects it, so a capped batch genuinely
drains over a few ticks — no `FULLSTACK_REASSIGN` needed.

```bash
# 1. Preview (dry-run is the default — mutates nothing):
GITHUB_TOKEN=… node scripts/reset-labels.mjs
# 2. Apply:
GITHUB_TOKEN=… DRY_RUN=false node scripts/reset-labels.mjs
# 3. Run the pipeline ⌈open-issues / TRIAGE_BATCH_MAX⌉ times (≈4 for ~100 issues),
#    REASSIGN off. Each tick triages 10 fresh issues that never come back.
```

`reset-labels` **preserves** in-flight / human-owned issues wholesale
(`in-progress`, `pr-open`, `awaiting-human`, `ci-failing`), skips closed issues
(open query only), and is idempotent. It is a manual maintenance tool, **not a
pipeline step** — it is not in the workflow definition.

## Environment & secrets

| Name | Secret | Scope | Used by | Meaning | How to set |
|------|--------|-------|---------|---------|-----------|
| `GITHUB_TOKEN` | **yes** | workflow | every script + implement/self-review/revise | GitHub PAT with **`contents:write` + `pull-requests:write`** on `Appsilon/mediforce` (branch push + PR + labels + close) | Workflow secrets |
| `OPENROUTER_API_KEY` | **yes** | workflow | all agent steps | OpenRouter key; bridged to the Claude Code CLI via `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL` | Workflow secrets |
| `FULLSTACK_REVIEWER_MAP` | **yes** | workflow | `notify-gate` | JSON `{ "githubLogin": "email-or-uid" }` of dev-team reviewers (must include the admin) | Workflow secrets |
| `FULLSTACK_DEFAULT_ADMIN` | **yes** | workflow | `notify-gate` | Fallback admin's **GitHub login** — must be a key in `FULLSTACK_REVIEWER_MAP` (their Mediforce id + cc handle are derived from it) | Workflow secrets |
| `FULLSTACK_REASSIGN` | no | workflow | `fetch-candidates` | Escape hatch: when `true` (case-insensitive; default off), force a re-judge of every issue carrying only a verdict/`needs-info` label — see [Re-assigning labels](#re-assigning-labels-fullstack_reassign) | Workflow secrets/env |
| `TRIAGE_ONLY` | no | workflow | `fetch-candidates`, `apply-verdicts` | When `true` (case-insensitive; default off), triage + persist verdict labels then stop before `select` — see [Triage-only mode](#triage-only-mode-triage_only) | Workflow secrets/env |
| `TRIAGE_BATCH_MAX` | no | workflow | `fetch-candidates` | Max issues handed to `triage` per tick (default `10`) — caps the grounded (clone + verify) triage pass; overflow re-collects next tick | Workflow secrets/env |
| `APP_BASE_URL` | no | workflow/ns | `notify-gate` | Mediforce base URL for the gate comment link | Workflow/namespace env |
| `FULLSTACK_REPO` | no | workflow | all scripts | Target repo (default `Appsilon/mediforce`) | `build/env.example.json` |
| `LEASE_TTL_HOURS` | no | workflow | `fetch-candidates` | Stale-lease reclaim threshold (default `2`) | `build/env.example.json` |
| `MAX_ATTEMPTS` | no | workflow | `triage` | Poison-pill cap — after N failed attempts → `manual` (default `3`) | `build/env.example.json` |
| `REVIEW_MAX` | no | workflow | `publish` (+ transition) | Max revise passes before push-as-draft (default `2`) | `build/env.example.json` |
| `CI_WAIT_MINUTES` | no | workflow | `arm-timer` | Minutes to wait per CI poll before checking (default `15`) — secret/env ref so it is changeable without re-registering | Workflow secrets/env |
| `CI_FIX_MAX` | no | workflow | `check-ci` | Auto-fix rounds before handing a red PR to a human (default `3`) | Workflow secrets/env |
| `CI_POLL_MAX` | no | workflow | `check-ci` | Consecutive pending polls before giving up on a stuck CI (default `4`) | Workflow secrets/env |

> `CI_WAIT_MINUTES` / `CI_FIX_MAX` / `CI_POLL_MAX` / `TRIAGE_BATCH_MAX` /
> `TRIAGE_ONLY` are config, not credentials — they are wired as `{{…}}` env
> references so they resolve from the workflow / namespace panel and can be
> re-tuned without re-registering. Transition expressions cannot read env, so the
> knobs that gate routing are enforced inside a JS step that echoes the decision
> into its output — `check-ci` emits `nextAction`; `fetch-candidates` /
> `apply-verdicts` emit `triageOnly` — for the transitions to switch on. If unset,
> each script falls back to the default above.

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

Values in the map may be emails or a Mediforce uid directly. `notify-gate`
emits the raw value as `reviewerId`; the platform run route resolves an
email-shaped `assignedTo` to its uid (via the user directory) before persisting
it as the task's `assignedUserId`, so the gate task lands in the approver's
queue — an email that matches no user hard-fails the run instead of stranding.
Being in the map == has a Mediforce account and is an eligible approver.

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
- `arm-timer` → `{ deadline, waitMinutes }`
- `check-ci` → `{ prNumber, branch, headSha, raw:passed|failed|pending, nextAction:green|fix|wait|giveup, ciRound, pollCount, failing[]:{name,conclusion,url,title,summary,annotations[]}, reason, giveupReason? }`
- `fix-after-tests` (agent) → `{ issueNumber, prNumber, ciRound, ciFixLog[], pushed, addressed[] }`
- `mark-ci-green` → `{ prNumber, ciGreen }`
- `mark-ci-failed` → `{ prNumber, issueNumber, ciFailed, reason }`

## Build & edit

The `.wd.json` is **generated** — the inline scripts and agent prompts are
authored as readable files under `scripts/` and `prompts/`, then embedded (with
correct JSON escaping) by the assembler:

```bash
python3 build/build_wd.py        # regenerates src/mediforce-fullstack.wd.json
node   tests/run_tests.mjs        # pure-logic tests (36, no secrets)
for f in scripts/*.mjs; do node --check "$f"; done   # syntax
```

Non-secret env + tunables (`FULLSTACK_REPO`, `LEASE_TTL_HOURS`, `MAX_ATTEMPTS`,
`REVIEW_MAX`, and the `{{…}}` secret references) live in
[`build/env.example.json`](build/env.example.json). Edit `scripts/*.mjs` / `prompts/*.md` /
`build/env.example.json` and re-run the assembler — do **not** hand-edit the embedded
strings in the `.wd.json`.

## Register

```bash
pnpm exec mediforce workflow register \
  --file apps/mediforce-fullstack/src/mediforce-fullstack.wd.json --namespace appsilon
```

Reads the working tree — no commit needed (inline scripts, golden image, no
pinning). Validate first with `--dry-run`.

## Known gaps (intentional, documented — not silently accepted)

- **No in-container test execution.** `implement`/`self-review`/`fix-after-tests`
  cannot `pnpm install`, so they never run the suite locally. The CI loop
  (`wait-ci → check-ci → fix-after-tests`) closes most of this gap by reacting to
  the *real* CI result on the PR and auto-fixing from the harvested error text;
  after `CI_FIX_MAX` rounds a persistent failure is drafted and handed to a human.
  A `wait-ci` pause holds the run open for the poll window, so a single attempt
  can live up to ~`CI_WAIT_MINUTES × (CI_FIX_MAX + CI_POLL_MAX)` minutes — fine,
  the wait/resume infra is built for it, and the issue stays `pr-open` (out of the
  pool) throughout.
- **`awaiting-human` has no TTL.** A gate assigned to a reporter who never
  answers sits indefinitely (the human owns it, unlike the `in-progress` lease).
  Planned: escalate stale `awaiting-human` (> N days) → re-ping / reassign to
  admin, alongside the Phase 2 stale-PR shepherd.
- **Rare duplicate PR** is accepted (the TOCTOU window between `select` and
  `claim`); recoverable by closing one PR.
- **`FULLSTACK_REASSIGN` is workflow-global, not per-run.** A workflow cannot
  reset its own secret/env, so the reassign flag is a manual flip-flop: while it
  is `true`, every cron tick re-triages the whole verdict/`needs-info` backlog and
  spends LLM budget on `triage` over all of it. Flip it on, let one tick run, flip
  it off. (A truly per-run flag would need a manual-trigger `triggerInput`, which a
  cron tick can't set — hence the global toggle.)

## Deferred (Phase 2 — separate "shepherd" workflow)

Nudging stale open PRs (ping reviewers), stale-`awaiting-human` escalation, and
conditional auto-merge. These fan out over *existing* PRs/gates rather than
picking a single new issue, so they belong in their own workflow, not this
linear pipeline.
