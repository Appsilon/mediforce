# media-monitoring

Monitors trusted media sources for coverage of pharmaceutical companies,
summarises what it finds, and emails a report.

## Steps

`collect-media` (agent) → `summarize-articles` (agent) → `generate-report`
(agent) → `format-email` (script) → `send-email` (action) → `done`.

## The one design decision

**Articles are collected one at a time, not in a batch.** A single agent step
pulling a day of coverage overruns its context and starts dropping or
hallucinating sources. Collecting and summarising per article keeps each LLM call
small and makes a failure attributable to one article instead of poisoning the
whole report.

Delivery is deliberately not an agent step: `format-email` is a script and
`send-email` is a built-in action, so what lands in the inbox is exactly the
generated report.
