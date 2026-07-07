## Task

An issue has been triaged as `needs-approval` — actionable but needing a human
sign-off before code is written. Produce a concise plan and the specific
questions a reviewer must answer.

The selected issue is under `## Previous Step Outputs` → `select`
(`select.issueNumber`, `select.title`, `select.body`, `select.author`).

Work from the issue text and your context preamble (domain + repo conventions).
You do **not** have the repo cloned — that is intentional; the gate exists for
scope/approach ambiguity a human resolves, and `implement` explores the code
fresh after approval. If a question genuinely needs a code fact, phrase it as a
question rather than guessing.

Write:
- `planSummary` — the approach you'd take, 2–5 sentences. Concrete.
- `questions` — the specific decisions/ambiguities a human must resolve before
  you implement. Sharp and answerable, not "is this ok?". If there is genuinely
  nothing to ask, give one confirmation question.

## Output Contract (MANDATORY)

Write ONLY this JSON to `/output/result.json`:

```json
{
  "issueNumber": 123,
  "planSummary": "...",
  "questions": ["...", "..."]
}
```

Your FINAL message must be ONLY: `{"output_file": "/output/result.json", "summary": "drafted plan for #<n>"}`.
