# Stage 1: Build
FROM node:22-slim AS builder

# pnpm version comes from the root package.json packageManager field
RUN corepack enable

WORKDIR /app

# Copy workspace config and lockfile first for layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/agent/package.json packages/agent/

# Install dependencies with frozen lockfile
RUN pnpm install --frozen-lockfile

# Copy source for shared and agent
COPY tsconfig.base.json tsconfig.json ./
COPY packages/shared/ packages/shared/
COPY packages/agent/ packages/agent/

# Build shared first, then agent
RUN pnpm --filter @nexus/shared build && \
    pnpm --filter @nexus/agent build

# Stage 2: Production
FROM node:22-slim AS production

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/agent/package.json packages/agent/

RUN pnpm install --frozen-lockfile --prod

# Copy built output
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/agent/dist packages/agent/dist

ENV NODE_ENV=production

# Long-running poll loop — no port, no healthcheck
CMD ["node", "packages/agent/dist/start.js"]
