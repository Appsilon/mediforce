# Agents Guidelines

## Repository structure

```
apps/
  supply-intelligence/ # Standalone supply intelligence Next.js app
packages/
  platform-core/       # Shared types, domain models, test factories
  platform-ui/         # Next.js UI — the main web application
  platform-infra/      # Firebase/Firestore infrastructure layer
  agent-runtime/       # Agent execution engine
  workflow-engine/     # Process orchestration engine
  example-agent/       # Reference agent implementation
  supply-intelligence/ # Supply intelligence domain package
  supply-intelligence-plugins/  # Agent plugins for supply intelligence
docs/                  # Product vision, architecture, strategy
```

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

## Conventions

- **Language**: All source code, config files, comments, commit messages, and file names in English
- **Voice input**: User often uses voice transcription — expect typos, interpret intent over literal wording
- Never use AskUserQuestion tool — ask normally with a/b/c/... lettered options
- Prefer native platform capabilities and first-principles solutions over third-party packages
- No `any` types — use zod schemas with `z.infer`, narrow with runtime checks
- No one-letter variable names; self-documenting code over inline comments
- Don't add docstrings/comments/type annotations to code you didn't change
- Boolean: explicit comparisons, no truthy/falsy shortcuts for non-booleans
- **Scripts in Python** — all project scripts (build, convert, check) in Python, not bash

## Agent Delegation Model

The main Claude thread acts as a **Tech Lead**, not an individual contributor:

- **Be responsive** — prioritize fast, concise replies. Protect the main thread's context window for decision-making, not heavy lifting.
- **Delegate execution** — spawn subagents for analysis, research, design, and coding. Parallelize independent work across multiple agents.
- **Think big picture** — focus on architecture, goals, and coherence. Ask: "Does this move us toward the target state?"
- **Review, don't rubber-stamp** — when subagents return results, critically evaluate them. Reject hacks, unnecessary dependencies, over-engineering, or solutions that don't fit the project's direction.
- **Keep it fundamental** — prefer native platform capabilities, standard patterns, and first-principles solutions over third-party packages and clever workarounds.

In practice: receive a task → break it down → dispatch subagents → verify their output → report back to the user.

## Testing

### Test layers

| Layer | What it catches | Where |
|-------|----------------|-------|
| **Unit** | Schema validation, pure functions, expression eval | `packages/*/src/**/__tests__/` |
| **Engine integration** | Full workflow loops, transitions, step routing | `packages/workflow-engine/src/__tests__/` |
| **E2E journeys** | Full user flows with state changes | `packages/platform-ui/e2e/journeys/` |
| **E2E smoke** | Login page, auth redirect (no emulators) | `packages/platform-ui/e2e/smoke.spec.ts` |

Testing strategies:
- E2E: [`docs/E2E-STRATEGY.md`](docs/E2E-STRATEGY.md)
- Engine: [`docs/ENGINE-TESTING.md`](docs/ENGINE-TESTING.md)

### Commands

| Command | Speed | When to use |
|---------|-------|-------------|
| `pnpm typecheck` | ~5s | After any code change |
| `pnpm test:fast` | ~9s | Quick unit test verification |
| `pnpm test:affected` | <1s | Only tests for changed files |
| `pnpm test` | ~9s | Full unit + integration suite |
| `cd packages/platform-ui && pnpm test:e2e` | ~15s | Playwright smoke tests |
| `cd packages/platform-ui && pnpm test:e2e:auth` | ~60s | Full E2E with Firebase emulators |
| `cd packages/platform-ui && pnpm test:e2e:record` | ~3min | Journey tests with video recording |
| `cd packages/platform-ui && pnpm test:e2e:gif` | ~3min | Record + convert to GIF for docs |

### Agent workflow

**After every code change (always):**
1. `pnpm typecheck`
2. `pnpm test:affected` — tests for changed files only
3. `pnpm test` — all unit tests

**Before pushing (if UI or E2E tests changed):**
4. Check if any `packages/platform-ui/src/` or `e2e/journeys/` files changed:
   ```bash
   git diff --name-only origin/main...HEAD | grep -qE 'platform-ui/src/|e2e/journeys/' && echo "E2E needed"
   ```
5. If yes: ensure Firebase emulators are running (`curl -s http://127.0.0.1:9099 >/dev/null || (cd packages/platform-ui && pnpm emulators &; sleep 10)`)
6. `cd packages/platform-ui && pnpm test:e2e:auth` — all E2E journey + smoke tests (34s)

