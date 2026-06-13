# Migrate from LiteLLM to Freeport in 10 minutes

Freeport is an open-source, self-hosted LLM gateway that speaks the OpenAI API.
If you're already proxying through LiteLLM, the migration is mostly a base-URL swap
plus translating one YAML config. This guide is concrete and copy-pasteable, and it's
honest about where LiteLLM still wins.

---

## 1. Who should switch, and why

**Switch to Freeport if you want:**

- **Self-hosted control in one process.** A single Node service backed by SQLite
  (`better-sqlite3`) — no external Postgres/Redis to operate. Runs as one Docker
  container or one `npm` process.
- **Compliance-oriented features built in:**
  - **PII redaction guardrails** — built-in regex detectors for SSN, credit card,
    email, and phone. Input requests containing PII are *rejected* (fail-closed);
    PII in model output is detected and logged. (See the gotcha in section 5 about
    exactly how input vs. output behave.)
  - **Audit logs** — every proxied request is persisted to SQLite (model, provider,
    token counts, cost, latency, cache/fallback flags, and the request/response
    bodies). Queryable via `GET /api/logs` and `GET /api/logs/stats`.
  - **Budget caps + kill switch** — per-project spend tracking with hard enforcement
    (reject over budget) or warn-only mode, plus an emergency kill switch.
  - **Encrypted provider keys** — keys added through the admin UI are stored in
    SQLite encrypted with AES-256-GCM. The master key comes from
    `FREEPORT_ENCRYPTION_KEY` or an auto-generated `data/.encryption-key` file
    (mode `0600`), and can be rotated.
- **OpenAI-compatible drop-in.** `/v1/chat/completions`, `/v1/completions`,
  `/v1/embeddings`, `/v1/models`. Streaming supported.

**Stay on (or keep) LiteLLM if you need:**

- **Breadth of providers/models.** LiteLLM supports 2,600+ models across a very
  long list of providers. **Freeport supports three provider types today: OpenAI,
  Anthropic, and Google Gemini.** If you route to Bedrock, Azure OpenAI, Cohere,
  Mistral, Together, Ollama, etc., Freeport does not cover those yet — this is the
  single biggest reason not to migrate.
- A mature Python SDK / `litellm` library embedded directly in your app (Freeport
  is a gateway you call over HTTP, not an in-process library).

If your traffic is OpenAI + Anthropic + Gemini and you care about self-hosted
compliance controls, Freeport is a clean fit. Otherwise, weigh the provider gap first.

---

## 2. Concept mapping: LiteLLM config → Freeport config

Freeport's YAML is intentionally close to LiteLLM's `config.yaml`. Side by side:

| Concept | LiteLLM (`config.yaml`) | Freeport (`config/freeport.yaml`) |
|---|---|---|
| Provider/model declaration | `model_list[].litellm_params` | `providers[]` with `type` + `keys` + `models` |
| API key | `api_key: os.environ/OPENAI_API_KEY` | `keys: [{ key: "${OPENAI_API_KEY}" }]` |
| Custom base URL | `api_base` | `apiBase` (per provider) |
| Multiple keys / load balancing | duplicate `model_name` entries | multiple objects under one provider's `keys` (round-robin) |
| Fallbacks | `litellm_settings.fallbacks` / `router_settings` | `fallbackChains[]` with `circuitBreaker` |
| Budgets | `max_budget` / key+team budgets | `budget` config + `/api/projects` + `/api/budgets/:projectId` |
| Rate limiting | `rpm` / `tpm` | `rateLimit.requestsPerMinute` / `tokensPerMinute` |
| Guardrails / PII | `guardrails` config | `guardrails.piiDetection` / `contentFilter` / `maxTokens` |
| Caching | `cache` (often Redis) | `cache` (local embeddings or SHA-256 fallback, no Redis) |
| Request logging / spend | callbacks (Langfuse, etc.) | built-in SQLite logs via `/api/logs` |
| Virtual/proxy API key | master key + virtual keys | `auth.apiKey` (proxy) + `auth.adminApiKey` (admin) |

**A typical LiteLLM block:**

