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

**Host-daemon HTTP routes carry the shared secret.** The info server's reads
(`/health`, `/images`, `/disk`, `GET /images/:image/history`) are open, but
anything that acts on the daemon — `DELETE /images/:id`,
`GET /images/:image/capabilities`, which starts a probe container,
`POST /images/build`, which clones a repo — or unpacks an uploaded build
context, sent as an `application/x-tar` body — and runs a Dockerfile, and
`POST /images/pull`, which pulls a registry image onto the daemon — requires
`X-Worker-Secret` once `CONTAINER_WORKER_SECRET` is set, and the platform sends
the same value. History is on the open side deliberately: it reads metadata the
daemon already holds and starts nothing.

**The worker's Docker CLI has its own credentials.** It talks to the host
daemon over the mounted socket, but authentication is the *client's*: a
`docker login` run on the host writes the invoking user's
`~/.docker/config.json`, which this container never sees. `docker-compose.prod.yml`
therefore mounts `DOCKER_CONFIG_DIR` (default `/home/deploy/.docker`) at
`/root/.docker` read-only, which is what makes a private-registry pull
(`POST /images/pull`) or a private base image in a build work at all. An unset
variable mounts an empty directory: public images only, as before.

**Payload schemas are a cross-process contract.** The enqueuing platform and the
worker are deployed separately and can briefly run different versions. Change
`src/schemas.ts` additively. The build route's body is the exception that proves
it: `BuildImageRequestSchema` lives in `platform-core` because the platform
builds in two places — in-process when the daemon is local, over this route when
it is not — and one shape is what stops the two drifting on a field. An upload's
query string is `BuildUploadedImageRequestSchema`, and a pull's body
`PullImageRequestSchema`, beside it, for the same reason.

**An uploaded context is extracted, not piped.** `docker build -` reads a tar
from stdin but applies no `.dockerignore` inside it, so `buildImageFromUpload`
unpacks the archive into a `mkdtemp` directory with the host's `tar` and builds
that directory exactly as `buildImageFromRepo` builds a checkout — the same
symlink refusal, the same `finally rm`. The CLI and the Images view have
already left out what the `.dockerignore` excludes; Docker applying it again
here is what stops a client's reading of the file from changing the image. The
platform has already refused an
archive with a path that is absolute, climbs out or runs through a symlink
(`checkBuildContextArchive`); `tar`'s own defaults and `assertInsideClone` are the
second and third lines. It builds under a throwaway `mediforce-upload-staging:*`
tag and moves that onto the requested tag only if the daemon still has none
there, answering **409** (`ImageTagTakenError`) when another upload took it
during the build ([ADR-0022](../../docs/adr/0022-image-catalog.md)). The check
and `docker tag` run back to back and synchronously, so no other upload in the
same process can land between them; only a second process tagging on the same
daemon in those milliseconds could. It counts the body as it unpacks and
answers **413** (`BuildContextTooLargeError`) past the 100 MiB limit, for a
caller that skipped the platform's own check.

**Workspace files never ride inside a job.** A remote caller's files are base64
and can run to many MB. BullMQ keeps job data in the job hash and a return value
in both the hash and the `completed` event, retained by count (and the events
stream trimmed by entry count, not bytes), so files there filled a 256 MiB Redis.
`src/file-payload-store.ts` moves them to their own keys: the caller deletes them
once the job settles, a TTL covers a caller that died. Keep new large fields out
of job data and results the same way. Retention in `src/queue-client.ts` stays
small anyway, since stdout/stderr still sit in every return value.

## Testing

Vitest covers the pieces with real logic — job processing, image builds,
payload transfer, cleanup, daemon probing, the health endpoint. The queue
round trip itself is proven by the container runs it serves, not by mocking
BullMQ.
