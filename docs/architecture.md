# Architecture

> This is a living document. The architecture is being actively developed and will evolve as we learn from real use cases.

## Design Philosophy

Mediforce is a platform for codifying business processes as structured human + AI collaboration workflows. The core insight: processes can be decomposed into **steps**, and each step can be performed by a human, an AI agent, or both — with configurable autonomy, escalation, and auditability.

The architecture separates **what** happens (the process definition) from **who** does it (the workspace's configuration). This separation is what makes processes sharable and reusable across workspaces.

## Core Concepts

### Steps — the atoms of work

A step is the smallest unit of work in a process. It defines what needs to happen, but not who does it. Steps can be sequenced, branched, and looped — including review loops where a reviewer sends work back for revision, the most common pattern in regulated environments.

### Processes — reusable templates

A process is a graph of steps. It's reusable, sharable, and open-sourceable. A process defines the workflow and data model but says nothing about who executes each step. Think of it as a template that any workspace can adopt.

### Configuration — who does what

Each workspace configures processes for their own context. The same process template, deployed with different configurations, produces different behaviors. A large pharma company might want full human oversight on every step. A smaller biotech might give agents more autonomy. The process stays the same; the rules change.

## Agent Autonomy

The key design question isn't "should we use AI?" — it's "how much autonomy should the AI have on this step?"

| Level | What the agent does | Human involvement |
|-------|--------------------|--------------------|
| **Observer** | Watches and reports insights | None — informational only |
| **Advisor** | Suggests actions to a human | Human decides and acts |
| **Drafter** | Does the work, submits for approval | Human approves or sends back |
| **Executor** | Acts autonomously | Human reviews after the fact |

At any level, an agent can signal uncertainty and escalate to a human. This isn't a failure mode — it's how the system maintains safety.

## Compliance Infrastructure

Everything in Mediforce is designed to be auditable and compliant:

- **Audit trail** — every step execution, every agent action, every human decision is recorded
- **Accountability** — who configured the agent, what data it accessed, what it decided, who approved
- **Scoped access** — agents only see data relevant to their current task
- **Data integrity** — designed to meet the standards pharma requires

We're working with compliance professionals to ensure the platform meets GxP requirements. This is an ongoing effort — not something we claim to have solved, but something we're building toward from day one.

## What We're Figuring Out

We have a working proof of concept. Many architectural decisions are still being explored:

- How process templates are packaged, shared, and customized
- The plugin system for domain-specific agent capabilities
- How the platform scales across very different process types
- The right developer experience for defining processes and configuring agents
- Enterprise deployment patterns

We're building bottom-up: start with real processes, solve real problems, extract the platform patterns as they emerge. Every abstraction earns its place by being needed in more than one concrete use case.
