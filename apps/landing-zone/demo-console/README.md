# Landing Zone — Demo Console

Tiny FastAPI app deployed **on the Hetzner SFTP host**. Serves a single-page
scenario chooser and exposes `POST /seed` which wipes `/upload/` and copies a
pre-staged scenario into place — local cp/touch, same host.

## Deploy

```bash
LANDING_ZONE_HOST=cro-sftp.example.com \
LANDING_ZONE_SSH_USER=cro \
LANDING_ZONE_API_KEY=$(openssl rand -hex 16) \
bash apps/landing-zone/demo-console/deploy.sh
```

The script is idempotent — rsyncs sample-data, installs/refreshes the app +
venv, restarts a tmux session named `lz-demo`. Print the API key when it
finishes; paste it into the SPA prompt at `http://<host>:8080/`.

See the top of `deploy.sh` for all env vars (paths, ports, etc.).

## Endpoints

| Method | Path         | Auth        | What                                |
|--------|--------------|-------------|-------------------------------------|
| GET    | `/`          | none        | SPA (vanilla JS + Tailwind via CDN) |
| GET    | `/scenarios` | none        | scenario catalog                    |
| GET    | `/healthz`   | none        | liveness                            |
| POST   | `/seed`      | `X-Api-Key` | `{ scenario: "<key>" }` → seed it   |

Scenarios + variant-aware mtime semantics live inline in `app.py`. The
canonical SCENARIOS map mirrors `apps/landing-zone/scripts/seed_sftp.py`.
