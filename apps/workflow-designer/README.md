# workflow-designer

The meta-workflow: a Mediforce workflow that designs Mediforce workflows. Takes
a natural-language idea (or an existing definition to edit) and produces a
registered `WorkflowDefinition`.

Two variants:

| File | Input mode |
|---|---|
| `src/workflow-designer.wd.json` | Typed conversation in a cowork step |
| `src/voice-workflow-designer.wd.json` | Voice conversation, synthesised into structure |

## Steps (base)

`choose-mode` (human — create new vs edit existing) → `fetch-workflows`
(script) → `select-workflow` (human review) → `design` (cowork) → `validate`
(script) → `register` (script) → `done`.

The voice variant collapses to `design` (cowork) → `validate` → `register` →
`done`.

## Why validate and register are scripts

Both steps are deterministic and both are gates. `validate` runs the same
`WorkflowDefinition` schema check the platform applies on import, so a design
that would be rejected at registration fails here instead — while the author is
still in the loop and can fix it. Letting an agent decide whether its own output
was valid would make the gate advisory.

## Schema authority

The shape being generated is `WorkflowDefinition` in
[`@mediforce/platform-core`](../../packages/platform-core/README.md)
(`src/schemas/workflow-definition.ts`). When a step kind is added there, this
app's prompts and validation follow it — the schema leads, never the reverse.

`start-workflow-designer.sh` runs it locally.
