import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAICompatibleProvider } from '../src/providers/openai-compatible.js';
import { ProviderRegistry } from '../src/providers/registry.js';

describe('OpenAICompatibleProvider — buildHeaders auth styles', () => {
  it('bearer auth → Authorization: Bearer <key>', () => {
    const p = new OpenAICompatibleProvider({ name: 'groq', apiBase: 'https://api.groq.com/openai' });
    const h = p.buildHeaders('sk-abc');
    expect(h['Authorization']).toBe('Bearer sk-abc');
    expect(h['Content-Type']).toBe('application/json');
  });

  it('header auth → custom header (Azure api-key)', () => {
    const p = new OpenAICompatibleProvider({
      name: 'azure',
      apiBase: 'https://x.openai.azure.com',
      authStyle: 'header',
      authHeaderName: 'api-key',
    });
    const h = p.buildHeaders('azkey');
    expect(h['api-key']).toBe('azkey');
    expect(h['Authorization']).toBeUndefined();
  });

  it('query auth → no auth header', () => {
    const p = new OpenAICompatibleProvider({
      name: 'q',
      apiBase: 'https://example.com',
      authStyle: 'query',
      authQueryName: 'key',
    });
    const h = p.buildHeaders('qkey');
    expect(h['Authorization']).toBeUndefined();
    expect(h['api-key']).toBeUndefined();
  });

  it('none auth → no auth header (local Ollama/vLLM)', () => {
    const p = new OpenAICompatibleProvider({
      name: 'ollama',
      apiBase: 'http://localhost:11434',
      authStyle: 'none',
    });
    const h = p.buildHeaders('ignored');
    expect(h['Authorization']).toBeUndefined();
  });

  it('merges static headers (OpenRouter HTTP-Referer)', () => {
    const p = new OpenAICompatibleProvider({
      name: 'openrouter',
      apiBase: 'https://openrouter.ai/api',
      headers: { 'HTTP-Referer': 'https://freeport.dev', 'X-Title': 'Freeport' },
    });
    const h = p.buildHeaders('or-key');
    expect(h['HTTP-Referer']).toBe('https://freeport.dev');
    expect(h['X-Title']).toBe('Freeport');
    expect(h['Authorization']).toBe('Bearer or-key');
  });
});

describe('OpenAICompatibleProvider — identity transform', () => {
  it('transformRequest preserves tools and multimodal content byte-for-byte', () => {
    const p = new OpenAICompatibleProvider({ name: 'together', apiBase: 'https://api.together.xyz' });
    const req = {
      model: 'meta-llama/Llama-3-70b',
      messages: [
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: 'describe' },
            { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,AAAA' } },
          ],
        },
      ],
      tools: [
        { type: 'function' as const, function: { name: 'get_weather', parameters: { type: 'object' } } },
      ],
      tool_choice: 'auto' as const,
      response_format: { type: 'json_object' as const },
    };
    const out = p.transformRequest(req);
    expect(out).toBe(req); // identity — same reference
    expect(JSON.stringify(out)).toBe(JSON.stringify(req));
  });

  it('transformResponse passes provider body through', () => {
    const p = new OpenAICompatibleProvider({ name: 'deepseek', apiBase: 'https://api.deepseek.com' });
    const body = {
      id: 'x', object: 'chat.completion', created: 1, model: 'deepseek-chat',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    expect(p.transformResponse(body, 'deepseek-chat')).toEqual(body);
  });
});

describe('OpenAICompatibleProvider — URL building + paths (mocked fetch)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses default chatPath and bearer header', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        id: 'x', object: 'chat.completion', created: 1, model: 'm',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), { status: 200 }),
    );
    const p = new OpenAICompatibleProvider({ name: 'groq', apiBase: 'https://api.groq.com/openai' });
    await p.chatCompletion({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }, 'sk-1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init as RequestInit).headers as Record<string, string>).toMatchObject({ Authorization: 'Bearer sk-1' });
  });

  it('overrides chatPath and appends query auth', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        id: 'x', object: 'chat.completion', created: 1, model: 'm',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), { status: 200 }),
    );
    const p = new OpenAICompatibleProvider({
      name: 'azure',
      apiBase: 'https://x.openai.azure.com/openai/deployments/gpt4',
      authStyle: 'query',
      authQueryName: 'api-version-key',
      chatPath: '/chat/completions?api-version=2024-02-01',
    });
    await p.chatCompletion({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }, 'azkey');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://x.openai.azure.com/openai/deployments/gpt4/chat/completions?api-version=2024-02-01&api-version-key=azkey',
    );
  });

  it('listModels uses configured modelsPath', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }] }), { status: 200 }),
    );
    const p = new OpenAICompatibleProvider({
      name: 'custom',
      apiBase: 'https://api.example.com',
      modelsPath: '/v2/models',
    });
    const models = await p.listModels('k');
    expect(models).toEqual(['model-a', 'model-b']);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/v2/models');
  });
});

describe('Registry + admin acceptance of openai-compatible', () => {
  it('registry.register builds a usable openai-compatible provider', () => {
    const reg = new ProviderRegistry();
    reg.register({
      name: 'groq',
      type: 'openai-compatible',
      apiBase: 'https://api.groq.com/openai',
      keys: [{ key: 'k' }],
      models: ['llama-3.1-70b'],
    });
    const found = reg.findProviderForModel('llama-3.1-70b');
    expect(found?.provider).toBeInstanceOf(OpenAICompatibleProvider);
  });

  it('registry throws if openai-compatible lacks apiBase', () => {
    const reg = new ProviderRegistry();
    expect(() => reg.register({
      name: 'bad', type: 'openai-compatible', keys: [{ key: 'k' }],
    })).toThrow(/apiBase/);
  });
});
