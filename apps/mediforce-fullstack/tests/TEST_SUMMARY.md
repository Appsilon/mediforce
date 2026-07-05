# Test summary — mediforce-fullstack

Pure-logic coverage lives in `tests/run_tests.mjs`. Run it any time (no secrets,
no network):

```bash
node tests/run_tests.mjs        # 31 assertions, all green
```

| Script | Status | What's covered |
|--------|--------|----------------|
| `fetch-candidates` | **tested** | `classifyIssue` (new / pr-open / fresh-lease / stale-reclaim / manual re-judge-on-edit / already-classified) + `summariseLabelEvents` attemptCount |
| `apply-verdicts` | **tested** | `reconcile` label add/remove diff, re-judge label swap, newly-manual detection, manual carries no priority |
| `select` | **tested** | `rankCandidates` (priority then oldest), `priorityOf`, `isActionable` exclusions |
| `notify-gate` | **tested** | `resolveReviewer` tiered map lookup, `buildGateComment` cc tiers |
| `publish` | **tested** | `reviewOutcome` (ship/flag/capped-draft), `buildPrBody` assembly |
| `arm-timer` | **tested** | `resolveWaitMinutes` parses positive / falls back on empty / unresolved / non-positive |
| `check-ci` | **tested** | `classifyRuns` (pending/failed/passed), `decideNextAction` routing at caps, `summariseAnnotations` trim |
| `mark-ci-green` | **tested** | `withFixHistory` appends once, skips empty / already-present |
| `mark-ci-failed` | **tested** | `buildFailedBody` history + failing summary, idempotent; live parts (draft convert, label, comment) need GitHub |
| `claim` | **skipped — needs live GitHub** | pure IO (label POST/DELETE); logic is one add + two deletes |
| `mark-fixed` | **skipped — needs live GitHub** | comment + close + label delete |
| `mark-needs-info` | **skipped — needs live GitHub** | `resolveIssueNumber`/`parkComment` are trivial; the writes need the API |

The **agent steps** (`triage`, `draft-plan`, `implement`, `self-review`, `revise`,
`fix-after-tests`) are LLM prompts — exercised by an actual run, not unit tests.

## Not covered here (proven only by a real run on the platform)

- That the inline-JS runtime image has `fetch` (Node 18+) — all scripts assume it.
- That `implement`/`self-review`/`revise`/`fix-after-tests` can clone **and push**
  with the provided `GITHUB_TOKEN` (needs **write** scope — see README).
- That `wait-ci` actually pauses ~`CI_WAIT_MINUTES` and the scheduler resumes it,
  and that `check-ci` reads GitHub check-runs + annotations for the PR head SHA.
- End-to-end: trigger → 22-step graph → PR on GitHub → CI loop → green / drafted.

To exercise the live-GitHub scripts once you have a token:

```bash
GITHUB_TOKEN=… FULLSTACK_REPO=you/sandbox-repo node scripts/claim.mjs   # with a /output/input.json present
```
