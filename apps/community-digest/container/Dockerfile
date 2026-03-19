FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace root files for pnpm install
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/platform-core/package.json packages/platform-core/
COPY apps/community-digest/package.json apps/community-digest/

RUN pnpm install --frozen-lockfile || pnpm install

# Copy source and build
COPY packages/platform-core/ packages/platform-core/
COPY apps/community-digest/ apps/community-digest/
COPY tsconfig.json ./

RUN pnpm --filter @mediforce/community-digest build:gather

# --- Runner ---
FROM node:20-slim

WORKDIR /app

COPY --from=builder /app/apps/community-digest/dist/gather-github-changes.js /app/gather-github-changes.js

RUN mkdir -p /output
