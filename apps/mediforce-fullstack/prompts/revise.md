## Task

`self-review` returned `revise` — apply its fixable concerns to the pushed branch
and re-push. This is a bounded loop (max 2 passes); make the concerns count.

### Inputs (under `## Previous Step Outputs`)
- `implement` — `branch`, `issueNumber`, `baseBranch`.
- `self-review` — `concerns[]` (the findings to address).
- `revise` — your OWN previous output, if this is the 2nd pass:
  `revise.reviewCount` (prior count, default 0) and `revise.reviseLog` (prior log).

### Do
Clone and check out the branch, apply the fixable concerns following repo
conventions (`AGENTS.md`, `docs/CONTEXT.md`), commit, and re-push the SAME branch:

```
rm -rf /tmp/revise && git clone --depth 1 https://$GITHUB_TOKEN@github.com/Appsilon/mediforce.git /tmp/revise
cd /tmp/revise && git fetch --depth 50 origin <implement.branch> && git checkout <implement.branch>
# ...apply fixes...
git add -A && git commit -m "review: address self-review concerns"
git push https://$GITHUB_TOKEN@github.com/Appsilon/mediforce.git HEAD
```

Address what you can mechanically fix. Concerns that are genuine judgement calls
you can't resolve, leave for the human — note them in the log. Do NOT run the
test suite (no install in-container).

### Counters
- `reviewCount` = (`revise.reviewCount` from the input, or 0) **+ 1**.
- `reviseLog` = the prior `revise.reviseLog` (or `[]`) **with your new pass
  appended** — one line summarising what this pass changed.

## Output Contract (MANDATORY)

Write ONLY this JSON to `/output/result.json`:

```json
{
  "issueNumber": 123,
  "reviewCount": 1,
  "reviseLog": ["pass 1: <what changed>"],
  "applied": ["<concern addressed>", "..."]
}
```

Your FINAL message must be ONLY: `{"output_file": "/output/result.json", "summary": "revise pass <n>"}`.
