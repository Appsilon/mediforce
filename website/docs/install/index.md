---
title: Install Mediforce
sidebar_label: Install
sidebar_position: 1
---

# Install Mediforce

A Mediforce deployment is five containers behind a reverse proxy: the app, a
container worker that runs workflow steps, Postgres, Redis, and Caddy for TLS.
You bring a domain, a machine with Docker, and the values in
[Configuration](#configuration).

## Prerequisites

- A host with Docker and the Compose plugin, and ports 80 and 443 free.
- A DNS `A` record pointing your domain at that host. Caddy provisions the
  certificate on first start, which needs port 80 reachable from the internet.
- An OpenRouter API key if any workflow uses agent steps.

## Start it

```bash
git clone https://github.com/Appsilon/mediforce.git
cd mediforce
cp .env.example .env
```

Fill in `.env` (see below), then:

```bash
docker compose -f docker-compose.prod.yml up -d
```

Database migrations run as their own `migrate` service before the app starts, so
there is no manual migration step. Follow the logs until the app reports ready:

```bash
docker compose -f docker-compose.prod.yml logs -f platform-ui
```

## Configuration

### Required

The server **refuses to boot** without these — a deployment that started with a
throwaway session secret or no secrets key would silently put user data at risk,
so it fails loudly instead.

| Variable | What it is |
|---|---|
| `AUTH_SECRET` | Signs and encrypts sessions. `openssl rand -hex 32` |
| `SECRETS_ENCRYPTION_KEY` | Encrypts workflow secrets at rest, 32 bytes as 64 hex chars. `openssl rand -hex 32` |
| `PLATFORM_API_KEY` | Server-to-server API authentication, and what the CLI presents as `X-Api-Key` |
| `POSTGRES_PASSWORD` | Password for the bundled Postgres |
| `NEXT_PUBLIC_APP_URL` | The deployment's public origin, e.g. `https://mediforce.acme.com` |
| `DOMAIN` | The host Caddy serves and requests a certificate for. Should equal `NEXT_PUBLIC_APP_URL`'s host |

:::danger Keep `SECRETS_ENCRYPTION_KEY` safe
Losing it makes every stored workflow secret unrecoverable. Back it up
somewhere other than the machine running Mediforce.
:::

### Sign-in

At least one sign-in method must be enabled or nobody can get in, and the server
refuses to start rather than serve a deployment nobody can use.

| Variable | Default | Notes |
|---|---|---|
| `ENABLE_PASSWORD_AUTH` | **on** | Email and password. Leave unset to keep it. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | off | Adds "Sign in with Google" |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | off | One IdP per deployment — Keycloak, Entra, Okta. `OIDC_DISPLAY_NAME` names the button |
| `ENABLE_MAGIC_LINK` | off | Passwordless email links. Needs a working mail transport |
| `ALLOWED_EMAIL_DOMAINS` | unset | Comma-separated allowlist, enforced across **every** provider |

:::warning Google without an allowlist lets anyone in
`ALLOWED_EMAIL_DOMAINS` is what stops any Google account on earth signing in.
If you enable Google, set it — for example `ALLOWED_EMAIL_DOMAINS=acme.com`.
:::

### Email

Optional, and Mediforce degrades rather than breaks without it. Two things change
when no transport is configured: inviting someone still creates their account and
membership, but the invite reports **"Email not sent — let them know to sign in"**
and you tell them out of band; and the **Send email** block in the workflow
editor appears greyed out, because the instance cannot offer what it cannot do.

Set `EMAIL_PROVIDER` to `smtp` or `mailgun`, then either the `SMTP_*` group
(`SMTP_HOST`, `SMTP_PORT` default `587`, `SMTP_SECURE` default `true`,
`SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL`) or the `MAILGUN_*` group
(`MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM_EMAIL`). To run with no mail
at all, set `MEDIFORCE_DISABLE_EMAIL=true`.

### Agents

`DOCKER_OPENROUTER_API_KEY` and `DOCKER_DEEPSEEK_API_KEY` are injected into the
containers that run agent steps — the `DOCKER_` prefix means "passed to step
containers", not "read by the app". Without credit on the account, agent steps
fail at run time; the readiness check warns you before you start a run.

## Verify

```bash
docker compose -f docker-compose.prod.yml ps
```

All services should be `running`, with `migrate` `exited (0)` — it does its job
once and stops. Then open your domain: with no workspace yet, Mediforce takes
you to workspace creation.

## Upgrading

Images are tagged `latest` on GHCR, so an upgrade is a pull and a recreate.
Migrations run again on the way up.

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Back up Postgres before upgrading a deployment that holds real work:

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U mediforce mediforce > mediforce-backup.sql
```
