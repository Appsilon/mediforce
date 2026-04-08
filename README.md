<div align="center">

# Mediforce

**The open-source platform for human-agent collaboration in pharma**

Define processes. Assign humans and AI agents to each step. Ship compliant workflows — fast.

[Why Mediforce](#why-mediforce) | [How It Works](#how-it-works) | [See It in Action](#see-it-in-action) | [Get Involved](#get-involved)

</div>

---

## Why Mediforce

Pharma is ready for AI. The models are capable, the budgets exist, and the pressure to modernize is real. What's missing is the **infrastructure** — a way to deploy AI agents into regulated workflows with the compliance, auditability, and human oversight that GxP demands.

Mediforce is that infrastructure. Open-source, built for pharma, designed so your compliance team says yes on the first review.

**One platform, every process.** From clinical operations to pharmacovigilance to supply chain — define a process once, configure autonomy levels per step, and deploy. The first process is the hardest. Every one after that is incremental.

**Your rules, your control.** You decide how much autonomy each agent gets. An agent can draft and a human approves. Or the agent acts and a human reviews after the fact. The process stays the same; the configuration adapts to your organization's risk tolerance.

**Compliance is not a bolt-on.** Audit trails, accountability, data integrity, and scoped access are built into the platform from day one — not layered on top.

> **[Read the full vision — why this needs to exist and where we're headed](docs/vision.md)**

## How It Works

Processes are made of steps. Each step can be performed by a human, an AI agent, or both — with clear rules about who decides what.

### Configurable Autonomy

| Level | Agent Role | Human Involvement |
|-------|-----------|-------------------|
| **L1 — Observer** | Watches and surfaces insights | Informational only |
| **L2 — Advisor** | Suggests actions | Human decides and acts |
| **L3 — Drafter** | Does the work, submits for review | Human approves or sends back |
| **L4 — Executor** | Acts autonomously | Human reviews periodically |

At any level, an agent can signal uncertainty and escalate to a human. This isn't a failure mode — it's how the system maintains safety in production.

### What Agents Actually Do

These aren't chatbots. Mediforce agents perform real cognitive work inside structured processes:

- **Document analysis** — review consent forms, flag missing fields, simplify language
- **Anomaly detection** — monitor metrics, alert on unusual patterns across sites
- **Report generation** — draft clinical summaries, compile safety narratives
- **Supply intelligence** — forecast demand, detect risk signals, optimize inventory
- **Quality checks** — validate data integrity, cross-reference against standards

Every agent operates under human oversight, with every action recorded in a complete audit trail.

## See It in Action

### Workflow Dashboard

All your workflows in one place — run counts, active status, and one-click access to any process execution.

<div align="center">
<img src="docs/features/workflow-home.gif" alt="Workflow dashboard showing process overview" width="720" />
</div>

### Human-in-the-Loop Review

The core decision point. Reviewers see full context from the agent's work and submit their verdict — approve, revise, or escalate.

<div align="center">
<img src="docs/features/task-approve-flow.gif" alt="Task approval flow with agent context" width="720" />
</div>

### Autonomy Levels on Every Step

Each step displays its autonomy configuration (L1–L4) so operators always know what's agent-driven and what requires human action.

<div align="center">
<img src="docs/features/run-detail-autonomy-badges.gif" alt="Process run with autonomy level badges" width="720" />
</div>

> **[See all features with recordings](docs/features/FEATURES.md)** — task management, workflow editor, run reports, agent catalog, escalation handling, and more.

## Why Open Source

In regulated industries, trust and transparency are non-negotiable. Open source is the right model:

- **Full transparency** — your compliance team can inspect every line of code
- **Zero vendor lock-in** — you own your deployment, your data, your customizations
- **Shared standard** — instead of every company building their own AI integration layer, we build one together
- **Community-driven quality** — battle-tested by the people who use it

We're [Appsilon](https://appsilon.com) — we've been building open-source tools for life sciences for over a decade. Mediforce applies that same philosophy to the biggest opportunity in pharma today.

## Get Involved

We're building the standard for human-agent collaboration in pharma — and we're doing it in the open.

- **[Getting Started](GETTING-STARTED.md)** — set up your development environment
- **[Join our Discord](https://discord.gg/Hkb2K7YE)** — follow progress, ask questions, shape the roadmap
- **Star this repo** — helps others in pharma find us
- **Open an issue** — tell us what processes matter most to you

## Development

**[Getting Started Guide](GETTING-STARTED.md)** — Quick start with emulators and demo data, no setup required.

Quick start:

```bash
pnpm install
python3 packages/platform-ui/scripts/bootstrap-e2e.py  # One-time setup
NEXT_PUBLIC_USE_EMULATORS=true pnpm dev:ui              # Start with demo data
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
| **[Getting Started](GETTING-STARTED.md)** | Set up your development environment with Firebase |
| **[Vision](docs/vision.md)** | Why this needs to exist, what agents actually do in pharma, and where we're headed |
| **[Architecture](docs/architecture.md)** | Processes, steps, agents, compliance — the technical foundation |
| **[How We Work](docs/how-we-work.md)** | Building bottom-up, in public, with real processes |
| **[Development](docs/development.md)** | Setup, monorepo structure, testing, deployment |
| **[Features](docs/features/FEATURES.md)** | Full feature gallery with recorded walkthroughs |

## License

Apache License 2.0 — see [LICENSE](LICENSE).

---

<div align="center">

*Built by [Appsilon](https://appsilon.com) — data solutions for life sciences since 2013.*

</div>
