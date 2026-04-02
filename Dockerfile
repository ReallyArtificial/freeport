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

# Admin UI build (if present)
COPY admin-ui/ ./admin-ui/
RUN if [ -f admin-ui/package.json ]; then \
      cd admin-ui && npm install && npm run build; \
    fi

# Production stage
FROM base AS production

# Install only production deps
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/admin-ui/dist ./admin-ui/dist 2>/dev/null || true

# Copy config and migrations
COPY config/ ./config/
COPY src/db/migrations/*.sql ./dist/db/migrations/

# Create data directory
RUN mkdir -p /app/data /app/plugins

# Environment defaults
ENV NODE_ENV=production
ENV FREEPORT_PORT=4000
ENV FREEPORT_HOST=0.0.0.0

EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
