# Getting a Docker image onto the platform

This guide explains how to make a Docker image available to a Mediforce workflow step when you are not using the auto-build path (`repo` + `commit` on the step config).

## Prerequisites

- Docker installed locally
- Access to the registry the Mediforce platform can reach (ask your namespace admin for the registry URL)
- `docker login` completed for that registry

## Steps

### 1. Build the image

```bash
docker build -t <registry-url>/<image-name>:<tag> .
```

Example:
```bash
docker build -t registry.example.com/my-agent:v1.0.0 .
```

### 2. Push the image to the registry

```bash
docker push <registry-url>/<image-name>:<tag>
```

### 3. Reference the image in your workflow step

In the workflow editor, set the `image` field on the step to the full image reference:

```
registry.example.com/my-agent:v1.0.0
```

### 4. Verify availability

After pushing, open the workflow editor. The amber warning on the step should disappear once the platform detects the image (the check runs every 60 seconds, or re-open the editor to force a refresh).

## Choosing a base image

A step runs its command *inside* the image, so the image must already contain what the command needs:

| Step | Needs in the image |
|------|--------------------|
| `executor: agent` | The agent CLI (`claude` or `opencode`) and a shell — start from `mediforce-golden-image` |
| `executor: script`, `script.command` | Whatever the command invokes (`python`, `Rscript`, `node`, …) |
| `executor: script`, `script.inlineScript` | Nothing — the runtime's image is selected automatically |

Minimal base images (`alpine`, `scratch`, distroless) ship none of this. `alpine` in particular has BusyBox `sh` but no `bash`, and no agent CLI at all, so an agent step pointed at it fails at container start. They are only useful as the `FROM` line of an image you build on top of.

## Troubleshooting

- **`exec: "<binary>": executable file not found in $PATH`** — the image has no such executable. The container started and immediately exited 127. Point the step at an image that ships the tooling (see [Choosing a base image](#choosing-a-base-image)), or add it in a Dockerfile that builds `FROM` the minimal image.
- **Image still shows as missing after pushing** — confirm the registry URL matches exactly what the platform can reach. Ask your namespace admin to verify registry connectivity via `mediforce system status`.
- **Authentication error during push** — run `docker login <registry-url>` and retry.
- **Using the auto-build path instead** — set `repo` and `commit` on the step. The platform will build the image automatically before the run starts.

## See also

- `mediforce system images` — list images currently available on the platform
- `mediforce system status` — check Docker daemon and registry connectivity
