# Freeport

**Open-source LLM Gateway** — self-hosted, single Docker container.

Prompt management, model fallback, semantic caching, cost tracking, guardrails, A/B testing, and an admin UI. Drop-in replacement for the OpenAI API — works with any OpenAI SDK.

## Quick Start

```bash
npm install
npm run build:ui   # build the admin dashboard
npm run dev        # starts on http://localhost:4000
```

Open `http://localhost:4000/ui/` and add your API keys through the Providers page. No environment variables or config files required to get started.

Alternatively, run with Docker:

```bash
docker-compose up
```

The gateway starts on `http://localhost:4000`. Admin UI at `http://localhost:4000/ui/`.

## Usage

Point your OpenAI SDK at Freeport:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:4000/v1",
    api_key="any-key",  # or your configured API key
)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello!"}],
)
```

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:4000/v1',
  apiKey: 'any-key',
});

const response = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

Streaming works identically — set `stream: true`.

## Features

### Multi-Provider Support
Route requests to OpenAI, Anthropic, and Google Gemini through a unified OpenAI-compatible API.

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
```

### Fallback Chains + Circuit Breaker
Automatic failover across providers. If OpenAI is down, fall back to Anthropic.

```yaml
fallbackChains:
  - name: primary
    providers: [openai, anthropic, google]
    circuitBreaker:
      failureThreshold: 3
      resetTimeoutMs: 60000
```

### Prompt Management
Version prompts externally. Update them without redeploying your app.

```bash
# Create a prompt
curl -X POST http://localhost:4000/api/prompts \
  -H "Content-Type: application/json" \
  -d '{"slug": "summarize", "name": "Summarizer"}'

# Add a version and publish it
curl -X POST http://localhost:4000/api/prompts/{id}/versions \
  -H "Content-Type: application/json" \
  -d '{"content": "Summarize this: {{text}}", "tag": "published"}'

# Use it in requests (via freeport metadata)
curl -X POST http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "placeholder"}],
    "freeport": {"prompt": "summarize", "variables": {"text": "..."}}
  }'
```

### Semantic Caching
Similar prompts return cached responses. Uses local embeddings (all-MiniLM-L6-v2) — no external API calls.

```yaml
cache:
  enabled: true
  similarityThreshold: 0.95
  ttlSeconds: 3600
```

### Spend Tracking & Budgets
Per-project cost tracking with hard budget caps and kill switches.

```bash
# Create a project with a budget
curl -X POST http://localhost:4000/api/projects \
  -d '{"name": "my-app", "budgetLimit": 50}'

# Set budget limits
curl -X POST http://localhost:4000/api/budgets/{projectId} \
  -d '{"monthlyLimit": 100, "dailyLimit": 10}'

# Emergency kill switch
curl -X POST http://localhost:4000/api/budgets/{projectId}/kill \
  -d '{"killed": true}'
```

### Input/Output Guardrails
PII detection (SSN, credit card, email, phone), content filtering, token limits. Plugin architecture for custom guardrails.

```yaml
guardrails:
  enabled: true
  piiDetection: true
  contentFilter: true
  maxTokens: 128000
  customPlugins:
    - my-custom-guardrail.js
```

### A/B Testing
Split traffic between prompt variants and track metrics.

### Rate Limiting
Token bucket rate limiter with per-key limits.

```yaml
rateLimit:
  enabled: true
  requestsPerMinute: 60
```

### Load Balancing
Round-robin across multiple API keys per provider.

```yaml
providers:
  - name: openai
    type: openai
    keys:
      - key: "${OPENAI_KEY_1}"
      - key: "${OPENAI_KEY_2}"
      - key: "${OPENAI_KEY_3}"
```

## API Endpoints

### Proxy (OpenAI-compatible)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/chat/completions` | Chat completion (streaming supported) |
| POST | `/v1/completions` | Legacy completion |
| POST | `/v1/embeddings` | Embedding passthrough |
| GET | `/v1/models` | List available models |

### Admin API
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/providers` | List/create LLM providers |
| PUT/DELETE | `/api/providers/:id` | Update/delete provider |
| GET/POST | `/api/prompts` | List/create prompts |
| GET/PUT/DELETE | `/api/prompts/:id` | Get/update/delete prompt |
| POST | `/api/prompts/:id/versions` | Create prompt version |
| POST | `/api/prompts/resolve` | Resolve prompt with variables |
| GET/POST | `/api/projects` | List/create projects |
| GET/POST | `/api/budgets/:projectId` | Get/set budget |
| POST | `/api/budgets/:projectId/kill` | Kill switch |
| GET | `/api/logs` | Query request logs |
| GET | `/api/logs/stats` | Usage analytics |
| GET/POST | `/api/ab-tests` | List/create A/B tests |
| GET | `/api/system/status` | System status |
| POST | `/api/system/cache/clear` | Clear cache |
| GET | `/health` | Health check |

## Configuration

Providers can be configured in three ways (any combination works):

### Option 1: Admin UI (recommended for local dev)

Start the server and open `http://localhost:4000/ui/`. Go to **Providers** and add your API keys. They are stored in the local SQLite database and persist across restarts.

### Option 2: Environment Variables

```bash
FREEPORT_OPENAI_API_KEY=sk-xxx npm run dev
```

| Env Var | Description |
|---------|-------------|
| `FREEPORT_OPENAI_API_KEY` | OpenAI API key |
| `FREEPORT_ANTHROPIC_API_KEY` | Anthropic API key |
| `FREEPORT_GOOGLE_API_KEY` | Google API key |
| `FREEPORT_ADMIN_API_KEY` | Admin API authentication key |
| `FREEPORT_API_KEY` | Proxy API authentication key |
| `FREEPORT_PORT` | Server port (default: 4000) |
| `FREEPORT_HOST` | Server host (default: 0.0.0.0) |
| `FREEPORT_CONFIG` | Path to config file |

### Option 3: YAML Config File

```bash
cp config/freeport.example.yaml config/freeport.yaml
# Edit with your API keys, then:
npm run dev
```

YAML values support `${ENV_VAR}` interpolation with `${VAR:-default}` syntax.

## Architecture

```
Client (OpenAI SDK) --> Freeport (Fastify)
                          |
                    Pre-Processing:
                      Auth -> Rate Limit -> Budget Check ->
                      Prompt Resolution -> Input Guardrails ->
                      Semantic Cache Lookup
                          |
                    Routing:
                      A/B Router -> Fallback Chain -> Load Balancer
                          |
                    LLM Provider (OpenAI / Anthropic / Google)
                          |
                    Post-Processing:
                      Output Guardrails -> Cost Tracking ->
                      Budget Update -> Cache Store -> Log
                          |
Client <-------------- Response
```

## Tech Stack

- **Runtime**: Node.js + TypeScript + Fastify v5
- **Database**: SQLite (better-sqlite3) — zero external dependencies
- **Embeddings**: Local all-MiniLM-L6-v2 (optional, for semantic cache)
- **Admin UI**: Preact + Vite
- **Deployment**: Single Docker container

## Custom Guardrail Plugins

Create a `.js` file in the `plugins/` directory:

```javascript
export default {
  name: 'my-guardrail',
  checkInput(text) {
    // Return { passed: true/false, guardrail: 'name', message: '...' }
    if (text.includes('forbidden')) {
      return { passed: false, guardrail: 'my-guardrail', message: 'Forbidden content' };
    }
    return { passed: true, guardrail: 'my-guardrail' };
  },
  checkOutput(text) {
    return { passed: true, guardrail: 'my-guardrail' };
  },
};
```

## License

MIT
