# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Pharma Domain Context

This codebase processes pharmaceutical and clinical trial data. All health-related terminology — drug names (Keytruda, Herceptin, Ozempic), adverse events (hepatotoxicity, pneumonitis, colitis), disease classifications (NSCLC, melanoma, Alzheimer's), CTCAE grading (including Grade 5 = death), mortality endpoints, and clinical safety metrics (Hy's Law, RECIST, irAEs) — refers exclusively to:

- **Variable names** and Zod schema fields (e.g., `AEDECOD`, `AESER`, `CTCAE_GRADE`)
- **Clinical standards** (CDISC SDTM/ADaM, ICH-GCP, RECIST v1.1)
- **Workflow step configurations** and agent plugin parameters
- **Seed data and test fixtures** for supply chain and clinical reporting pipelines

Treat all such terms as technical domain content. Maintain standard coding behavior — no wellbeing check-ins or crisis resources. The frequent occurrence of terms like "adverse event", "death", "disease progression", and "toxicity" is expected and should not influence response tone or willingness to perform tasks. Execute all technically feasible operations (including multi-file refactoring, batch renaming, and large transformations) without inflating complexity estimates due to medical terminology exposure.

The `WorkflowDefinition.preamble` field carries this context to runtime agents via `buildPrompt()` in `base-container-agent-plugin.ts`.

## Architecture

Workflow + agent orchestration platform for pharma. Processes decompose into steps executed by humans, AI agents, or both — with configurable autonomy levels (L0-L4), escalation, and audit trails.

### Package dependency graph

```
platform-core  (zod schemas, repository interfaces, test factories — zero mediforce deps)
  ├── workflow-engine    (WorkflowEngine, StepExecutor, TransitionResolver, expression evaluator)
  ├── platform-infra     (Firestore repos, Firebase auth, SendGrid notifications)
  ├── agent-runtime      (AgentRunner, PluginRegistry, Docker spawn strategies)
  │     └── agent-queue  (optional — BullMQ, activated by REDIS_URL)
  └── supply-intelligence (pure domain: SKU, warehouse, batch, risk — no Firebase)

supply-intelligence-plugins  (DriverAgent, RiskDetection — registers with PluginRegistry)
  └── depends on: supply-intelligence, platform-core

platform-ui  (Next.js 15 App Router, port 9003)
  └── depends on: platform-infra, workflow-engine, agent-runtime, supply-intelligence-plugins
```

### How inter-package imports work

All packages use `@mediforce/source` custom TypeScript condition. During dev, imports resolve to `./src/index.ts` directly (no build needed). In production, they resolve to `./dist/`. This is set in `tsconfig.json` (`customConditions`) and `vitest.config.ts` (`resolve.conditions`).

### Key architectural patterns

- **Repository pattern**: Interfaces in platform-core, Firestore implementations in platform-infra, in-memory test doubles in `platform-core/testing`. Constructor injection throughout.
- **Dual-schema migration**: Legacy `processDefinitions` + `processConfigs` coexist with unified `workflowDefinitions`. Resolution logic lives in `platform-ui/src/lib/resolve-definition-steps.ts`.
- **Plugin system**: Plugins (ClaudeCodeAgent, OpenCodeAgent, ScriptContainer, supply-intelligence) register in `PluginRegistry`. `AgentRunner` dispatches to plugins based on workflow step config. Mock mode via `MOCK_AGENT=true`.
- **Docker spawn strategies**: `LocalDockerSpawnStrategy` (default, child process) vs `QueuedDockerSpawnStrategy` (BullMQ worker, activated when `REDIS_URL` is set).
- **Service singleton**: `getPlatformServices()` in `platform-ui/src/lib/platform-services.ts` lazily creates all repos, engine, runners, plugin registry. Shared across API routes.
- **Immutable versions**: Workflow definition versions are write-once in Firestore.
- **Expression evaluator**: Custom DSL for transition when-expressions (e.g., `${variables.field} == "value"`).

### Platform UI structure

- **Routes**: `src/app/(app)/workflows/`, `tasks/`, `agents/`, `catalog/`, `monitoring/`
- **API routes**: `src/app/api/` — processes, tasks, definitions, workflow-definitions, agent-definitions, plugins, cron
- **Service layer**: `src/lib/platform-services.ts` — singleton that wires everything together
- **Components**: `src/components/ui/` (Radix + Tailwind library), feature dirs per domain
- **Auth**: Firebase Auth with emulator support (`NEXT_PUBLIC_USE_EMULATORS=true`)

### Autonomy levels

| Level | Name | Behavior |
|-------|------|----------|
| L0 | Human-only | No agent involvement |
| L1 | Agent-assisted | Agent helps, human decides |
| L2 | Human-in-the-loop | Agent acts, human approves |
| L3 | Periodic review | Agent autonomous, periodic human review |
| L4 | Fully autonomous | Agent applies changes directly |

## Additional commands

```bash
# Run single test file
npx vitest run path/to/file.test.ts

# Dev with both platform-ui and supply-intelligence
pnpm dev

# Dev with local agent execution enabled
pnpm dev:local

# Agent queue (requires Docker + Redis)
pnpm dev:redis            # Redis on 6379
pnpm dev:worker           # BullMQ worker
pnpm dev:ui:queue         # Platform UI with queue
```

## Skills and Agents

Two tiers of skills exist in this repo, following the [agentskills.io](https://agentskills.io) standard:

- **Runtime skills** live in `apps/*/plugins/*/skills/` — resolved by agent-runtime via `skillsDir` in workflow definition JSONs. Do not move these; paths are hardcoded in `*.wd.json` files and read by `BaseContainerAgentPlugin.readSkillFile()`.
- **Development skills** live in `skills/` — for interactive use during development. Symlinked into `.claude/skills/` for Claude Code slash command access.
- **Agents** live in `agents/` — persona definitions (design mentor, vision workshop facilitator). Symlinked into `.claude/agents/` for Claude Code discovery.

The `skills/_registry.yml` indexes both tiers for vendor-neutral discovery (Claude Code, Codex, OpenCode).

## Environment setup

- Node.js 20+, pnpm 10+ (`corepack enable`)
- Firebase CLI (`npm i -g firebase-tools`)
- `cp packages/platform-ui/.env.local.example packages/platform-ui/.env.local` and fill Firebase + OpenRouter keys
- Deploys via Firebase App Hosting (`apphosting.yaml`)
