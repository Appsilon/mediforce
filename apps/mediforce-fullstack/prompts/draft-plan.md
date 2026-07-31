## Task

An issue was triaged as `needs-approval` — actionable, but triage recorded at
least one open question it could not settle from the issue text alone. **Your job
is to close as many of those questions as possible yourself**, from the code and
the docs, and to hand a human only what genuinely needs a human.

Most questions that look like they need a human do not. They need someone to read
`AGENTS.md`, `CONTEXT.md`, `docs/`, the existing tests, and `git log`. That is
what this step is for.

### Inputs (under `## Previous Step Outputs`)
- `select` — the chosen issue: `issueNumber`, `title`, `body`, `url`, `author`.
- `select.blockers` — triage's open questions, each `{ question, kind }`. This is
  your worklist. It may be empty or absent (an issue triaged before blockers were
  recorded) — then derive the open questions yourself from the issue text.

### 1. Get the code

```
rm -rf /tmp/repo && git clone --depth 1 https://$GITHUB_TOKEN@github.com/Appsilon/mediforce.git /tmp/repo && cd /tmp/repo
```

Read `AGENTS.md` and `CONTEXT.md` (repo root) first for the conventions and the
canonical vocabulary, then `docs/` — `docs/adr/` for decisions already taken,
`CHANGELOG.md` and `git log` for what recently landed. Work read-only; this step
plans, it does not edit or push.

### 2. Work the blocker list

Take each blocker in turn and try to **answer it from the repo**:

- `missing-context` — a fact about the code or docs. You MUST resolve these. Find
  the file, the handler, the schema, the ADR, the test. "I could not find it" is
  only acceptable after you have actually grepped for it; say where you looked.
- `scope` — several approaches exist. Pick one **when the repo's own conventions
  decide it**: an established pattern in a sibling package, an ADR, the way the
  nearest analogous feature is built. Only escalate when the alternatives are
  genuinely equivalent and the choice is a matter of taste or product direction.
- `decision` — a product/policy call, a user-visible behaviour or public API
  choice with no precedent, an irreversible or destructive change, or a
  cross-package architectural direction. These are **not yours**. Escalate them.

Also drop any blocker that turns out to be moot (the code already answers it, or
the thing it worries about does not exist).

### 3. Decide who owns the rest

- Every blocker resolved, or the only survivors are `missing-context` / `scope`
  you settled → `needsHuman: false`. Write the plan; `implement` runs straight
  after you and reads your `planSummary` and `resolvedAnswers`. Be specific
  enough that it does not have to re-derive your research: name the files, the
  functions, the pattern to follow, and where the test goes.
- At least one genuine `decision` survives → `needsHuman: true` and list it under
  `questions`. Those questions go to a human on GitHub, so make them sharp and
  answerable — an actual choice with named options, not "is this ok?".

**Do not escalate as insurance.** A `needsHuman: true` you did not have to raise
stalls the issue indefinitely (`fullstack:awaiting-human` has no expiry) and
costs a person's attention. A `needsHuman: false` that turns out wrong costs one
implement pass and a PR that gets reviewed like any other. Prefer the second.
Equally: do not suppress a real `decision` to look decisive — an autonomous PR
that quietly makes a product call is worse than a question.

### 4. Write the plan

- `planSummary` — the approach, 3–6 sentences. Concrete: the files to change, the
  existing pattern to follow, and where the test goes.
- `resolvedAnswers` — one entry per blocker you closed, each
  `{ question, answer, evidence }` where `evidence` is the `file:line`, ADR,
  commit, or doc section that settles it. `implement` reads these, so they carry
  your research forward.
- `questions` — ONLY the unresolved `decision`-kind questions. Empty when
  `needsHuman` is false.

## Completion criteria

Finish as soon as every blocker is resolved, dropped as moot, or retained as a
genuine human decision, and the plan carries the evidence `implement` needs.
Research only the listed blockers (or concrete questions derived from an absent
list); do not continue through docs or history once they cannot change the plan
or the `needsHuman` decision.

## Output Contract (MANDATORY)

Headless step — no human reads your chat. Write ONLY this JSON to
`/output/result.json`:

```json
{
  "issueNumber": 123,
  "needsHuman": false,
  "planSummary": "...",
  "resolvedAnswers": [{ "question": "...", "answer": "...", "evidence": "file:line | ADR | commit" }],
  "questions": [],
  "confidence": 0.0,
  "confidence_rationale": "..."
}
```

`needsHuman` MUST be present and a real boolean: `true` whenever `questions` is
non-empty, `false` whenever it is empty. The workflow routes on it — `false`
implements directly, and **anything else (including omitting it) falls back to
the human gate**, so the eager path only happens when you say `false` explicitly.
`confidence` (0–1) is how often a plan researched like this would be right; it is
recorded for observability and does **not** route the run.

Your FINAL message must be ONLY: `{"output_file": "/output/result.json", "summary": "planned #<n> (needsHuman: <bool>)"}`.
