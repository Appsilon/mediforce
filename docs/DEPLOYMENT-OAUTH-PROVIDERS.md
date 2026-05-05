# Deployment runbook: OAuth providers

OAuth providers (GitHub, Google, etc.) are configured per deployment via
environment variables. The platform's boot-time seeder reads
`data/seeds/oauth-providers.json`, resolves the named env vars, and upserts
each entry into Firestore at `namespaces/{handle}/oauthProviders/{id}`.

This means:

- **Provider URLs and scopes live in the repo** — same JSON in every deployment.
- **Client credentials live in env vars per deployment** — different OAuth Apps
  registered on the provider side for staging vs. production vs. each pharma
  tenant.
- **Boot is idempotent** — redeploys converge on the JSON-defined config; missing
  env vars cause that provider to be skipped (with a warning) instead of failing.

## Domain → callback URL

Each deployment needs its own OAuth App registered on the provider, because
OAuth Apps are pinned to a single callback URL.

| Deployment | Public URL | Callback URL (used during OAuth App registration) |
|------------|------------|--------------------------------------------------|
| Local dev | `http://localhost:9003` | `http://localhost:9003/api/oauth/github/callback` |
| Staging | `https://staging.mediforce.app` | `https://staging.mediforce.app/api/oauth/github/callback` |
| Production | `https://mediforce.app` | `https://mediforce.app/api/oauth/github/callback` |
| Pharma `<tenant>` | tenant's domain | `<tenant-domain>/api/oauth/github/callback` |

The callback path is fixed at `/api/oauth/<provider>/callback`. For non-GitHub
providers, swap `github` for the provider id (matches `id` in
`data/seeds/oauth-providers.json`).

## Per-deployment setup

### 1. Register the OAuth App on the provider

For GitHub (other providers analogous — see their docs):

1. Open <https://github.com/settings/applications/new> (or the org's developer
   settings if registering on behalf of an organization).
2. **Application name**: deployment-specific, e.g. "Mediforce Staging".
3. **Homepage URL**: this deployment's public URL.
4. **Authorization callback URL**: the deployment's callback URL from the table above.
5. Save, then generate a **Client secret** (one-shot — copy it now).

### 2. Write credentials to the deployment's `.env`

Each deployment's runtime env lives in a single file on the host that
`docker compose` reads via `${VAR}` substitution:

| Deployment | File on host |
|------------|--------------|
| Local dev | `packages/platform-ui/.env.local` (in repo) |
| Staging / production VPS | `/opt/mediforce/.env` |
| Pharma VPS | tenant's equivalent |

**Interactive (recommended for first-time setup)** — guides through the steps
above, prompts for the client id + secret, and writes them to the env file:

```bash
python3 scripts/seed_oauth_providers.py --env-file /opt/mediforce/.env
```

Use `--public-url` to pre-fill the callback URL in the displayed instructions
when `MEDIFORCE_PUBLIC_URL` / `APP_BASE_URL` aren't already in the env file:

```bash
python3 scripts/seed_oauth_providers.py \
  --env-file /opt/mediforce/.env \
  --public-url https://staging.mediforce.app
```

**Non-interactive (CI / automated deploys)** — only reports missing vars,
exits 0:

```bash
python3 scripts/seed_oauth_providers.py --env-file .env --non-interactive
```

**Check only** — read-only audit, exits 1 if anything is missing:

```bash
python3 scripts/seed_oauth_providers.py --env-file .env --check
```

You can also edit the env file by hand. The required keys for each provider
are listed in `data/seeds/oauth-providers.json` under `clientIdEnv` /
`clientSecretEnv`. For GitHub:

```
OAUTH_GITHUB_CLIENT_ID=Iv1.abc123...
OAUTH_GITHUB_CLIENT_SECRET=xxx
```

### 3. Restart the platform

The seeder runs on `getPlatformServices()` first call, which is during boot:

```bash
# VPS
docker compose -f docker-compose.prod.yml restart platform-ui

# Local dev
pnpm dev   # (if not already running)
```

Look for the log line:

```
[seed-oauth-providers] Upserted N provider(s).
```

### 4. Verify in admin UI

Open `/{handle}/admin/oauth-providers` (where `{handle}` is your namespace,
e.g. `appsilon`). The provider should appear in the list with the URLs and
scopes from the seed file. Editing it through the UI will overwrite what the
seeder put there — the next boot will re-upsert from the seed, so prefer
changing the seed JSON + redeploying for permanent changes.

## Adding a new provider

1. Add an entry to `data/seeds/oauth-providers.json` for the appropriate
   namespace, with a unique `id`, the provider's OAuth URLs/scopes, and the
   names of two env vars (`clientIdEnv`, `clientSecretEnv`).
2. Add a hint block to `SETUP_HINTS` in `scripts/seed_oauth_providers.py`
   so the interactive flow can show the registration URL and callback path.
3. Add the env var stubs (with empty values) to `.env.example` and
   `packages/platform-ui/.env.local.example`.
4. Add a `${VAR:-}` line to `docker-compose.prod.yml` under the `platform-ui`
   service `environment:` so the var is passed to the container.
5. Document the new provider in this file (extend the table above).

## Troubleshooting

- **Provider not appearing in admin UI after deploy** — check platform-ui logs
  for `[seed-oauth-providers] Skipping ... missing env vars`. The env var
  isn't reaching the platform-ui container; verify it's set in the host
  `.env` file and listed in `docker-compose.prod.yml` under
  `services.platform-ui.environment`.
- **OAuth callback returns 404** — the OAuth App is registered with the wrong
  callback URL. Update it on the provider side to match this deployment's
  domain.
- **`invalid_client` from GitHub** — wrong client id or secret pasted into
  `.env`. Re-run `seed_oauth_providers.py` with the correct values, then
  restart the platform.
