FROM node:24-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace root files for pnpm install
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/platform-core/package.json packages/platform-core/
COPY apps/pharmaverse-governance/package.json apps/pharmaverse-governance/

RUN pnpm install --frozen-lockfile --shamefully-hoist || pnpm install --shamefully-hoist

# Copy source and build
COPY packages/platform-core/ packages/platform-core/
COPY apps/pharmaverse-governance/ apps/pharmaverse-governance/
COPY tsconfig.json ./

RUN pnpm --filter @mediforce/pharmaverse-governance build:scripts

# --- Runner ---
FROM node:24-slim

# Install chromium for PDF generation via puppeteer
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libcups2 \
    libdrm2 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy built scripts
COPY --from=builder /app/apps/pharmaverse-governance/dist/discover-packages.js /app/discover-packages.js
COPY --from=builder /app/apps/pharmaverse-governance/dist/collect-metrics.js /app/collect-metrics.js
COPY --from=builder /app/apps/pharmaverse-governance/dist/apply-governance-state.js /app/apply-governance-state.js
COPY --from=builder /app/apps/pharmaverse-governance/dist/generate-package-reports.js /app/generate-package-reports.js
COPY --from=builder /app/apps/pharmaverse-governance/dist/notify-maintainers.js /app/notify-maintainers.js

# Copy node_modules from builder (puppeteer + deps needed at runtime for PDF generation)
COPY --from=builder /app/node_modules /app/node_modules

# Add package.json so Node ESM resolution can find packages in node_modules
RUN echo '{"type":"module"}' > /app/package.json

RUN mkdir -p /output
