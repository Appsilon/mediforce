# Mediforce K8s images

`Dockerfile.k8s` produces the Mediforce UI image used by the Helm chart in
[`deploy/charts/mediforce/`](../charts/mediforce/). It's a thin layer over
the upstream `packages/platform-ui/Dockerfile` that bakes the `apps/` tree
into the image so the workflow engine can resolve plugin skills at runtime
via `MEDIFORCE_ROOT`.

The worker image (`packages/container-worker/Dockerfile.worker`) does not
need a wrapper — it ships as a single stage upstream.

## Source Dockerfiles

| Image | Build step 1 (upstream) | Build step 2 (k8s wrapper) |
|-------|-------------------------------|-------------------------------|
| `mediforce-ui` | `packages/platform-ui/Dockerfile` → `mediforce-ui-upstream:tag` | `deploy/docker/Dockerfile.k8s` → final image |
| `mediforce-worker` | `packages/container-worker/Dockerfile.worker` | — (single stage) |

## Build

From the mediforce repo root:

```bash
# 1. UI — upstream image
docker build --platform linux/amd64 \
  -f packages/platform-ui/Dockerfile \
  --build-arg NEXT_PUBLIC_FIREBASE_API_KEY=... \
  --build-arg NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=... \
  --build-arg NEXT_PUBLIC_FIREBASE_PROJECT_ID=... \
  --build-arg NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=... \
  --build-arg NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=... \
  --build-arg NEXT_PUBLIC_FIREBASE_APP_ID=... \
  --build-arg NEXT_PUBLIC_APP_URL=https://mediforce.example.com \
  --build-arg NEXT_PUBLIC_GIT_SHA=$(git rev-parse HEAD) \
  -t mediforce-ui-upstream:v0.1.0 \
  .

# 2. UI — k8s wrapper (bakes apps/ into the image)
docker build --platform linux/amd64 \
  -f deploy/docker/Dockerfile.k8s \
  --build-arg BASE_IMAGE=mediforce-ui-upstream:v0.1.0 \
  -t <REGISTRY>/mediforce-ui:v0.1.0 \
  .

# 3. Worker (single stage, no wrapper needed)
docker build --platform linux/amd64 \
  -f packages/container-worker/Dockerfile.worker \
  -t <REGISTRY>/mediforce-worker:v0.1.0 \
  .
```

Substitute `<REGISTRY>` with the destination container registry (e.g. an
ECR URL like `123456789012.dkr.ecr.eu-west-1.amazonaws.com/...` or a Docker
Hub namespace).

## Why the UI build has two stages

The upstream `packages/platform-ui/Dockerfile` runner stage copies only the
Next.js standalone output (`.next/standalone`, `.next/static`, `public/`,
`data/`) into the final image. It does **not** carry
`apps/*/plugins/*/skills/`, but the workflow engine resolves skills
directories from disk at runtime via `MEDIFORCE_ROOT`
([base-container-agent-plugin.ts](https://github.com/Appsilon/mediforce/blob/main/packages/agent-runtime/src/plugins/base-container-agent-plugin.ts)).

Upstream's `docker-compose.prod.yml` works around this gap by
host-bind-mounting the whole repo source at runtime (`.:/repo:ro`,
`MEDIFORCE_ROOT=/repo`). That pattern does not translate to Kubernetes —
there is no host source tree to mount.

`Dockerfile.k8s` extends the upstream image with `COPY apps/ /app/apps/`
and sets `MEDIFORCE_ROOT=/app`. Skills get baked into the image at build
time; changing a skill requires an image rebuild and tag bump.

If the upstream Dockerfile eventually folds the equivalent `COPY apps/`
into its own runner stage, this wrapper becomes unnecessary and the build
collapses back to a single stage.

## Push

```bash
# Authenticate to the destination registry (example: AWS ECR)
aws ecr get-login-password --region <REGION> \
  | docker login --username AWS --password-stdin <REGISTRY>

docker push <REGISTRY>/mediforce-ui:v0.1.0
docker push <REGISTRY>/mediforce-worker:v0.1.0
```

## Build-time public env

The `mediforce-ui` (Next.js) image needs `NEXT_PUBLIC_FIREBASE_*`,
`NEXT_PUBLIC_APP_URL`, and `NEXT_PUBLIC_GIT_SHA` baked in at `docker build`
time — Next.js technical necessity. Pass via `--build-arg` or compose
`args:` block matching the build flow already used for docker-compose
deploys.
