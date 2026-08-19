---
status: living
audience: everyone
last_reviewed: 2026-08-19
---

# How We Work

## Building in Public

Mediforce is built in the open — the code, the roadmap, and the reasoning behind each decision. Every pharma company is building its own AI integration layer right now. The only way that becomes one shared standard instead of a dozen private ones is to build it where the people who need it can see it and push back on it.

So the repository is public from the first commit, the architectural decisions are written down as [ADRs](../adr/README.md), and the platform is shaped by the people who actually run the processes it automates.

## Our Approach

### Bottom-Up, Not Top-Down

We don't start with a grand abstraction and hope it fits reality. We start with real processes, build working applications, and extract the platform patterns as they emerge. Every abstraction in Mediforce earns its place by being needed in more than one concrete use case.

### Code-First

Mediforce is a developer platform, not a drag-and-drop builder. Code is the most precise, version-controllable, and AI-friendly way to define a process. Good APIs, clear documentation, and TypeScript throughout.

That said, AI coding assistants make code-first accessible to people who think in processes, not in syntax. We build the platform the same way — see [how this repo is built with agents](../contributing/ai-development-process.md).

### Real Processes, Real Complexity

Every feature we build is validated against real pharma processes — parallel steps, review loops, multiple agents with different autonomy levels, compliance gates, and complex data models. If the platform handles that, simpler processes are easy.

## The Team

Mediforce is built by [Appsilon](https://appsilon.com) — a company that has been building data solutions for life sciences since 2013. We've worked with some of the largest pharma companies in the world, building production software for clinical operations, biostatistics, and data science teams.

We started building an application for a pharma process and realized: every pharma company will need this infrastructure. It shouldn't be reinvented for every project. It should be a standard.

## Getting Involved

We're in early stages and actively looking for:

- **Domain experts** — people who work in clinical operations, pharmacovigilance, regulatory, supply chain. Your knowledge of real processes is what makes Mediforce useful.
- **Developers** — interested in building for regulated industries, workflow systems, or human-AI collaboration.
- **Compliance professionals** — who can help us get GxP-readiness right from the start.

The best ways in:

1. **[Join our Discord](https://discord.gg/TVx4VkG3C2)** — where the conversation happens: questions, progress updates, and the direction of the project.
2. **[Open an issue](https://github.com/Appsilon/mediforce/issues)** describing a process you'd want to see on the platform.
3. **[Run it locally](../../GETTING-STARTED.md)** — demo data, no setup required — then read [the architecture](architecture.md).

Longer-form writing lives on the [Appsilon blog](https://appsilon.com/blog), the public site is [mediforce.ai](https://mediforce.ai), and the code is on [GitHub](https://github.com/Appsilon/mediforce).
