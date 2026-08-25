---
title: Agents and models
sidebar_label: Agents and models
sidebar_position: 6
---

# Agents and models

An **agent step** hands work to an LLM. What the agent is — its model, its
instructions, the tools it may use — lives in an **agent definition** in the
workspace, so several workflows can share one agent instead of each carrying a
copy.

## Agent definitions

Create them under **Agents** in the workspace, or from the CLI:

```bash
pnpm exec mediforce agent create --file ./my-agent.json --namespace acme
pnpm exec mediforce agent list
pnpm exec mediforce agent get <agent-id>
```

An agent needs, at minimum, a name and a model. Visibility works like a
workflow's: private to the workspace, or public and readable across workspaces.

```bash
pnpm exec mediforce agent set-visibility <agent-id> --visibility public
```

## Models

Models come from a registry the deployment syncs, so the picker offers what is
actually reachable rather than a hardcoded list. Browse and filter by provider
and capability under **Models**.

```bash
pnpm exec mediforce model list
pnpm exec mediforce model sync
pnpm exec mediforce model validate anthropic/claude-sonnet-4,openai/gpt-4o
```

`model validate` takes the model IDs themselves, comma-separated, and reports
which of them the registry knows. A model a workflow names but the registry does
not know is also reported by the
[readiness check](../run/verify#2-workflow-readiness-check) before you start.

## Credits

Agent steps spend money. The deployment holds one OpenRouter key, injected into
step containers as `DOCKER_OPENROUTER_API_KEY`.

```bash
pnpm exec mediforce system credits --namespace acme
pnpm exec mediforce system status
```

Low credit is a **warning**, not a block: the readiness check reports it and
still offers **Start anyway**. Exhausted credit fails agent steps at run time,
which is a failed run rather than a refused start.

## Tools and MCP servers

An agent's tools come from **MCP servers** bound to its definition. A step may
narrow what the agent is allowed to reach, but it cannot widen it — the agent
definition is the ceiling.

Servers can be stdio or HTTP. Some need OAuth, which you connect once per server
in the app; the connection is then reused.

## Cowork

A `cowork` step is a person and an agent working the same artifact live, in a
chat with an artifact panel beside it. The artifact is a draft while the session
is open, and only becomes the step's output when the session is finalized — so an
unfinished conversation never leaks into the next step.

```bash
pnpm exec mediforce cowork list --status active
pnpm exec mediforce cowork chat <session-id>
```

## When an agent is unsure

An agent step can **escalate** instead of failing. The run goes to
`waiting_for_human` with the reason, a person picks it up, and the run is
retryable rather than dead. Escalated runs show the rationale, including low
confidence, on the run page.

Next: [Gotchas](../gotchas/).
