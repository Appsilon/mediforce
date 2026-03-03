<div align="center">

# Mediforce

**Open-source platform for human-agent collaboration in pharma**

Where pharma teams and AI agents work together — compliantly.

[Vision](#vision) | [Architecture](#architecture) | [Current Status](#current-status) | [Get Involved](#get-involved)

</div>

---

## The Problem

Pharma companies have AI budgets and mandates to use them. But turning AI into something that runs inside a real, regulated workflow? That's where most get stuck.

The options today are limited. You can build custom — expensive, slow, rarely reusable. You can try general-purpose AI tools on the side — but without audit trails or compliance structure, that doesn't fly in GxP environments. Or you can wait.

Most companies wait.

## What is Mediforce

Mediforce is an open-source platform for defining how humans and AI agents collaborate on real clinical processes. It's not a chatbot and not a plugin. It's the infrastructure layer that makes human-agent collaboration work in regulated environments.

You define a process. You assign roles: some tasks go to humans, some to AI agents, some to both. You set the rules: the agent drafts but a human approves, or the agent observes and flags but never acts alone. Everything is auditable. Everything is compliant by design.

**Core idea:** processes are composed of steps. Steps define *what* needs to happen. A separate configuration layer defines *who* does it (human, agent, or system) and *how* (autonomy level, escalation behavior). The same process template can run differently in different organizations.

## Architecture

### Processes, Steps, and Agents

```
Process (reusable template)
├── Trigger         — what starts a process instance
├── Steps           — directed graph of work units
│   ├── Action      — execute a task, produce output
│   ├── Review      — evaluate, approve/revise/reject
│   └── Conversation — multi-turn dialogue
├── Entities        — data model for this process
└── Views           — UI composed from shared primitives

              ×

Process Config (per organization)
├── Step → Executor mapping (human / agent / system)
├── Autonomy levels per agent
└── Escalation and fallback rules
```

This separation is deliberate: a **Process** is a sharable, open-source template. A **ProcessConfig** adapts it to your organization's policies, team structure, and risk tolerance.

### Agent Autonomy Levels

Agents participate in steps with configurable autonomy:

| Level | Role | What the agent does | Human involvement |
|-------|------|--------------------|--------------------|
| **L1** | Observer | Watches and reports insights | None — agent output is informational |
| **L2** | Advisor | Suggests actions to a human | Human decides and acts |
| **L3** | Drafter | Executes work, submits for approval | Human approves or sends back |
| **L4** | Executor | Acts autonomously | Human reviews after the fact |

At any level, an agent can signal uncertainty and escalate to a human. This isn't a failure — it's a feature. The system is designed so agents ask for help when they need it.

### Compliance by Design

Regulated industries can't bolt compliance on after the fact. Mediforce builds it into the infrastructure:

- **Audit trail** — every agent action, every human decision, every state transition is recorded
- **Accountability** — clear record of who configured the agent, what data it accessed, what it decided, and who approved
- **Data integrity** — ALCOA+ principles (Attributable, Legible, Contemporaneous, Original, Accurate) by design
- **Scoped data access** — agents only see data relevant to their current task

> Full architecture details: [docs/architecture.md](docs/architecture.md)

## What We're Building

We're approaching this bottom-up: build concrete applications, extract shared patterns into the platform as they emerge.

**Platform packages** (in active development):

| Package | What it does |
|---------|-------------|
| `platform-core` | Domain model, schemas, and interfaces — the shared vocabulary |
| `workflow-engine` | Process execution with gates, reviews, transitions, triggers |
| `agent-runtime` | Agent execution framework with plugin system and event logging |
| `platform-ui` | Web interface for tasks, process runs, and agent oversight |
| `platform-infra` | Firebase infrastructure and notification services |

**First application: Clinical Monitoring**

Our first app built on the platform helps medical monitors in clinical trials — surfacing safety signals, checking data quality, generating narrative summaries. It's a working proof of concept that validates the platform architecture.

**Exploring next: Supply Chain Intelligence**

Early work on supply chain risk detection and inventory optimization — a very different domain that tests whether the platform generalizes beyond clinical operations.

## Current Status

This is early. We're building in public because we believe the standard for human-agent collaboration in pharma should be created in the open — not behind closed doors.

What exists today:
- Platform core with process, step, task, and agent model
- Workflow engine with step execution, review loops, gates, and triggers
- Agent runtime with plugin architecture and 6 clinical monitoring plugins
- Web UI for task management, process monitoring, and agent oversight
- A working clinical monitoring application (proof of concept)

What we're working toward:
- Process template marketplace (sharable, forkable process definitions)
- More domain applications beyond clinical monitoring
- Richer agent capabilities (document analysis, anomaly detection, natural language interaction)
- Enterprise features (private model inference, managed deployment)

## Why Open Source

In an industry where trust, transparency, and control are non-negotiable, open source is the right model:

- **Inspect every line** — critical when your compliance team validates the system
- **No vendor lock-in** — you own your deployment, your data, your customizations
- **Shared standard** — instead of every company building their own AI integration, we build one together

We're [Appsilon](https://appsilon.com) — we've been building open-source data tools for life sciences for over a decade. From Shiny extensions to the Rhino framework to contributions to the Pharmaverse ecosystem. With Mediforce, we're applying the same philosophy to a bigger problem.

## Get Involved

We're building this in the open and want input from people who work in clinical operations, build for regulated industries, or think about how humans and AI should collaborate.

- **Join our Discord** — follow progress, ask questions, share ideas <!-- [DISCORD_LINK] -->
- **Weekly working sessions** — Fridays at 3:00 PM CEST. Not a webinar — a working meeting. Bring questions. <!-- [MEETING_LINK] -->
- **Star this repo** — helps others find us
- **Open an issue** — tell us what processes you'd want to see

## Further Reading

- [Vision](docs/vision.md) — why this needs to exist and where we're headed
- [Architecture](docs/architecture.md) — how the platform is designed
- [How We Work](docs/how-we-work.md) — our approach to building Mediforce

## License

Apache License 2.0 — see [LICENSE](LICENSE).

---

<div align="center">

*Built by [Appsilon](https://appsilon.com) — building data solutions for life sciences since 2013.*

</div>
