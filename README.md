# @reallyartificial/freeport

**The open-source LLM gateway you run yourself.** A self-hosted, OpenAI-API-compatible gateway that sits between your app and the model providers — adding multi-provider routing, fallback, semantic caching, cost/budget caps, PII guardrails, audit logging and encrypted keys. Your prompts never leave your infrastructure.

- 🔌 **Drop-in OpenAI API** — point any OpenAI SDK at it, keep your code
- 🔀 **Multi-provider** — OpenAI, Anthropic, Google Gemini behind one API, with fallback + circuit breaker
- 🛡️ **Compliance-grade** — PII redaction, audit logs, budget caps, AES-256-GCM encrypted keys
- 🏠 **Self-hosted** — a single process / container, SQLite-backed, no external dependencies
- 📊 **Built-in admin UI** — add providers, set budgets, inspect logs at `/ui/`

MIT licensed · [GitHub](https://github.com/ReallyArtificial/freeport)

---

## Quickstart

Run the gateway with no install:

```bash
npx @reallyartificial/freeport
```

It starts on `http://localhost:4000`. Open the dashboard at **`http://localhost:4000/ui/`** and add your provider API keys (stored in a local SQLite database). No config file required to start.

Or install it globally:

```bash
npm i -g @reallyartificial/freeport
freeport
```

Or run with Docker:

```bash
git clone https://github.com/ReallyArtificial/freeport
cd freeport && docker compose up
```

## Use it

Point any OpenAI SDK at the gateway's `/v1` base URL:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:4000/v1",
    api_key="any-key",  # or your configured proxy key
)

resp = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello!"}],
)
```

```typescript
import OpenAI from 'openai';

const client = new OpenAI({ baseURL: 'http://localhost:4000/v1', apiKey: 'any-key' });
const resp = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

Streaming works identically — set `stream: true`. Requests are accepted in the OpenAI format; Anthropic and Google are supported as upstream providers (freeport translates for you).

## Configure providers

Three ways, in any combination:

**1. Admin UI** (easiest) — start the server, open `http://localhost:4000/ui/`, go to **Providers**, add your keys.

**2. Environment variables:**

```bash
FREEPORT_OPENAI_API_KEY=sk-xxx npx @reallyartificial/freeport
```

| Env var | Description |
|---------|-------------|
| `FREEPORT_OPENAI_API_KEY` / `FREEPORT_ANTHROPIC_API_KEY` / `FREEPORT_GOOGLE_API_KEY` | Provider keys |
| `FREEPORT_ADMIN_API_KEY` | Admin API auth key |
| `FREEPORT_API_KEY` | Proxy API auth key |
| `FREEPORT_PORT` / `FREEPORT_HOST` | Server port (default `4000`) / host |
| `FREEPORT_CONFIG` | Path to a YAML config file |
| `NODE_ENV=production` | Enforce required auth keys before boot |

**3. YAML config** — point `FREEPORT_CONFIG` at a file. Values support `${ENV_VAR}` interpolation (`${VAR:-default}`):

```yaml
providers:
  - name: openai
    type: openai
    keys:
      - key: "${OPENAI_API_KEY}"
  - name: anthropic
    type: anthropic
    keys:
      - key: "${ANTHROPIC_API_KEY}"

fallbackChains:
  - name: primary
    providers: [openai, anthropic]
    circuitBreaker: { failureThreshold: 3, resetTimeoutMs: 60000 }

cache: { enabled: true, similarityThreshold: 0.95, ttlSeconds: 3600 }
guardrails: { enabled: true, piiDetection: true, contentFilter: true }
rateLimit: { enabled: true, requestsPerMinute: 60 }
```

> For production, set `NODE_ENV=production` along with `FREEPORT_ADMIN_API_KEY` and `FREEPORT_API_KEY` to require authentication.

## Features

- **Multi-provider routing** — OpenAI, Anthropic, Google Gemini through one OpenAI-compatible API.
- **Fallback chains + circuit breaker** — automatic failover when a provider is down.
- **Semantic cache** — similar prompts return cached responses using local embeddings (all-MiniLM-L6-v2); no external calls.
- **Cost tracking & budgets** — per-project spend tracking with daily/monthly caps and a kill switch.
- **PII & content guardrails** — detect SSNs, cards, emails, phone numbers; filter content; cap tokens. Pluggable.
- **Audit logging** — every request/response logged with usage analytics and configurable retention.
- **Encrypted keys** — provider keys stored encrypted with AES-256-GCM.
- **Rate limiting** — token-bucket limiter with per-key limits.
- **Prompt versioning & A/B** — manage prompts externally; split traffic between variants.
- **Prometheus metrics** — counters and histograms for latency, cost and volume.
- **Load balancing** — round-robin across multiple keys per provider.

## API endpoints

**Proxy (OpenAI-compatible):** `POST /v1/chat/completions`, `POST /v1/completions`, `POST /v1/embeddings`, `GET /v1/models`

**Admin API:** `/api/providers`, `/api/prompts`, `/api/projects`, `/api/budgets/:projectId` (+ `/kill`), `/api/logs` (+ `/stats`), `/api/ab-tests`, `/api/system/status`, `GET /health`, `GET /metrics`

See the [full documentation on GitHub](https://github.com/ReallyArtificial/freeport).

## From source / contributing

```bash
git clone https://github.com/ReallyArtificial/freeport
cd freeport
npm install
npm run build:ui   # build the admin dashboard
npm run dev        # http://localhost:4000
```

Custom guardrails: drop a `.js` module exporting `checkInput(text)` / `checkOutput(text)` into a `plugins/` directory and reference it under `guardrails.customPlugins`.

## Tech stack

Node.js + TypeScript + Fastify v5 · SQLite (better-sqlite3) · Preact + Vite admin UI · single Docker container.

## License

MIT
