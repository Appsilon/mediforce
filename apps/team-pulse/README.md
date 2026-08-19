# team-pulse

A product owner poses a question, team members answer in their own time, an LLM
synthesises the responses, and the owner can hand the result straight to
[backlog-triage](../backlog-triage/README.md).

Two definitions:

| File | Role |
|---|---|
| `src/team-pulse.wd.json` | The owner-facing workflow |
| `src/gather-perspective.wd.json` | One member's response — spawned per person |

## Steps

`fetch_members` → `select_members` (human) → `prepare` → `spawn_perspectives`
(action) → `wait_for_responses` (action) → `collect_responses` →
`synthesize` (agent) → `decide_triage` (human decision) → `spawn_triage`
(action) → `report`.

## Why two workflows

`spawn_perspectives` starts one `gather-perspective` run per selected member,
and `wait_for_responses` suspends until they return or the box expires. Each
person gets their own run with their own task, so responses stay independent —
nobody sees another's answer before writing their own, which is the entire point
of gathering perspectives separately.

This is the fan-out/fan-in pattern using the built-in `spawn` and `wait`
actions ([`@mediforce/core-actions`](../../packages/core-actions/README.md)) —
no custom container involved.
