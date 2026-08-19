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
src/worker-entry.ts    Process entry point
src/queue-client.ts    Enqueue side, used by agent-runtime
src/job-processor.ts   Consume side — runs the container, streams progress back
src/schemas.ts         Job payload contracts
```

The rest is Docker plumbing the processor leans on: image builds, stale-container
cleanup, daemon probing, workspace file transfer, and a health endpoint.

## Rules

**Jobs must be idempotent.** BullMQ retries. A job that half-committed its
effects and then re-ran produces duplicate work, and for a workflow step that
means a duplicated audit trail.

**Payload schemas are a cross-process contract.** The enqueuing platform and the
worker are deployed separately and can briefly run different versions. Change
`src/schemas.ts` additively.

## Testing

Vitest covers the pieces with real logic — job processing, image builds,
payload transfer, cleanup, daemon probing, the health endpoint. The queue
round trip itself is proven by the container runs it serves, not by mocking
BullMQ.
