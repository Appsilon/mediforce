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

## Conventions

- **Language**: All source code, config files, comments, commit messages, and file names in English
- **Voice input**: User often uses voice transcription — expect typos, interpret intent over literal wording
- Never use AskUserQuestion tool — ask normally with a/b/c/... lettered options
- Prefer native platform capabilities and first-principles solutions over third-party packages
- No `any` types — use zod schemas with `z.infer`, narrow with runtime checks
- No one-letter variable names; self-documenting code over inline comments
- Don't add docstrings/comments/type annotations to code you didn't change
- Boolean: explicit comparisons, no truthy/falsy shortcuts for non-booleans

## Agent Delegation Model

The main Claude thread acts as a **Tech Lead**, not an individual contributor:

- **Be responsive** — prioritize fast, concise replies. Protect the main thread's context window for decision-making, not heavy lifting.
- **Delegate execution** — spawn subagents for analysis, research, design, and coding. Parallelize independent work across multiple agents.
- **Think big picture** — focus on architecture, goals, and coherence. Ask: "Does this move us toward the target state?"
- **Review, don't rubber-stamp** — when subagents return results, critically evaluate them. Reject hacks, unnecessary dependencies, over-engineering, or solutions that don't fit the project's direction.
- **Keep it fundamental** — prefer native platform capabilities, standard patterns, and first-principles solutions over third-party packages and clever workarounds.

In practice: receive a task → break it down → dispatch subagents → verify their output → report back to the user.

## Browser Testing (E2E)

### Playwright

E2E tests live in `packages/platform-ui/e2e/`. Two modes:

**Smoke tests (no emulators needed):**
- `cd packages/platform-ui && pnpm test:e2e` -- login page, auth redirect
- `pnpm test:e2e:headed` -- with visible browser
- `pnpm test:e2e:ui` -- interactive Playwright UI mode

**Authenticated tests (requires Firebase Emulators):**
- Terminal 1: `pnpm emulators` -- starts Auth (9099) + Firestore (8080) emulators
- Terminal 2: `pnpm test:e2e:auth` -- runs smoke + authenticated tests
- `pnpm test:e2e:auth:headed` -- with visible browser

The emulator setup (`e2e/auth-setup.ts`) automatically:
1. Creates a test user (test@mediforce.dev / test123456)
2. Seeds Firestore with humanTasks, processInstances, agentRuns, auditEvents
3. Authenticates via `/test-login` and saves auth state for all tests

**Test structure:**
- `e2e/smoke.spec.ts` -- unauthenticated tests (always run)
- `e2e/authenticated/*.spec.ts` -- tests requiring login (only with emulators)
- `e2e/helpers/` -- emulator REST API helpers and seed data

The dev server starts automatically on port 9003 via `webServer` in `playwright.config.ts`.

Write E2E tests for:
- Every new page/route (smoke: page loads, key elements visible)
- Critical user flows (login redirect, form submission, navigation)
- Visual regressions when UI changes significantly

### Agent Browser (Vercel)

`agent-browser` is installed globally and its skill is at `.claude/skills/agent-browser/SKILL.md`.
Refer to the skill for full command reference, workflow patterns, and templates.

Use agent-browser for verification of UI work (after Playwright tests pass).
The dev server runs on `http://localhost:9003`.

### TDD and E2E Workflow

1. **Write E2E test first** (Red) -- describe expected page behavior in `e2e/`
2. **Implement the feature** (Green) -- make the test pass
3. **Use agent-browser** -- visually confirm the result after tests pass

Executors MUST write or update E2E tests as part of any task that adds or modifies UI pages/routes.

## Test Execution Guide

### Running tests

| Command | Speed | When to use |
|---------|-------|-------------|
| `pnpm typecheck` | ~5s | After any code change |
| `pnpm test:fast` | ~9s | Quick verification (dot reporter) |
| `pnpm test:affected` | <1s | Only tests for changed files |
| `pnpm test` | ~9s | Full unit + integration suite |
| `pnpm test:coverage` | ~15s | See coverage numbers |
| `cd packages/platform-ui && pnpm test:e2e` | ~15s | Playwright smoke tests |
| `cd packages/platform-ui && pnpm test:e2e:auth` | ~60s | Full E2E with Firebase emulators |

### Agent workflow (fastest first)

1. `pnpm typecheck` — catches type errors
2. `pnpm test:affected` — tests for changed files only
3. `pnpm test` — all unit tests
4. E2E tests if UI was changed

### Test naming convention

Use tags in test descriptions to help identify failure types:
- `[RENDER]` — component rendering
- `[CLICK]` — user interaction
- `[ERROR]` — error handling
- `[AUTH]` — permission/auth checks
- `[DATA]` — data fetching/display

### Test factories

Import from `@mediforce/platform-core/testing`:
```typescript
import { buildProcessInstance, buildHumanTask, buildAgentRun } from '@mediforce/platform-core/testing';

const instance = buildProcessInstance({ status: 'paused' });
const task = buildHumanTask({ assignee: 'user-1' });
```

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Minimal code impact.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Touch only what's necessary. Avoid introducing bugs.
- **No Over-Engineering**: Don't add features, refactor code, or make "improvements" beyond what was asked.
