# @mediforce/mcp-client

MCP client used to reach servers a workflow step is bound to. Manages
connections, lists tools, and forwards calls.

## What it is for

A step declares which MCP servers it may use; `agent-runtime` resolves that
binding per step, and this package holds the connections. The narrow surface —
`McpClientManager`, `resolveValue`, and the tool types — is intentional: it
depends only on `platform-core`, so the CLI and tests can talk MCP without
loading the platform.

## The governance point

**A step gets the servers its binding grants, and no others.** Tool availability
is a property of the workflow definition and the tool catalog, resolved before
execution — not something an agent negotiates at run time. That is what makes
"which tools could this step have called?" answerable from the definition alone,
which is the question an auditor actually asks.

`resolveValue` resolves configured environment references so credentials reach
the server without being written into the definition.
