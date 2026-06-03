# syntax=docker/dockerfile:1.24
FROM node:24-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# --- Dependencies ---
FROM base AS deps
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/platform-core/package.json packages/platform-core/
COPY packages/platform-infra/package.json packages/platform-infra/
COPY packages/platform-api/package.json packages/platform-api/
COPY packages/workflow-engine/package.json packages/workflow-engine/
COPY packages/agent-runtime/package.json packages/agent-runtime/
COPY packages/container-worker/package.json packages/container-worker/
COPY packages/mcp-client/package.json packages/mcp-client/
COPY packages/core-actions/package.json packages/core-actions/
COPY packages/mediforce-mcp/package.json packages/mediforce-mcp/
COPY packages/platform-ui/package.json packages/platform-ui/
COPY apps/community-digest/package.json apps/community-digest/
COPY apps/protocol-to-tfl/package.json apps/protocol-to-tfl/
COPY apps/examples/personal-automations/package.json apps/examples/personal-automations/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm config set package-import-method copy && \
    (pnpm install --frozen-lockfile || pnpm install)

# --- Builder ---
FROM base AS builder
WORKDIR /app

COPY --from=deps /app ./
COPY . .

# Firebase config must be available at build time (NEXT_PUBLIC_* vars are inlined)
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_GIT_SHA

RUN pnpm --filter @mediforce/platform-ui build

# --- Migrate (init container) ---
# ADR-0001 — schema migrations run as a separate short-lived service
# (see docker-compose.prod.yml `migrate` service), gated by
# `depends_on: { migrate: { condition: service_completed_successfully } }`
# on platform-ui. This decouples migrations from the app boot path so the
# Next.js standalone bundle no longer needs to ship `postgres` /
# `drizzle-orm` / `drizzle-kit`.
#
# Derived from `deps` + source rather than `builder`: the migration container
# needs only the workspace, devDeps (`drizzle-kit`), and migration files — not
# the Next.js build. Deriving from `builder` would force the arg-less `migrate`
# service build to run `pnpm build`, whose `/workspaces/new` prerender
# initializes the Firebase client and fails with `auth/invalid-api-key` because
# the `NEXT_PUBLIC_FIREBASE_*` build args are only passed to the `platform-ui`
# service. The image is short-lived; size is not a concern.
FROM base AS migrate
WORKDIR /app
COPY --from=deps /app ./
COPY . .
WORKDIR /app/packages/platform-infra
CMD ["sh", "-c", "pnpm exec drizzle-kit migrate && pnpm exec tsx src/sync/migrate-with-sync.ts"]

# --- Runner ---
FROM node:24-slim AS runner

# Git needed for cloning workflow repos (skill loading, lazy image build)
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV MEDIFORCE_ROOT=/app

# Copy standalone output (includes server.js + traced node_modules)
COPY --from=builder /app/packages/platform-ui/.next/standalone ./
# Copy static assets
COPY --from=builder /app/packages/platform-ui/.next/static ./packages/platform-ui/.next/static
# Copy public assets (PWA icons, manifest, service worker)
COPY --from=builder /app/packages/platform-ui/public ./packages/platform-ui/public
# Seed JSONs (agent-definitions, tool-catalog) read at platform-services init.
# Not reliably picked up by Next.js output file tracing in this build, so copy explicitly.
COPY --from=builder /app/data ./data

# mediforce-mcp — stdio MCP server providing platform tools to cowork agents.
# Linked globally so `mediforce-mcp` command is on PATH (same pattern as
# tealflow-mcp). Copies workspace source + node_modules from builder.
#
# TODO: migrate to HTTP MCP (option B) or sidecar (option C) when this
# outgrows a single tool.
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules
RUN npm install -g tsx@4 && cd packages/mediforce-mcp && npm link

EXPOSE 3000

CMD ["node", "packages/platform-ui/server.js"]