**When adding/modifying UI features (TDD):**
1. **RED** — Write the journey test first in `e2e/journeys/<feature>.journey.ts`. Use `showStep`/`showResult` from `helpers/recording.ts` at key moments for pacing during recordings.
2. **GREEN** — Implement until the test passes.
3. **Record + GIF** — `cd packages/platform-ui && pnpm test:e2e:gif` (records, then converts all videos to GIFs in `docs/features/`)
   - To convert only specific tests: `bash scripts/e2e-to-gif.sh <filter>`
4. **Gallery** — add entry to `docs/features/FEATURES.md` under the right section with description and embedded GIF.
5. **Commit** — GIF + FEATURES.md go into the same PR as the feature.

Executors MUST write or update journey tests as part of any task that adds or modifies UI features. GIF recordings are part of the deliverable, not an afterthought.

**PR description must include E2E section** (see `docs/E2E-STRATEGY.md` PR Checklist):
- Which E2E tests were added/updated
- What user flows they verify
- What is NOT covered by E2E and why
- Links to updated GIFs

**Debugging failed E2E tests**: use `agent-browser` skill on `localhost:9007` (emulator mode) to see what the UI shows and understand failures interactively.

### Unit testing by package

**workflow-engine** — test transitions, step execution, expression evaluation, triggers, RBAC. Use in-memory repository doubles from `platform-core/testing`. When adding new transition logic or step types, write unit tests in `packages/workflow-engine/src/__tests__/`.

**agent-runtime** — test plugin dispatch, agent runner orchestration, fallback handling. Mock child processes and Docker. When adding new plugins, write unit tests in `packages/agent-runtime/src/plugins/__tests__/`.

**platform-core** — test schemas with Zod parse/safeParse. When adding new schemas, add tests in `packages/platform-core/src/schemas/__tests__/`.

**platform-infra** — test Firestore repository CRUD. When adding new repositories, add tests in `packages/platform-infra/src/__tests__/`.

### Test factories

Import from `@mediforce/platform-core/testing`:
```typescript
import { buildProcessInstance, buildHumanTask, buildAgentRun } from '@mediforce/platform-core/testing';

const instance = buildProcessInstance({ status: 'paused' });
const task = buildHumanTask({ assignee: 'user-1' });
```

### E2E infrastructure

**Firebase Emulators** required for journey tests:
- `pnpm emulators` starts Auth (9099) + Firestore (8080)
- `e2e/auth-setup.ts` creates test user, seeds Firestore, saves auth state
- `e2e/helpers/seed-data.ts` — all fixture data. Update when adding new collections.
- Dev server starts automatically on port 9007 (emulator mode)

### Agent Browser

`agent-browser` skill at `skills/agent-browser/SKILL.md`. Use for visual verification after Playwright tests pass. Dev server on `http://localhost:9003`.

## Local API Access

Use the `MEDIFORCE_API_KEY` env var for local API calls (set in shell profile).
Never hardcode the API key in commands. Dev servers may run on different ports (9003, 9004, etc).

```bash
curl -s -H "X-Api-Key: $MEDIFORCE_API_KEY" "http://localhost:$PORT/api/..."
```

## Additional Commands

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

- **Runtime skills** live in `apps/*/plugins/*/skills/` — resolved by agent-runtime via `skillsDir` in workflow definition JSONs. Do not move these; paths are hardcoded in `*.wd.json` files and read by `BaseContainerAgentPlugin.readSkillFile()`. Each plugin has its own `_registry.yml`.
- **Development skills** live in `skills/` — for interactive use during development. Symlinked into `.claude/skills/` for Claude Code slash command access.
- **Agents** live in `agents/` — persona definitions (design mentor, vision workshop facilitator). Symlinked into `.claude/agents/` for Claude Code discovery.

The `skills/_registry.yml` indexes development skills. Runtime skills have per-app registries in their plugin directories (`apps/*/plugins/*/skills/_registry.yml`), resolved by agent-runtime via `skillsDir` in workflow definition JSONs.

## Environment Setup

- Node.js 20+, pnpm 10+ (`corepack enable`)
- Firebase CLI (`npm i -g firebase-tools`)
- `cp packages/platform-ui/.env.local.example packages/platform-ui/.env.local` and fill Firebase + OpenRouter keys
- Deploys via Firebase App Hosting (`apphosting.yaml`)

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Minimal code impact.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Touch only what's necessary. Avoid introducing bugs.
- **No Over-Engineering**: Don't add features, refactor code, or make "improvements" beyond what was asked.
