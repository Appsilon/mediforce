---
type: concept
created: 2026-04-23
updated: 2026-04-23
sources: 3
tags: [concept, docker, spawn-strategy, redis, bullmq]
---

**Two strategies for spawning agent containers: `LocalDockerSpawnStrategy` (default, child process) and `QueuedDockerSpawnStrategy` (BullMQ worker). Activation is toggled by the `REDIS_URL` env var.**

## Strategies

### `LocalDockerSpawnStrategy` (default)

- Spawns `docker run` as a child process from `platform-ui` or a dev shell.
- Writes stdout/stderr to log files in real time.
- Optional `lineProcessor` callback for JSONL parsing of agent output.

### `QueuedDockerSpawnStrategy` (`REDIS_URL` set)

- Serialises input files through Redis.
- Enqueues a job on BullMQ.
- A worker (separate process, `pnpm dev:worker`) pops the job, runs the container remotely, and pushes output files back through Redis.
- Enables distributed execution + isolation of container workload from the web server.

## Activation

Env var: `REDIS_URL`. If set, `agent-runtime` swaps `LocalDockerSpawnStrategy` for `QueuedDockerSpawnStrategy` via the optional `@mediforce/agent-queue` package. Dev commands for the queued path:

```bash
pnpm dev:redis          # Redis on 6379
pnpm dev:worker         # BullMQ worker
pnpm dev:ui:queue       # platform-ui with queue enabled
```

## Local vs container execution

A separate gate: `ALLOW_LOCAL_AGENTS=true` skips Docker entirely and runs the agent CLI on the host. Used for `pnpm dev:local`. See `BaseContainerAgentPlugin` — it branches on this flag before touching the spawn strategy.

## Mock mode

`MOCK_AGENT=true` short-circuits the spawn: `BaseContainerAgentPlugin.spawnDockerContainer()` calls the subclass's `getMockDockerArgs()` and mounts `mock-fixtures/` + optional `_config.json` dataDir. Returns fixture output instantly.

## Used by

- [`claude-code-agent`](../entities/plugins/claude-code-agent.md), [`opencode-agent`](../entities/plugins/opencode-agent.md), [`script-container`](../entities/plugins/script-container.md) — all three run through this machinery.

## Sources

- `packages/agent-runtime/src/plugins/docker-spawn-strategy.ts`
- `packages/agent-runtime/src/plugins/base-container-agent-plugin.ts`
- `AGENTS.md` → "Docker spawn strategies", "Additional Commands"
