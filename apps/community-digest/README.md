# community-digest

Scans GitHub activity for a chosen period, ranks what actually changed, and
drafts Discord posts for the community. Role-gated to `community-lead`.

Two definitions, identical step graphs, different ranking model:

| File | Model |
|---|---|
| `src/community-digest.wd.json` | DeepSeek |
| `src/community-digest-sonnet45.wd.json` | Claude Sonnet 4.5 |

## Steps

`select-period` (human) → `gather-changes` (script) → `rank-changes` (agent) →
`review-ranking` (human review) → `draft-posts` (agent) → `review-posts`
(human review) → `done`.

Two human review gates, deliberately. The workflow drafts posts that go out
under the project's name, so a person approves both what got ranked as
significant and the text that resulted.

## Layout

```
container/Dockerfile          mediforce-agent:community-digest
scripts/gather-github-changes.ts   GitHub API collection for the script step
plugins/community-digest/     Packaged skills for the agent steps
src/*.wd.json                 Workflow definitions
```

`gather-changes` runs in the custom image via `script-container`; the ranking
and drafting steps are LLM agents.

## Setup

`DEEPSEEK_API_KEY` is declared in the definition's `env` block and resolved from
workspace secrets at run time.