```yaml
model_list:
  - model_name: gpt-4o-mini
    litellm_params:
      model: openai/gpt-4o-mini
      api_key: os.environ/OPENAI_API_KEY
  - model_name: claude-sonnet
    litellm_params:
      model: anthropic/claude-sonnet-4-5-20250929
      api_key: os.environ/ANTHROPIC_API_KEY

litellm_settings:
  fallbacks: [{ "gpt-4o-mini": ["claude-sonnet"] }]
```

**The Freeport equivalent:**

```yaml
server:
  host: "0.0.0.0"
  port: 4000

providers:
  - name: openai
    type: openai
    keys:
      - key: "${OPENAI_API_KEY}"
    models:
      - gpt-4o
      - gpt-4o-mini
  - name: anthropic
    type: anthropic
    keys:
      - key: "${ANTHROPIC_API_KEY}"
    models:
      - claude-sonnet-4-5-20250929
      - claude-3-5-haiku-20241022

fallbackChains:
  - name: primary
    providers: [openai, anthropic]
    circuitBreaker:
      failureThreshold: 3
      resetTimeoutMs: 60000
```

Note the difference in model naming: LiteLLM uses a `provider/model` prefix
(`openai/gpt-4o-mini`). Freeport uses the **raw provider model id** (`gpt-4o-mini`)
and routes it by the `models` list, falling back to a prefix heuristic
(`gpt-`/`o1`/`o3`/`o4` → OpenAI, `claude-` → Anthropic, `gemini-` → Google).

---

## 3. Step by step

### 3a. Install

**Docker (recommended for a server).** Freeport ships a Dockerfile + compose file
(it builds locally — there is no prebuilt public image):

```bash
git clone <your-freeport-repo> freeport && cd freeport
OPENAI_API_KEY=sk-xxx \
ANTHROPIC_API_KEY=sk-ant-xxx \
docker-compose up
```

This builds the image, mounts `./data`, `./config`, and `./plugins`, and starts the
gateway on `http://localhost:4000` (admin UI at `/ui/`).

**npm (recommended for local dev).** Requires Node 20+ (the project targets Node 22):

```bash
npm install
npm run build:ui          # compiles the Preact admin dashboard
FREEPORT_OPENAI_API_KEY=sk-xxx npm run dev   # http://localhost:4000
```

You don't strictly need any config file or env var to boot — you can add provider
keys interactively at `http://localhost:4000/ui/` → **Providers** (they're stored
encrypted in SQLite). For a config-as-code migration, use the YAML in step 3c.

### 3b. Point your OpenAI base_url at Freeport

This is the only application change. Replace your LiteLLM endpoint with Freeport's
`/v1`:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:4000/v1",   # was your LiteLLM URL
    api_key="any-key",                       # or your configured proxy key
)

resp = client.chat.completions.create(
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
```

In dev, any `api_key` value is accepted. In production you set `auth.apiKey` and send
it as the bearer token, exactly like a LiteLLM virtual key.

### 3c. Configure providers, routing, and fallback

Create the config file (Freeport checks `FREEPORT_CONFIG`, then `config/freeport.yaml`,
`config/freeport.yml`, `freeport.yaml`):

```bash
cp config/freeport.example.yaml config/freeport.yaml
```

Use the Freeport YAML from section 2. The `${ENV_VAR}` interpolation supports
defaults via `${VAR:-fallback}`. A provider whose referenced env var is unset is
simply skipped in dev — so set the keys in your shell or a `.env`.

Routing rules:
- A request's `model` is matched against each provider's `models` list first.
- If no list matches, the prefix heuristic applies.
- `fallbackChains` are tried in order with a circuit breaker; load balancing across
  multiple `keys` in a provider is round-robin.

### 3d. Enable budget caps

Budgets are tied to **projects**. Create a project, attach a budget, and pass the
project id on requests (or bind it to a proxy key).

```bash
# Create a project
curl -X POST http://localhost:4000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "my-app", "budgetLimit": 50}'

# Set monthly / daily caps for that project
curl -X POST http://localhost:4000/api/budgets/<projectId> \
  -H "Content-Type: application/json" \
  -d '{"monthlyLimit": 100, "dailyLimit": 10}'
```

Set enforcement mode in YAML (`hard` rejects over-budget requests, `warn` only logs):

```yaml
budget:
  defaultProjectBudget: 100
  currency: USD
  enforcementMode: hard
```

Attribute a request to a project via the `freeport` metadata block (Freeport ignores
this field on its way to the upstream provider):

```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hi"}],
    "freeport": {"project_id": "<projectId>"}
  }'
