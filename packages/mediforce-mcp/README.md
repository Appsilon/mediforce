# @mediforce/mediforce-mcp

MCP server that exposes Mediforce itself as tools, so an agent can design, run
and inspect workflows through the same platform API a human uses.

Runs over stdio: `mediforce-mcp`.

## Tools

| Tool | Does |
|---|---|
| `render_workflow_diagram` | HTML diagram from a `WorkflowDefinition` |
| `dry_run_workflow` | Register a definition and start a dry run |
| `get_run_status` | Run status and step progress |
| `list_run_tasks` | Pending human tasks for a run |
| `complete_task` | Complete a human task with a payload |
| `get_run_logs` | Audit events and step executions |
| `list_models` | Query the model registry |
| `list_docker_images` | Docker images available on the platform |
| `list_workflow_examples` | CI-tested examples and anti-patterns |

## Setup

API-backed tools need `APP_BASE_URL` and `PLATFORM_API_KEY`. Without them the
server still starts and the local-only tools still work — an unconfigured
deployment loses tools, not the server.

## Why it is thin

Every tool delegates to a handler or client in
[`@mediforce/platform-api`](../platform-api/README.md). It adds an MCP surface
over existing operations and no behaviour of its own, which is what keeps it
from drifting away from what the UI and CLI do.

`list_workflow_examples` is the exception worth knowing about: it serves the
CI-tested definitions bundled in `platform-core`, so an agent authoring a
workflow gets examples that are known to still parse.
