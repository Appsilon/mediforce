---
title: Agents and models
sidebar_label: Agents and models
sidebar_position: 6
---

# Agents and models

An **agent step** hands work to an LLM. What the agent is (its model, its instructions, the Skills and tools it may use, the image it runs in) lives in an **agent definition** in the workspace. Several workflows can share one agent instead of each carrying its own copy, and when you improve the agent, you improve it once.

## Agent definitions

Agents live under **Agents** in the workspace. Each card has a **Start workflow** button that opens a new workflow with one step already using that agent, which is the quickest way to try one out.

From the CLI:

```bash
pnpm exec mediforce agent create --file ./my-agent.json --namespace acme
pnpm exec mediforce agent list
pnpm exec mediforce agent get <agent-id>
```

An agent needs, at minimum, a name and a model. Visibility works like a workflow's: private to the workspace, or public and readable across workspaces.

```bash
pnpm exec mediforce agent set-visibility <agent-id> --visibility public
```

An agent's page has three tabs: **Configuration**, **Evaluation** (see [Evaluating agents and steps](../evaluate/)) and **Versions**.

## The Agent Assistant

Before you write a new agent, it's worth asking whether you need one. The **Agent Assistant** panel on the Agents page takes a description of the task, searches your agents, Skills and MCP servers, and suggests one of these:

- **Use an existing agent.** It links straight to binding it to a workflow step.
- **Add a Skill** to an agent, or **update** its prompt or model. You accept or reject each change.
- **Wire an MCP server** to an agent. This goes in as *pending* until a workspace admin approves it, and a pending server isn't offered to the agent at run time.
- **Create a draft agent**, which you can edit before saving.

When it looked at more than one candidate, it shows a requirements check so you can see why it picked what it did. It never makes up the ID of a Skill or server that doesn't exist.

```bash
pnpm exec mediforce agent assistant-ask "Summarise adverse event narratives into a CIOMS-style table" --namespace acme
```

## Versions, and why your steps don't change under you

Saving an agent records a new **version** whenever something that affects its behaviour changed: its runtime, image, model, system prompt, output schema, MCP servers or Skills. Renaming it doesn't count.

When you pick an agent for a workflow step, the step is **pinned** to the agent's current version. Edit the agent afterwards and the step keeps running the version it was saved with. That's on purpose: a workflow someone validated shouldn't quietly change because someone else improved a shared agent.

To move a step onto a newer version, open the step, choose it in **Agent version**, and save the workflow. If you'd rather a step always follow the agent, choose **Track current** instead. The step editor tells you when a pinned step has fallen behind.

The **Versions** tab shows every version with a diff against the one before, and a **Used by** list of the workflow steps using the agent, which version each one is on, and which have fallen behind. Check it before you change an agent other people rely on.

```bash
pnpm exec mediforce agent versions <agent-id>
```

Retrying a failed step on a different agent version than the one it ran is refused, so a retry never silently becomes a different experiment.

## Output schema

An agent can declare the shape its result must have, as a JSON Schema. The agent sees it, and every run is checked against it. A step using the agent inherits the schema unless it sets its own, and the step editor shows you which one applies. Only `type`, `required` and each property's `type` are enforced; anything else in the schema is guidance for the agent.

## Image

An agent can name the [container image](../images/) it runs in, which decides what tools it has to hand. Leave it blank for the default image. A workflow step that names no image of its own gets the agent's when the workflow is saved, and keeps it, so changing the agent's image later doesn't move existing steps.

```bash
pnpm exec mediforce agent set-image <agent-id> --image registry.example.com/sas-tools:2.1
```

## Skills

A **Skill** is a folder of instructions and reference files, with a `SKILL.md` at its root, that an agent can draw on when a task calls for it. Skills are offered rather than forced: the agent loads one when its description fits the work. If a step must use one, say so in the step's prompt.

Skills live on the **Skills** page, one catalog per workspace, where each card shows which agents hold it and how many workflows use it. You can write one, or **Import from git** from a repository of skill folders.

```bash
pnpm exec mediforce skill import --repo https://github.com/acme/skills --namespace acme
pnpm exec mediforce agent set-skills <agent-id> --skills summarise-narratives,acme/cdisc-terms
```

A step can add Skills on top of its agent's in the step editor. A step Skill with the same name as one of the agent's replaces it for that step. A public agent or workflow can only use public Skills.

:::note Workflows that used file skills
Skills used to live inside the workflow's own repository. That no longer runs. A step that still names one is flagged on the Workflows page with an **Import skills** action, and the step editor tells you what to pick instead. **View original definition** on the version page shows what the step looked like before.
:::

## Models

Models come from a registry the deployment syncs, so the picker offers what's actually reachable rather than a hardcoded list. Browse and filter by provider and capability under **Models**.

```bash
pnpm exec mediforce model list
pnpm exec mediforce model sync
pnpm exec mediforce model validate anthropic/claude-sonnet-4,openai/gpt-4o
```

`model validate` takes the model IDs themselves, comma-separated, and reports which of them the registry knows. A model a workflow names but the registry doesn't know is also reported by the [readiness check](../run/verify#2-workflow-readiness-check) before you start.

The model new agents start on, and the model the assistants use, is the workspace's [default model](../workspace/#settings).

## Credits

Agent steps spend money. The deployment holds one OpenRouter key, injected into step containers as `DOCKER_OPENROUTER_API_KEY`.

```bash
pnpm exec mediforce system credits --namespace acme
pnpm exec mediforce system status
```

Low credit is a **warning**, not a block: the readiness check reports it and still offers **Start anyway**. Running out fails agent steps at run time, which is a failed run rather than a refused start.

## Tools and MCP servers

An agent's tools come from **MCP servers**. Every server lives in the workspace's catalog on the **MCP** page, and an agent only refers to one, so a server's details are set once and shared. Any member can add servers. Changing a shared server's authentication affects every agent bound to it, and the edit dialog tells you how many that is.

Servers can be stdio or HTTP. Some need OAuth, which you connect once in the app; the connection is then reused.

A step may narrow which tools the agent can reach, but it can't widen them. The agent definition is the ceiling.

```bash
pnpm exec mediforce tool-catalog list --namespace acme
pnpm exec mediforce tool-catalog discover --namespace acme --url https://mcp.example.com/mcp
pnpm exec mediforce tool-catalog add --file ./server.json --namespace acme
```

## Cowork

A `cowork` step is a person and an agent working on the same artifact live, in a chat with the artifact beside it. The artifact stays a draft while the session is open and only becomes the step's output when the session is finalized, so a half-finished conversation never leaks into the next step.

```bash
pnpm exec mediforce cowork list --status active
pnpm exec mediforce cowork chat <session-id>
```

## When an agent is unsure

An agent step can **escalate** instead of failing. The run goes to `waiting_for_human` with the reason, a person picks it up, and the run can be retried rather than written off. Escalated runs show the reasoning, including low confidence, on the run page.

Next: [Evaluating agents and steps](../evaluate/).
