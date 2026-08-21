# tealflow-cowork

Explores available teal modules over MCP and selects which to include in an app.
Two steps: `explore-modules` (cowork) → `done`.

**This is a minimal example of MCP tool use inside a cowork step**, kept
deliberately small. Where [tealflow](../tealflow/README.md) is the full build
and deploy pipeline, this one isolates a single mechanism: an agent in a
conversational step calling tools from a bound MCP server while a person steers.

Read it when you want the pattern without the pipeline around it.
