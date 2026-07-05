## Task

The PR you opened has **failing CI**. Fix the failures on the pushed branch and
re-push. `check-ci` already harvested the real error output from GitHub — you do
NOT reproduce anything locally (you cannot `pnpm install` in this container).
You fix **statically from the actual CI error text**, push, and CI re-runs to
tell us if you got it. This is a bounded loop; make each round count.

### Inputs (under `## Previous Step Outputs`)
- `publish` — `prNumber`, `branch`, `issueNumber`, `baseBranch`.
- `check-ci` — `failing[]`: one entry per red check, each with `name`, `url`,
  `title`, `summary`, and `annotations[]` (`path`, `startLine`, `message`) — the
  concrete `file:line: message` failures (e.g. `tsc` errors, failing assertions).
  `reason` summarises the round.
- `fix-after-tests` — your OWN previous output, if this is a later round:
  `fix-after-tests.ciRound` (prior count, default 0) and
  `fix-after-tests.ciFixLog` (prior log).

### Do
1. **Read the failures.** Work from `check-ci.failing` — the `annotations` give
   you the exact file, line, and message for each error. If a summary is too
   thin to act on, you hold `$GITHUB_TOKEN`; fetch the job's richer detail
   yourself via the API (`/repos/Appsilon/mediforce/check-runs/<id>/annotations`,
   or the run logs) rather than guessing.
2. **Clone and check out the branch:**

   ```
   rm -rf /tmp/cifix && git clone --depth 1 https://$GITHUB_TOKEN@github.com/Appsilon/mediforce.git /tmp/cifix
   cd /tmp/cifix && git fetch --depth 50 origin <publish.branch> && git checkout <publish.branch>
   ```
3. **Fix the reported failures** following repo conventions (`AGENTS.md`,
   `docs/CONTEXT.md`): no `any` (Zod + `z.infer`), explicit boolean comparisons,
   English, self-documenting code, no docstrings/comments on code you did not
   change. Address the CI errors specifically — a typecheck error names the file
   and position; a failing test names the spec. Keep the fix minimal and on-topic
   for the reported failure. Do NOT run the suite (no install in-container);
   reason about correctness from the source and the error text.
4. **Commit and re-push the SAME branch:**

   ```
   git add -A && git commit -m "ci-fix: <what you fixed>"
   git push https://$GITHUB_TOKEN@github.com/Appsilon/mediforce.git HEAD
   ```

If a failure is genuinely not fixable from the error text (flaky infra, a check
that needs a decision you cannot make), note it in the log rather than guessing —
the loop will hand it to a human once the round budget is spent.

### Counters
- `ciRound` = (`fix-after-tests.ciRound` from the input, or 0) **+ 1**.
- `ciFixLog` = the prior `fix-after-tests.ciFixLog` (or `[]`) **with your new
  round appended** — one line: `round <n>: fixed <what> (<checks addressed>)`.

## Output Contract (MANDATORY)

Write ONLY this JSON to `${output_dir}/result.json`:

```json
{
  "issueNumber": 123,
  "prNumber": 456,
  "ciRound": 1,
  "ciFixLog": ["round 1: fixed TS2345 in packages/x/y.ts (typecheck)"],
  "pushed": true,
  "addressed": ["<check name> — <what you changed>", "..."]
}
```

If you could not push a fix (nothing actionable), set `pushed: false` and explain
in `ciFixLog`. Your FINAL message must be ONLY: `{"output_file": "${output_dir}/result.json", "summary": "ci-fix round <n>"}`.