```

Emergency stop for a project:

```bash
curl -X POST http://localhost:4000/api/budgets/<projectId>/kill \
  -d '{"killed": true}'
```

### 3e. Enable PII guardrails

```yaml
guardrails:
  enabled: true
  piiDetection: true
  contentFilter: true
  # maxTokens: 128000        # optional hard input token cap
  # customPlugins:           # optional, see README plugin format
  #   - my-guardrail.js
```

With `piiDetection: true`, the built-in detector covers SSN, credit card, email, and
phone. **Behavior matters (read section 5):** input PII causes the request to be
*rejected* with a `GUARDRAIL_VIOLATION` (HTTP 400); output PII is detected and logged.

### 3f. Audit log is already on

Request logging is enabled by default (`logging.requestLogging: true`). Every proxied
call is written to SQLite. Query it:

```bash
curl http://localhost:4000/api/logs          # recent requests
curl http://localhost:4000/api/logs/stats    # spend + usage analytics
```

Logs include provider, model, token counts, cost, latency, and cache/fallback flags.

---

## 4. Verify the migration with one curl

Health, models, then a real proxied chat completion:

```bash
# 1. Gateway up?
curl http://localhost:4000/health
# -> {"status":"ok","timestamp":"...","version":"0.1.0"}

# 2. Models visible?
curl http://localhost:4000/v1/models

# 3. Proxy a real completion through Freeport to your upstream provider
curl http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Say hello in one word."}]
  }'
```

A successful response returns a standard OpenAI `chat.completion` object and an
`X-Cache: MISS` header. Confirm it was recorded:

```bash
curl http://localhost:4000/api/logs | head
```

To prove the PII guardrail (with `guardrails.enabled: true`):

```bash
curl -i http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"my ssn is 123-45-6789"}]}'
# -> HTTP 400, error.type "GUARDRAIL_VIOLATION"
```

---

## 5. Gotchas

- **Provider coverage is the dealbreaker check.** Freeport handles `openai`,
  `anthropic`, `google` only. There is no Azure/Bedrock/Cohere/Mistral/Ollama path.
  Confirm every model you route today maps to one of these three before cutting over.
- **Model names drop the provider prefix.** Use `gpt-4o-mini`, not
  `openai/gpt-4o-mini`. Either list models explicitly under each provider's `models`
  (most reliable) or rely on the prefix heuristic.
- **Input PII fails closed; output PII does not rewrite the response.** On *input*,
  detected PII rejects the request (400) rather than silently redacting it — so if you
  expected LiteLLM-style masking that still calls the model, behavior differs. On
  *output*, PII is detected and a redaction is computed and logged, but the current
  pipeline does not substitute the redacted text back into the response body. Treat
  output PII handling as detection/audit, not guaranteed masking.
- **Guardrails, cache, rate limiting, and A/B testing are off by default.** Only
  request logging and (in the example) rate limiting are enabled out of the box. Flip
  `enabled: true` per feature.
- **Semantic cache has a fallback.** If `@huggingface/transformers` / the local
  embedding model can't load, the cache silently degrades to exact-match SHA-256
  hashing. That's non-fatal but means "similar prompt" hits won't happen until the
  model is installed (`npm install @huggingface/transformers`).
- **Production requires auth + a stable encryption key.** In production
  (`npm start -- --production`) `auth.adminApiKey` and `auth.apiKey` are required.
  Set `FREEPORT_ENCRYPTION_KEY` (64-char hex) explicitly and back up
  `data/.encryption-key` — if you lose the master key, encrypted provider keys in
  SQLite are unrecoverable.
- **One writer per SQLite file.** WAL mode with a 5s busy timeout. Keep the DB on a
  local filesystem (not NFS) and don't point two server processes at the same file.
- **No prebuilt Docker image.** `docker-compose up` builds locally from the included
  Dockerfile (Node 22 base). Persist `./data` (the volume mount already does this) so
  logs, projects, budgets, and encrypted keys survive restarts.
- **`freeport` metadata is the routing/attribution channel.** Fields like
  `project_id`, `prompt`, `variables`, `ab_test`, and `cache` go inside a top-level
  `freeport` (or `metadata`) object on the request and are stripped before the
  upstream call.
