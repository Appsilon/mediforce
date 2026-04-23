---
type: concept
created: 2026-04-23
updated: 2026-04-23
sources: 3
tags: [concept, docker, spawn-strategy, redis, bullmq]
---

**Two strategies. `LocalDockerSpawnStrategy` (default, child process) vs `QueuedDockerSpawnStrategy` (BullMQ worker). Toggled by `REDIS_URL` env var.**

## Strategies

### `LocalDockerSpawnStrategy` (default)

- `docker run` as child process from `platform-ui` or dev shell.
- stdout/stderr → log files in real time.
- Optional `lineProcessor` callback for JSONL output parsing.

### `QueuedDockerSpawnStrategy` (`REDIS_URL` set)

- Inputs serialised through Redis.
- Job enqueued on BullMQ.
- Worker (separate process, `pnpm dev:worker`) pops job → runs container → pushes outputs back via Redis.
- Distributed execution. Isolates container workload from web server.

## Activation

Env var: `REDIS_URL`. Set → `agent-runtime` swaps Local for Queued via optional `@mediforce/agent-queue`.

Dev commands for queued path:

```bash
pnpm dev:redis          # Redis on 6379
pnpm dev:worker         # BullMQ worker
pnpm dev:ui:queue       # platform-ui with queue enabled
```

## Local (non-container) execution

Separate gate: `ALLOW_LOCAL_AGENTS=true` → skips Docker entirely, runs agent CLI on host. Used for `pnpm dev:local`. `BaseContainerAgentPlugin` branches on this before touching spawn strategy.

## Mock mode

`MOCK_AGENT=true` short-circuits spawn: `BaseContainerAgentPlugin.spawnDockerContainer()` calls subclass's `getMockDockerArgs()` + mounts `mock-fixtures/` + optional `_config.json` dataDir. Returns fixture output instantly.

## Used by

- [`claude-code-agent`](../entities/plugins/claude-code-agent.md), [`opencode-agent`](../entities/plugins/opencode-agent.md), [`script-container`](../entities/plugins/script-container.md) — all three run through this machinery.

## Sources

- `packages/agent-runtime/src/plugins/docker-spawn-strategy.ts`
- `packages/agent-runtime/src/plugins/base-container-agent-plugin.ts`
- `AGENTS.md` → "Docker spawn strategies", "Additional Commands"
