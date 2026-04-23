# syntax=docker/dockerfile:1.6
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
COPY packages/workflow-engine/package.json packages/workflow-engine/
COPY packages/agent-runtime/package.json packages/agent-runtime/
COPY packages/agent-queue/package.json packages/agent-queue/
COPY packages/mcp-client/package.json packages/mcp-client/
COPY packages/supply-intelligence/package.json packages/supply-intelligence/
COPY packages/supply-intelligence-plugins/package.json packages/supply-intelligence-plugins/
COPY packages/platform-ui/package.json packages/platform-ui/
COPY apps/community-digest/package.json apps/community-digest/
COPY apps/protocol-to-tfl/package.json apps/protocol-to-tfl/
COPY apps/supply-intelligence/package.json apps/supply-intelligence/

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

# --- Runner ---
FROM node:24-slim AS runner

# Git needed for cloning workflow repos (skill loading, lazy image build)
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy standalone output (includes server.js + traced node_modules)
COPY --from=builder /app/packages/platform-ui/.next/standalone ./
# Copy static assets
COPY --from=builder /app/packages/platform-ui/.next/static ./packages/platform-ui/.next/static
# Copy public assets (PWA icons, manifest, service worker)
COPY --from=builder /app/packages/platform-ui/public ./packages/platform-ui/public

EXPOSE 3000

CMD ["node", "packages/platform-ui/server.js"]
