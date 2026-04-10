FROM node:24-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace root files for pnpm install
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/platform-core/package.json packages/platform-core/
COPY apps/pharmaverse-governance/package.json apps/pharmaverse-governance/

RUN pnpm install --frozen-lockfile || pnpm install

# Copy source and build
COPY packages/platform-core/ packages/platform-core/
COPY apps/pharmaverse-governance/ apps/pharmaverse-governance/
COPY tsconfig.json ./

RUN pnpm --filter @mediforce/pharmaverse-governance build:scripts

# --- Runner ---
FROM node:24-slim

WORKDIR /app

COPY --from=builder /app/apps/pharmaverse-governance/dist/discover-packages.js /app/discover-packages.js
COPY --from=builder /app/apps/pharmaverse-governance/dist/collect-metrics.js /app/collect-metrics.js
COPY --from=builder /app/apps/pharmaverse-governance/dist/apply-governance-state.js /app/apply-governance-state.js

RUN mkdir -p /output
