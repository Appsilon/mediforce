# Summarize Record

Use this skill when a golden-standard workflow agent step needs to summarize
the normalized intake and quality gate output.

## Inputs

Read `/output/input.json`.

Relevant step outputs:

- `normalize-request.studyId`
- `normalize-request.priority`
- `normalize-request.route`
- `quality-gate.passed`
- `quality-gate.needsAgentReview`
- `human-disposition.verdict`

## Output

Write `/output/result.json`:

```json
{
  "verdict": "approve",
  "summary": "Short operator-facing summary.",
  "findings": ["Specific finding"]
}
```

For CM3 human-review agent steps, use `verdict: "approve"` when the output is
ready for the human reviewer and `verdict: "revise"` when the workflow should
loop for more work.
