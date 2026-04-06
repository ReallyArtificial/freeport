# Freeport — Setup Guide

## Prerequisites

- **Node.js 20+** (check: `node -v`)
- **npm 9+** (ships with Node 20)
- At least one LLM API key (OpenAI, Anthropic, or Google)

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Build the admin UI
cd admin-ui && npm install && npm run build && cd ..

# 3. Start the server
npm run dev
```

That's it. The server starts on `http://localhost:4000`.

Open `http://localhost:4000/ui/` and go to **Providers** to add your API keys through the UI. No environment variables or config files needed to get started.

## Configuration

Freeport loads providers from **three sources** (all combine together):

### Option A: Admin UI (easiest)

Just run `npm run dev` and open `http://localhost:4000/ui/`. Go to the **Providers** page and add your API keys. They are stored in the local SQLite database and persist across restarts.

### Option B: Environment Variables

Set one or more provider keys and run:

```bash
# Single provider
FREEPORT_OPENAI_API_KEY=sk-xxx npm run dev

# Multiple providers
FREEPORT_OPENAI_API_KEY=sk-xxx \
FREEPORT_ANTHROPIC_API_KEY=sk-ant-xxx \
FREEPORT_GOOGLE_API_KEY=AIza-xxx \
npm run dev
```

| Variable | Description |
|----------|-------------|
| `FREEPORT_OPENAI_API_KEY` | OpenAI API key |
| `FREEPORT_ANTHROPIC_API_KEY` | Anthropic API key |
| `FREEPORT_GOOGLE_API_KEY` | Google AI / Gemini API key |
| `FREEPORT_ADMIN_API_KEY` | Admin API auth token (optional in dev) |
| `FREEPORT_HOST` | Bind address (default: `0.0.0.0`) |
| `FREEPORT_PORT` | Server port (default: `4000`) |
| `FREEPORT_CONFIG` | Path to a YAML config file |

### Option C: YAML Config File

For full control, create a YAML config. Freeport checks these paths in order:

1. Path passed via `FREEPORT_CONFIG` env var
2. `config/freeport.yaml`
3. `config/freeport.yml`
4. `freeport.yaml` (project root)

Copy the example to get started:

```bash
cp config/freeport.example.yaml config/freeport.yaml
```

Edit the file and set your API keys. The YAML supports env var interpolation:

```yaml
providers:
  - name: openai
    type: openai
    keys:
      - key: "${OPENAI_API_KEY}"
```

Then set `OPENAI_API_KEY` in your shell or `.env` file.

## Running the Server

### Development (with hot reload)

```bash
npm run dev
```

Uses `tsx watch` — restarts automatically on file changes. Add API keys via the admin UI at `http://localhost:4000/ui/`, or pass them as env vars:

```bash
FREEPORT_OPENAI_API_KEY=sk-xxx npm run dev
```

### Production

```bash
npm run build
npm start -- --production
```

In production mode, `auth.adminApiKey` and `auth.apiKey` are required. Configure providers via env vars or YAML config.

### Docker

```bash
docker-compose up
```

Set API keys in `docker-compose.yml` or pass them via environment:

```bash
OPENAI_API_KEY=sk-xxx docker-compose up
```

## Building the Admin UI

The admin dashboard is a separate Preact app that needs to be compiled:

```bash
cd admin-ui
npm install
npm run build
```

After building, restart the server. The UI is served at `http://localhost:4000/ui/`.

If you skip this step, visiting `/ui/` will show instructions instead of a 404.

## Verifying It Works

### Health check

```bash
curl http://localhost:4000/health
```

Expected: `{"status":"ok","timestamp":"...","version":"0.1.0"}`

### List models

```bash
curl http://localhost:4000/v1/models
```

### Send a chat completion

```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Admin API (no auth in dev mode)

```bash
# List projects
curl http://localhost:4000/api/projects

# View request logs
curl http://localhost:4000/api/logs

# Get spend stats
curl http://localhost:4000/api/logs/stats
```

## Troubleshooting

### `Route GET:/ui/ not found`

**Cause:** The admin UI hasn't been built. This is expected in dev if you haven't compiled the frontend.

**Fix:**

```bash
cd admin-ui && npm install && npm run build
```

Then restart the server. Or just ignore it — the proxy and API work without the UI.

### `EADDRINUSE: address already in use :::4000`

**Cause:** Another process is using port 4000.

**Fix:** Kill the process or use a different port:

```bash
# Find what's using the port
lsof -i :4000

# Or start on a different port
FREEPORT_PORT=4001 npm run dev
```

### Missing environment variables in YAML config

If your YAML config references `${SOME_VAR}` and the env var isn't set, the provider is skipped automatically in dev mode. You can add providers through the admin UI instead, or set the env var, or add a default in the YAML: `${SOME_VAR:-default_value}`.

### `Cannot find module './db/migrations/001_initial.sql'`

**Cause:** SQL migration files weren't copied to `dist/` during build.

**Fix:** Run `npm run build` — the build script copies `.sql` files automatically. This only affects production mode (`npm start`). Dev mode (`npm run dev`) reads from `src/` directly.

### Embedder / semantic cache warnings

If you see warnings like `Embedder init failed`, that's **non-fatal**. The semantic cache has two tiers:

1. **Local embedding** via `@huggingface/transformers` (optional, downloads a ~30MB model on first run)
2. **SHA-256 hash matching** (automatic fallback, always works)

If the HuggingFace model can't load, the cache falls back to exact-match hashing. To use the full semantic cache:

```bash
npm install @huggingface/transformers
```

### SQLite `SQLITE_BUSY` errors under load

Freeport uses WAL mode with a 5-second busy timeout. If you see busy errors:

- Ensure only one server process is writing to the same database file
- The `data/` directory is on a local filesystem (not NFS/network mount)

## Project Structure (Key Files)

```
src/
  index.ts              Entry point
  server.ts             Fastify setup + routes
  config/loader.ts      Config loading + validation
  proxy/handler.ts      Main LLM proxy handler
  providers/            OpenAI, Anthropic, Google adapters + runtime manager
  admin/routes.ts       Admin API endpoints (incl. provider CRUD)
admin-ui/               Preact dashboard (build separately)
config/                 YAML config files
data/                   SQLite database (auto-created)
plugins/                Custom guardrail plugins
```

## Optional Features

These are disabled by default. Enable them in your config:

| Feature | Config Key | Notes |
|---------|-----------|-------|
| Semantic cache | `cache.enabled: true` | Caches similar prompts, reduces cost |
| Rate limiting | `rateLimit.enabled: true` | Token bucket per API key |
| Guardrails | `guardrails.enabled: true` | PII detection, content filter |
| A/B testing | `abTesting.enabled: true` | Prompt variant testing |
| Admin auth | `auth.adminApiKey: "secret"` | Protects `/api/` endpoints |
| Budget enforcement | `budget.enforcementMode: hard` | Rejects requests over budget |
