# Stage 1: Build
FROM node:22-slim AS builder

# pnpm version comes from the root package.json packageManager field
RUN corepack enable

WORKDIR /app

# Copy workspace config and lockfile first for layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/

# Install dependencies with frozen lockfile
RUN pnpm install --frozen-lockfile

# Copy source for shared (dependency) and client
COPY tsconfig.base.json tsconfig.json ./
COPY packages/shared/ packages/shared/
COPY packages/client/ packages/client/

# Build shared first (client may reference shared types), then client via Vite
RUN pnpm --filter @nexus/shared build && \
    pnpm --filter @nexus/client build

# Stage 2: Serve with nginx
FROM nginx:alpine AS production

# Upstream for the /api/ proxy — the nginx entrypoint envsubstitutes this into
# the template below. Compose/local default; Railway overrides via service var.
ENV API_UPSTREAM=http://api:3001

# Copy nginx config as an envsubst template — the official image renders
# /etc/nginx/templates/*.template into /etc/nginx/conf.d/ at startup,
# replacing the default server block (same target filename).
COPY packages/client/nginx.conf /etc/nginx/templates/default.conf.template

# Copy built static assets
COPY --from=builder /app/packages/client/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
