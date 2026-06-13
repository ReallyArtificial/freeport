FROM node:22-slim AS base
WORKDIR /app

# Build stage
FROM base AS builder

# Copy package files
COPY package.json package-lock.json* ./

# Install all dependencies (including dev)
RUN npm install

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Admin UI build — bundle into dist/admin-ui so it ships with the dist copy and
# resolves at runtime relative to the compiled server module (not cwd).
COPY admin-ui/ ./admin-ui/
RUN cd admin-ui && npm install && npm run build && cd .. \
    && mkdir -p dist/admin-ui && cp -r admin-ui/dist/. dist/admin-ui/

# Production stage
FROM base AS production

# Install only production deps
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

# Copy built files (dist already contains admin-ui/ and db/migrations/*.sql)
COPY --from=builder /app/dist ./dist

# Copy default config
COPY config/ ./config/

# Create data directory
RUN mkdir -p /app/data /app/plugins

# Environment defaults. NODE_ENV is intentionally NOT forced to "production" so
# `docker run`/`docker compose up` boots out of the box for evaluation. For a
# hardened deployment, set -e NODE_ENV=production with FREEPORT_ADMIN_API_KEY +
# FREEPORT_API_KEY to enforce required auth.
ENV FREEPORT_PORT=4000
ENV FREEPORT_HOST=0.0.0.0

EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
