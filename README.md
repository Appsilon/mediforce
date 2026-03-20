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

The codebase is a working proof of concept — experimental by design. We're using it to explore and validate architectural patterns for human-agent collaboration in regulated environments. The code prioritizes learning and iteration speed over production readiness. As the architecture stabilizes, we'll harden and evolve what works.

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

## Development

This is a pnpm monorepo. Quick start:

```bash
pnpm install
cp packages/platform-ui/.env.local.example packages/platform-ui/.env.local
# fill in Firebase config values
pnpm dev:ui        # platform UI only (port 9003)
pnpm dev           # platform UI + supply intelligence (ports 9003 + 9004)
```

Run tests:

```bash
pnpm typecheck      # type checking
pnpm test           # unit + integration
cd packages/platform-ui && pnpm test:e2e  # E2E (Playwright)
```

### Building Docker images for script steps

Workflows with `script` executor steps need Docker images built locally:

```bash
# Community Digest workflow
docker build -t mediforce-agent:community-digest -f apps/community-digest/container/Dockerfile .

# Protocol to TFL workflow
docker build -t mediforce-agent:protocol-to-tfl -f apps/protocol-to-tfl/container/Dockerfile .
```

Skip this if you only use `human` or `agent` executor steps, or run with `MOCK_AGENT=true`.

### Running agents locally (without Docker)

By default, agents execute inside Docker containers. To run them using your local `claude` CLI instead (useful for development and reducing costs):

```bash
pnpm dev:ui:local  # platform UI only
pnpm dev:local     # platform UI + supply intelligence
```

> Requires `claude` to be available on your `PATH`. Use the `:local` scripts (not `ALLOW_LOCAL_AGENTS=true pnpm dev:ui`) — the env var doesn't propagate reliably through pnpm script aliases.

> Full guide: **[docs/development.md](docs/development.md)**

## Deep Dives

| | |
|---|---|
| **[Vision](docs/vision.md)** | Why this needs to exist, what agents actually do in pharma, and where we're headed |
| **[Architecture](docs/architecture.md)** | How we're thinking about processes, steps, agents, and compliance |
| **[How We Work](docs/how-we-work.md)** | Our approach — building bottom-up, in public, with real processes |
| **[Development](docs/development.md)** | Setup, monorepo structure, testing, deployment |

## License

Apache License 2.0 — see [LICENSE](LICENSE).

---

<div align="center">

*Built by [Appsilon](https://appsilon.com) — building data solutions for life sciences since 2013.*

</div>
