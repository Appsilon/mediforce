# @mediforce/container-worker

BullMQ worker that runs container steps off the request path. **Activated by
`REDIS_URL`** — unset, the platform spawns containers locally in-process and
this package is never loaded.

That switch is the whole point: a single-box development setup needs no Redis
and no worker, while a deployment that has them gets queued execution and
horizontal scale without any workflow or plugin changing.

## What it does

`agent-runtime`'s `QueuedDockerSpawnStrategy` enqueues a job instead of spawning
a container. This worker consumes the queue, runs the container, streams
progress back, and returns the output envelope. The plugin cannot tell the
difference — same contract either way.

## Layout

```
src/worker-entry.ts      Process entry point
src/job-processor.ts     Consumes queue jobs, runs the container
src/queue-client.ts      Enqueue side
src/connection.ts        Redis connection
src/schemas.ts           Job payload contracts
src/docker-image-builder.ts   On-demand image builds
src/docker-cleanup.ts    Reaps stale containers
src/docker-info.ts       Daemon capability probing
src/file-payload.ts      Workspace file transfer
src/http-server.ts       Health and status endpoint
```

## Rules

**Jobs must be idempotent.** BullMQ retries. A job that half-committed its
effects and then re-ran produces duplicate work, and for a workflow step that
means a duplicated audit trail.

**Payload schemas are a cross-process contract.** The enqueuing platform and the
worker are deployed separately and can briefly run different versions. Change
`src/schemas.ts` additively.

This is infrastructure, exercised by the container runs it serves rather than by
unit tests of its own.
