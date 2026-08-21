# backlog-triage

Fetches open GitHub issues, has an LLM propose an assignment for each — to a
person or to an AI workflow — lets a human edit those proposals in a table, then
dispatches the result and writes the labels back.

## Steps

`fetch-backlog` (script) → `check-tags` (script) → `tag-issues` (human) →
`propose-assignments` (agent) → `assign` (human) → `dispatch` (script) →
`apply-tags` (script) → `report` (terminal).

## The shape worth copying

The LLM proposes; a person disposes; scripts execute. `propose-assignments`
produces a table of suggestions and `assign` is a human step that edits it
before anything is dispatched. Nothing reaches GitHub until a person has
approved the batch — and because the editable artefact is a table rather than
prose, approving it is a scan, not a re-read.

Everything with an external side effect (`dispatch`, `apply-tags`) is a
deterministic script, so what got written back is exactly what was approved.
