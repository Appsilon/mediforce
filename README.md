<div align="center">

# Mediforce

**Open-source platform for human-agent collaboration in pharma**

Where pharma teams and AI agents work together — compliantly.

[Vision](#vision) | [How It Works](#how-it-works) | [Current Status](#current-status) | [Get Involved](#get-involved)

</div>

---

## The Problem

Pharma companies have AI budgets and mandates to use them. But turning AI into something that runs inside a real, regulated workflow? That's where most get stuck.

You can build custom — expensive, slow, rarely reusable. You can try general-purpose AI tools on the side — but without audit trails or compliance structure, that doesn't fly in GxP environments. Or you can wait.

Most companies wait.

## Vision

Mediforce is an open-source platform for defining how humans and AI agents collaborate on pharma processes. It's not a chatbot and not a plugin. It's the infrastructure layer that makes human-agent collaboration work in regulated environments.

The goal: you define a process as a series of steps. For each step, you decide who does the work — a human, an AI agent, or both. You set the rules: the agent drafts but a human approves, or the agent observes and flags but never acts alone. The platform handles compliance, audit trails, and accountability so you don't have to build that from scratch every time.

The same process can run differently in different organizations — one company might want full human oversight, another might give agents more autonomy. The process stays the same; the configuration changes.

> Read more: **[Vision — why this needs to exist and where we're headed](docs/vision.md)**

## How It Works

The core concept is simple: **processes are made of steps, and each step can be performed by a human, an AI agent, or both — with clear rules about who decides what.**

### Agent Autonomy

The key question isn't "should we use AI?" — it's "how much autonomy should the AI have?" Mediforce makes this configurable per step:

| Level | What the agent does | Human involvement |
|-------|--------------------|--------------------|
| **Observer** | Watches and reports insights | None — informational only |
| **Advisor** | Suggests actions to a human | Human decides and acts |
| **Drafter** | Does the work, submits for approval | Human approves or sends back |
| **Executor** | Acts autonomously | Human reviews after the fact |

At any level, an agent can signal uncertainty and escalate to a human. This isn't a failure — it's how the system maintains safety.

### Compliance Built In

Regulated industries can't bolt compliance on after the fact. We're building it into the infrastructure:

- **Audit trail** — every agent action, every human decision, every state transition is recorded
- **Accountability** — clear record of who did what, what data was accessed, what was decided, and who approved
- **Data integrity** — designed to meet the standards pharma requires
- **Scoped access** — agents only see data relevant to their current task

> More details: [Architecture](docs/architecture.md)

## Current Status

This is early. We're building in public because we believe the standard for human-agent collaboration in pharma should be created in the open — not behind closed doors.

We have a working proof of concept that validates the core ideas against a real pharma process. Everything else — the platform abstractions, the developer experience, the process template ecosystem — is being actively figured out.

We're not pretending to have all the answers. We're experimenting, iterating, and building toward a vision. If you work in pharma and this resonates, we want to hear from you.

## Why Open Source

In an industry where trust, transparency, and control are non-negotiable, open source is the right model:

- **Inspect every line** — critical when your compliance team validates the system
- **No vendor lock-in** — you own your deployment, your data, your customizations
- **Shared standard** — instead of every company building their own AI integration, we build one together

We're [Appsilon](https://appsilon.com) — we've been building open-source tools for life sciences for over a decade. With Mediforce, we're applying the same philosophy to a bigger problem.

## Get Involved

We're looking for people who work in clinical operations, build for regulated industries, or think about how humans and AI should collaborate.

- **[Join our Discord](https://discord.gg/Hkb2K7YE)** — follow progress, ask questions, share ideas
- **Star this repo** — helps others find us
- **Open an issue** — tell us what processes you'd want to see

## Deep Dives

| | |
|---|---|
| **[Vision](docs/vision.md)** | Why this needs to exist, what agents actually do in pharma, and where we're headed |
| **[Architecture](docs/architecture.md)** | How we're thinking about processes, steps, agents, and compliance |
| **[How We Work](docs/how-we-work.md)** | Our approach — building bottom-up, in public, with real processes |
| **[AI Development Process](docs/ai-development-process.md)** | How we use AI coding agents to build Mediforce — specs, skills, and conventions |

## License

Apache License 2.0 — see [LICENSE](LICENSE).

---

<div align="center">

*Built by [Appsilon](https://appsilon.com) — building data solutions for life sciences since 2013.*

</div>
