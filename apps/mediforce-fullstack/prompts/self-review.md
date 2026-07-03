## Task

Review the change `mediforce-fullstack` just pushed, BEFORE it becomes a PR,
using the project's own `/code-review` methodology. You have fresh eyes and clean
context — that is the point.

### Get the diff
The pushed branch is under `## Previous Step Outputs` → `implement`
(`implement.branch`, `implement.issueNumber`). Clone it and diff against `main`:

```
rm -rf /tmp/review && git clone --depth 1 https://$GITHUB_TOKEN@github.com/Appsilon/mediforce.git /tmp/review
cd /tmp/review && git fetch --depth 50 origin <implement.branch> && git checkout <implement.branch>
git fetch --depth 50 origin main && git diff origin/main...HEAD
```

The clone carries `AGENTS.md`, `docs/CONTEXT.md`, and
`.claude/skills/code-review/references/review-checklist.md` — review **against**
them.

### Review along three axes
- **Standards** — file-by-file vs `AGENTS.md` + `docs/CONTEXT.md` + the checklist
  + `docs/adr/`: convention violations (cite the rule), dead code, DRY/KISS,
  reuse misses (grep before flagging), comment quality.
- **Spec** — fetch the issue (`gh`/REST via `$GITHUB_TOKEN`). Does the diff
  faithfully implement it? Missing/partial requirements, scope creep, wrong
  implementations.
- **Big Picture** — should this exist? Does it duplicate an existing mechanism?
  Is it reinventing a platform primitive (CLI vs raw fetch, our Zod schemas)?

Apply the "**pre-existing is a smell**" rule (verify with `git blame` before
excusing anything the diff touched) and the **regression** check on every changed
read/write/endpoint — call regressions regressions, not "risk".

**Limitation (state honestly, do not fake it):** you CANNOT run the Step-0
pre-flight (`pnpm typecheck` / `test:affected`) — no `node_modules` in a shallow
clone. This is a **static** review; typecheck and tests remain the CI + human
gate.

### Verdict
- `ship` — you would approve it: no blockers, no should-fix.
- `revise` — there are **mechanically fixable** blockers/should-fix a follow-up
  pass should apply.
- `flag` — concerns remain but they are judgement calls (not auto-fixable); the
  PR should open with them noted.

## Output Contract (MANDATORY)

Write ONLY this JSON to `${output_dir}/result.json`:

```json
{
  "issueNumber": 123,
  "verdict": "ship | revise | flag",
  "concerns": ["<axis>: <file:line> — issue — suggestion", "..."]
}
```

`concerns` may be empty for `ship`. Each concern is one line, prefixed with its
axis. Your FINAL message must be ONLY: `{"output_file": "${output_dir}/result.json", "summary": "..."}`.
