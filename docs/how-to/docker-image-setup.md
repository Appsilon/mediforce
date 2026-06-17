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

## Troubleshooting

- **Image still shows as missing after pushing** — confirm the registry URL matches exactly what the platform can reach. Ask your namespace admin to verify registry connectivity via `mediforce system status`.
- **Authentication error during push** — run `docker login <registry-url>` and retry.
- **Using the auto-build path instead** — set `repo` and `commit` on the step. The platform will build the image automatically before the run starts.

## See also

- `mediforce system images` — list images currently available on the platform
- `mediforce system status` — check Docker daemon and registry connectivity
