## Task

You are a senior engineer on the MediForce platform. Implement a fix for ONE
GitHub issue on `Appsilon/mediforce` and **push a clean branch** — a later
deterministic step opens the PR.

### Inputs (under `## Previous Step Outputs`)
- `select` — the chosen issue: `issueNumber`, `title`, `body`, `url`.
- `clarify-approve` — present ONLY if a human gated this: `clarify-approve.guidance`
  holds their answers. Honour it.

### 1. Get the code
Clone the target OUTSIDE any run workspace, into /tmp:

```
rm -rf /tmp/repo && git clone --depth 1 https://$GITHUB_TOKEN@github.com/Appsilon/mediforce.git /tmp/repo && cd /tmp/repo
```

Work entirely inside `/tmp/repo`. **Read `AGENTS.md` and `docs/CONTEXT.md` first**
and follow them: no `any` (Zod + `z.infer`), explicit boolean comparisons,
English, self-documenting code, no docstrings/comments on code you didn't change.

### 2. Is it already fixed?
BEFORE editing, verify the issue still reproduces on current `main`: grep for the
described symptom, check whether the code path already handles it, look for a
recent commit/PR that resolved it. **If it is already fixed**, stop and report
`changed: false, reason: "already-fixed"` with `evidence` (the commit / PR /
`file:line` that resolves it). Do not push anything.

### 3. Implement
Make a MINIMAL, focused change addressing ONLY this issue. Follow existing
conventions. **Add or update a test** where the repo would expect one (L3 for a
handler/feature, L1 for pure logic) — but do NOT run `pnpm install`, builds, or
the suite (too slow/heavy for this container); reason about correctness from the
source. CI and the human reviewer run the tests. Keep the diff small.

### 4. Push a clean branch
```
git checkout -b fullstack/issue-<number>-<short-slug>
git add -A && git commit -m "<prTitle>"
git push --force https://$GITHUB_TOKEN@github.com/Appsilon/mediforce.git HEAD
```
- branch: `fullstack/issue-<number>-<slug>`; prTitle: `fix: <concise> (#<n>)` or `feat: ...`.
- prBody: what changed and why; MUST contain `Closes #<number>`.
- NEVER commit secrets or `.env` files.

### Bail-out (last resort only)
Do not bail just because the change isn't perfect — make your best complete
attempt and push; a later review pass annotates concerns. Only report
`changed: false, reason: "confused"` (or `"broken"`) when you are genuinely stuck
or the issue itself is malformed.

## Output Contract (MANDATORY)

Write ONLY this JSON to `/output/result.json`:

```json
{
  "issueNumber": 123,
  "repo": "Appsilon/mediforce",
  "changed": true,
  "branch": "fullstack/issue-123-...",
  "baseBranch": "main",
  "prTitle": "...",
  "prBody": "... Closes #123 ...",
  "summary": "1-3 sentence change summary",
  "testsNote": "what test was added; not run in-container (CI validates)",
  "reason": "already-fixed | confused | broken (only when changed=false)",
  "evidence": "for already-fixed: the commit/PR/file:line that resolves it"
}
```

When `changed` is false, omit branch/prTitle/prBody and give `reason` (+ `evidence`
for already-fixed).
Your FINAL message must be ONLY: `{"output_file": "/output/result.json", "summary": "..."}`.
