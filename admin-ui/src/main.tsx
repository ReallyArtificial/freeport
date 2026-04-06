import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { api } from './api';

// ---- Styles ----
const styles = `
  /* Layout */
  .layout { display: flex; min-height: 100vh; }

  .sidebar {
    width: 200px; background: var(--surface); border-right: 1px solid var(--border);
    padding: 0; flex-shrink: 0; position: fixed; top: 0; bottom: 0; overflow-y: auto;
    display: flex; flex-direction: column;
  }
  .sidebar-brand {
    padding: 20px 20px 16px; font-size: 15px; font-weight: 600; letter-spacing: -0.3px;
    color: var(--text); border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 8px;
  }
  .sidebar-brand .dot {
    width: 8px; height: 8px; border-radius: 50%; background: var(--success);
    display: inline-block; flex-shrink: 0;
  }
  .sidebar-nav { padding: 8px; flex: 1; }

  .nav-item {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 12px; color: var(--text-secondary); cursor: pointer;
    border: none; background: none; width: 100%; text-align: left; font-size: 13px;
    font-family: var(--font); border-radius: 6px; transition: all 0.1s; font-weight: 400;
  }
  .nav-item:hover { color: var(--text); background: var(--surface2); }
  .nav-item.active { color: var(--text); background: var(--surface2); font-weight: 500; }
  .nav-icon { font-size: 15px; width: 20px; text-align: center; opacity: 0.7; }
  .nav-item.active .nav-icon { opacity: 1; }

  .sidebar-footer {
    padding: 12px 20px; border-top: 1px solid var(--border);
    font-size: 11px; color: var(--text-tertiary);
  }

  .main { margin-left: 200px; flex: 1; padding: 32px 40px; max-width: 1100px; }

  .page-header {
    margin-bottom: 32px; display: flex; align-items: center; justify-content: space-between;
  }
  .page-title {
    font-size: 20px; font-weight: 600; letter-spacing: -0.4px; color: var(--text);
  }
  .page-desc { font-size: 13px; color: var(--text-secondary); margin-top: 4px; font-weight: 400; }

  /* Cards */
  .card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    padding: 20px; margin-bottom: 16px;
  }
  .card-title {
    font-size: 12px; color: var(--text-tertiary); text-transform: uppercase;
    letter-spacing: 0.6px; margin-bottom: 16px; font-weight: 500;
  }

  /* Stats */
  .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .stat-card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    padding: 16px 20px;
  }
  .stat-label {
    font-size: 12px; color: var(--text-tertiary); margin-bottom: 8px;
    font-weight: 500; letter-spacing: 0.3px;
  }
  .stat-value { font-size: 24px; font-weight: 600; letter-spacing: -0.5px; color: var(--text); }
  .stat-value.accent { color: var(--accent); }
  .stat-value.success { color: var(--success); }
  .stat-value.warning { color: var(--warning); }

  /* Tables */
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th {
    text-align: left; padding: 10px 16px; color: var(--text-tertiary);
    border-bottom: 1px solid var(--border); font-weight: 500; font-size: 12px;
    letter-spacing: 0.3px;
  }
  td { padding: 10px 16px; border-bottom: 1px solid var(--border); color: var(--text-secondary); }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: var(--surface2); }

  /* Buttons */
  .btn {
    padding: 8px 14px; border-radius: 6px; border: 1px solid var(--border);
    background: var(--surface); color: var(--text); cursor: pointer; font-size: 13px;
    font-family: var(--font); transition: all 0.15s; font-weight: 500;
  }
  .btn:hover { border-color: var(--text); }
  .btn-primary {
    background: var(--primary); border-color: var(--primary); color: white;
  }
  .btn-primary:hover { background: var(--primary-hover); border-color: var(--primary-hover); }
  .btn-danger { background: white; border-color: var(--danger); color: var(--danger); }
  .btn-danger:hover { background: var(--danger); color: white; }
  .btn-sm { padding: 5px 10px; font-size: 12px; }
  .btn-group { display: flex; gap: 8px; }

  /* Badges */
  .badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 8px; border-radius: 100px; font-size: 11px;
    font-weight: 500; letter-spacing: 0.2px;
  }
  .badge-green { background: var(--success-light); color: #0a7c42; }
  .badge-yellow { background: var(--warning-light); color: #915e0d; }
  .badge-red { background: var(--danger-light); color: #c00; }
  .badge-blue { background: var(--accent-light); color: #0060d0; }
  .badge-gray { background: var(--surface2); color: var(--text-tertiary); border: 1px solid var(--border); }

  .badge-dot {
    width: 6px; height: 6px; border-radius: 50%; display: inline-block;
  }
  .badge-green .badge-dot { background: #0cce6b; }
  .badge-yellow .badge-dot { background: #f5a623; }
  .badge-red .badge-dot { background: #e00; }

  /* Forms */
  .input {
    padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border);
    background: var(--surface); color: var(--text); font-size: 13px; font-family: var(--font);
    width: 100%; transition: border-color 0.15s;
  }
  .input:focus { outline: none; border-color: var(--text); }
  .input::placeholder { color: var(--text-tertiary); }
  textarea.input { min-height: 120px; resize: vertical; font-family: var(--mono); font-size: 12px; }
  select.input { cursor: pointer; appearance: auto; }
  .form-group { margin-bottom: 16px; }
  .form-label { display: block; font-size: 13px; color: var(--text); margin-bottom: 6px; font-weight: 500; }

  /* Modal */
  .modal-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center;
    z-index: 100; backdrop-filter: blur(2px);
  }
  .modal {
    background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
    padding: 28px; min-width: 440px; max-width: 560px; box-shadow: 0 16px 70px rgba(0,0,0,0.15);
  }
  .modal-title { font-size: 16px; font-weight: 600; margin-bottom: 20px; letter-spacing: -0.3px; }

  /* Utils */
  .empty { text-align: center; padding: 48px 24px; color: var(--text-tertiary); font-size: 13px; }
  .mono { font-family: var(--mono); font-size: 12px; }
  .truncate { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .flex { display: flex; align-items: center; gap: 8px; }
  .flex-between { display: flex; align-items: center; justify-content: space-between; }
  .mt-2 { margin-top: 8px; }
  .mt-4 { margin-top: 16px; }
  .mb-4 { margin-bottom: 16px; }

  /* Status bar */
  .status-bar {
    display: flex; align-items: center; gap: 20px; padding: 12px 20px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    font-size: 13px; color: var(--text-secondary);
  }
  .status-item { display: flex; align-items: center; gap: 6px; }
  .status-dot {
    width: 7px; height: 7px; border-radius: 50%;
  }
  .status-dot.green { background: var(--success); }
  .status-dot.gray { background: var(--text-tertiary); }

  /* Section divider */
  .section { margin-bottom: 28px; }
  .section-title {
    font-size: 13px; font-weight: 500; color: var(--text); margin-bottom: 12px;
    letter-spacing: -0.2px;
  }

  /* Empty state */
  .empty-state {
    text-align: center; padding: 60px 24px; color: var(--text-tertiary);
  }
  .empty-state-icon { font-size: 32px; margin-bottom: 12px; opacity: 0.4; }
  .empty-state-title { font-size: 14px; font-weight: 500; color: var(--text-secondary); margin-bottom: 4px; }
  .empty-state-desc { font-size: 13px; }

  /* Key-value grid */
  .kv-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 0;
    border: 1px solid var(--border); border-radius: 8px; overflow: hidden;
  }
  .kv-item {
    padding: 12px 16px; border-bottom: 1px solid var(--border);
    font-size: 13px;
  }
  .kv-item:nth-last-child(-n+2) { border-bottom: none; }
  .kv-item:nth-child(odd) { border-right: 1px solid var(--border); }
  .kv-label { color: var(--text-tertiary); font-size: 12px; margin-bottom: 2px; }
  .kv-value { color: var(--text); font-weight: 500; }

  /* Setup banner */
  .setup-banner {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border: 1px solid #2a3a5e; border-radius: 12px;
    padding: 32px; margin-bottom: 24px; color: #e0e0e0;
  }
  .setup-banner-title {
    font-size: 18px; font-weight: 600; color: #fff; margin-bottom: 8px;
    letter-spacing: -0.3px;
  }
  .setup-banner-desc { font-size: 13px; color: #a0aec0; margin-bottom: 20px; line-height: 1.5; }
  .setup-banner .btn-primary { background: #4f6ef7; border-color: #4f6ef7; }
  .setup-banner .btn-primary:hover { background: #3b5de7; border-color: #3b5de7; }

  /* Provider type badges */
  .provider-type {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 10px; border-radius: 100px; font-size: 11px;
    font-weight: 600; letter-spacing: 0.3px; text-transform: uppercase;
  }
  .provider-type.openai { background: #e8f5e9; color: #2e7d32; }
  .provider-type.anthropic { background: #fce4ec; color: #c62828; }
  .provider-type.google { background: #e3f2fd; color: #1565c0; }

  .key-mask { font-family: var(--mono); font-size: 12px; color: var(--text-tertiary); }
`;

// ---- Default models per provider type ----
const DEFAULT_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic: ['claude-sonnet-4-5-20250929', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
  google: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
};

// ---- Nav icons (simple text-based) ----
const icons: Record<string, string> = {
  dashboard: '\u25A0',
  providers: '\u26A1',
  logs: '\u2261',
  prompts: '\u270E',
  budgets: '\u0024',
  'ab-tests': '\u2194',
  settings: '\u2699',
};

// ---- Components ----

function Dashboard({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const [stats, setStats] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.getLogStats(), api.systemStatus()])
      .then(([s, st]) => { setStats(s); setStatus(st); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div class="empty">Loading...</div>;

  return (
    <div>
      {status?.needsSetup && (
        <div class="setup-banner">
          <div class="setup-banner-title">Welcome to Freeport</div>
          <div class="setup-banner-desc">
            No LLM providers configured yet. Add your API keys to start proxying requests
            to OpenAI, Anthropic, or Google.
          </div>
          <button class="btn btn-primary" onClick={() => onNavigate?.('providers')}>
            Set Up Providers
          </button>
        </div>
      )}

      <div class="page-header">
        <div>
          <h2 class="page-title">Overview</h2>
          <p class="page-desc">Gateway metrics and system health</p>
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Requests</div>
          <div class="stat-value">{stats?.totalRequests?.toLocaleString() ?? '0'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Spend</div>
          <div class="stat-value accent">${stats?.totalCost?.toFixed(2) ?? '0.00'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Cache Hit Rate</div>
          <div class="stat-value success">{((stats?.cacheHitRate ?? 0) * 100).toFixed(1)}%</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Avg Latency</div>
          <div class="stat-value">{stats?.avgLatencyMs ?? 0}<span style="font-size:14px;font-weight:400;color:var(--text-tertiary)">ms</span></div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Model Usage</div>
        {stats?.modelBreakdown?.length > 0 ? (
          <div class="card" style="padding:0; overflow:hidden">
            <table>
              <thead><tr><th>Model</th><th>Requests</th><th>Cost</th></tr></thead>
              <tbody>
                {stats.modelBreakdown.map((m: any) => (
                  <tr key={m.model}>
                    <td><span class="mono" style="color:var(--text)">{m.model}</span></td>
                    <td>{m.count}</td>
                    <td>${m.cost?.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div class="card">
            <div class="empty-state">
              <div class="empty-state-icon">{'\u2014'}</div>
              <div class="empty-state-title">No traffic yet</div>
              <div class="empty-state-desc">Send a request to /v1/chat/completions to get started</div>
            </div>
          </div>
        )}
      </div>

      <div class="section">
        <div class="section-title">System</div>
        <div class="status-bar">
          <div class="status-item">
            <span class="status-dot green"></span>
            Healthy
          </div>
          <div class="status-item" style="color:var(--text-tertiary)">v{status?.version}</div>
          <div class="status-item" style="color:var(--text-tertiary)">
            {status?.providers?.length ?? 0} provider{(status?.providers?.length ?? 0) !== 1 ? 's' : ''}
            {status?.providers?.length > 0 && <span style="margin-left:4px" class="mono">({status.providers.join(', ')})</span>}
          </div>
          <div class="status-item" style="color:var(--text-tertiary)">
            {status?.cacheEntries ?? 0} cached
          </div>
        </div>
      </div>
    </div>
  );
}

function Providers() {
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '', type: 'openai', apiBase: '', apiKey: '', models: '', enabled: true,
  });

  const load = () => {
    api.listProviders()
      .then(setProviders)
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const resetForm = () => setForm({
    name: '', type: 'openai', apiBase: '', apiKey: '', models: '', enabled: true,
  });

  const prefillName = (type: string) => {
    setForm(f => ({
      ...f,
      type,
      name: f.name || type,
      models: DEFAULT_MODELS[type]?.join(', ') ?? '',
    }));
  };

  const create = () => {
    setError('');
    const models = form.models
      ? form.models.split(',').map((s: string) => s.trim()).filter(Boolean)
      : undefined;
    api.createProvider({
      name: form.name,
      type: form.type,
      apiBase: form.apiBase || undefined,
      apiKey: form.apiKey,
      models,
      enabled: form.enabled,
    }).then(() => {
      setShowCreate(false);
      resetForm();
      load();
    }).catch((err: any) => setError(err.message));
  };

  const remove = (id: string, name: string) => {
    if (!confirm(`Remove provider "${name}"?`)) return;
    api.deleteProvider(id).then(load);
  };

  const toggle = (p: any) => {
    api.updateProvider(p.id, { enabled: !p.enabled }).then(load);
  };

  return (
    <div>
      <div class="page-header">
        <div>
          <h2 class="page-title">Providers</h2>
          <p class="page-desc">Configure LLM provider API keys</p>
        </div>
        <button class="btn btn-primary" onClick={() => setShowCreate(true)}>Add Provider</button>
      </div>

      {providers.length === 0 && !loading ? (
        <div class="setup-banner">
          <div class="setup-banner-title">Add your first provider</div>
          <div class="setup-banner-desc">
            Freeport acts as an LLM gateway. You need at least one provider to proxy requests.
            Click below to add your OpenAI, Anthropic, or Google API key.
          </div>
          <div class="btn-group">
            <button class="btn btn-primary" onClick={() => { resetForm(); prefillName('openai'); setShowCreate(true); }}>
              Add OpenAI
            </button>
            <button class="btn" style="border-color:#a0aec0;color:#fff" onClick={() => { resetForm(); prefillName('anthropic'); setShowCreate(true); }}>
              Add Anthropic
            </button>
            <button class="btn" style="border-color:#a0aec0;color:#fff" onClick={() => { resetForm(); prefillName('google'); setShowCreate(true); }}>
              Add Google
            </button>
          </div>
        </div>
      ) : loading ? (
        <div class="empty">Loading...</div>
      ) : (
        <div class="card" style="padding:0; overflow:hidden">
          <table>
            <thead>
              <tr><th>Provider</th><th>Type</th><th>API Key</th><th>Models</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {providers.map((p: any) => (
                <tr key={p.id}>
                  <td style="color:var(--text); font-weight:500">{p.name}</td>
                  <td><span class={`provider-type ${p.type}`}>{p.type}</span></td>
                  <td><span class="key-mask">{p.api_key}</span></td>
                  <td style="max-width:200px">
                    <span class="mono" style="font-size:11px; color:var(--text-secondary)">
                      {p.models ? JSON.parse(p.models).join(', ') : 'default'}
                    </span>
                  </td>
                  <td>
                    <span class={`badge ${p.enabled ? 'badge-green' : 'badge-gray'}`} style="cursor:pointer" onClick={() => toggle(p)}>
                      <span class="badge-dot" /> {p.enabled ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td style="text-align:right">
                    <button class="btn btn-danger btn-sm" onClick={() => remove(p.id, p.name)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div class="modal-overlay" onClick={() => { setShowCreate(false); setError(''); }}>
          <div class="modal" onClick={(e: any) => e.stopPropagation()}>
            <div class="modal-title">Add Provider</div>
            {error && <div style="color:var(--danger); font-size:13px; margin-bottom:12px">{error}</div>}
            <div class="form-group">
              <label class="form-label">Type</label>
              <select class="input" value={form.type} onChange={(e: any) => { prefillName(e.target.value); }}>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="google">Google</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Name</label>
              <input class="input" value={form.name} onInput={(e: any) => setForm({ ...form, name: e.target.value })} placeholder="e.g. openai" />
            </div>
            <div class="form-group">
              <label class="form-label">API Key</label>
              <input class="input" type="password" value={form.apiKey} onInput={(e: any) => setForm({ ...form, apiKey: e.target.value })} placeholder="sk-..." />
            </div>
            <div class="form-group">
              <label class="form-label">API Base URL <span style="color:var(--text-tertiary)">(optional)</span></label>
              <input class="input" value={form.apiBase} onInput={(e: any) => setForm({ ...form, apiBase: e.target.value })} placeholder="Leave blank for default" />
            </div>
            <div class="form-group">
              <label class="form-label">Models <span style="color:var(--text-tertiary)">(comma-separated)</span></label>
              <input class="input" value={form.models} onInput={(e: any) => setForm({ ...form, models: e.target.value })} placeholder="gpt-4o, gpt-4o-mini" />
            </div>
            <div class="btn-group mt-4" style="justify-content:flex-end">
              <button class="btn" onClick={() => { setShowCreate(false); setError(''); }}>Cancel</button>
              <button class="btn btn-primary" onClick={create} disabled={!form.name || !form.apiKey}>Add Provider</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Logs() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getLogs({ limit: '100' })
      .then(setLogs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div class="page-header">
        <div>
          <h2 class="page-title">Request Logs</h2>
          <p class="page-desc">Recent requests through the gateway</p>
        </div>
      </div>

      {loading ? <div class="empty">Loading...</div> : logs.length === 0 ? (
        <div class="card">
          <div class="empty-state">
            <div class="empty-state-icon">{'\u2261'}</div>
            <div class="empty-state-title">No requests logged</div>
            <div class="empty-state-desc">Proxy a request through the gateway to see it here</div>
          </div>
        </div>
      ) : (
        <div class="card" style="padding:0; overflow:hidden">
          <table>
            <thead>
              <tr>
                <th>Time</th><th>Model</th><th>Provider</th><th>Tokens</th>
                <th>Cost</th><th>Latency</th><th>Cache</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log: any) => (
                <tr key={log.id}>
                  <td style="font-size:12px; color:var(--text-tertiary)">{new Date(log.createdAt ?? log.created_at).toLocaleString()}</td>
                  <td><span class="mono" style="color:var(--text)">{log.model}</span></td>
                  <td>{log.provider}</td>
                  <td>{log.totalTokens ?? log.total_tokens}</td>
                  <td class="mono">${(log.cost ?? 0).toFixed(4)}</td>
                  <td>{log.latencyMs ?? log.latency_ms}ms</td>
                  <td>{(log.isCached ?? log.is_cached) ? <span class="badge badge-green"><span class="badge-dot" /> Hit</span> : <span class="badge badge-gray">Miss</span>}</td>
                  <td>{log.error ? <span class="badge badge-red"><span class="badge-dot" /> Error</span> : <span class="badge badge-green"><span class="badge-dot" /> {log.statusCode ?? log.status_code}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Prompts() {
  const [prompts, setPrompts] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showVersion, setShowVersion] = useState(false);
  const [form, setForm] = useState({ slug: '', name: '', description: '' });
  const [vForm, setVForm] = useState({ content: '', systemPrompt: '', model: '', tag: 'draft' });

  const load = () => api.listPrompts().then(setPrompts).catch(() => {});
  useEffect(() => { load(); }, []);

  const selectPrompt = (id: string) => {
    api.getPrompt(id).then(setSelected).catch(() => {});
  };

  const create = () => {
    api.createPrompt(form).then(() => { setShowCreate(false); setForm({ slug: '', name: '', description: '' }); load(); });
  };

  const createVersion = () => {
    if (!selected) return;
    api.createVersion(selected.id, {
      content: vForm.content,
      systemPrompt: vForm.systemPrompt || undefined,
      model: vForm.model || undefined,
      tag: vForm.tag as any,
    }).then(() => { setShowVersion(false); setVForm({ content: '', systemPrompt: '', model: '', tag: 'draft' }); selectPrompt(selected.id); });
  };

  const publish = (versionId: string) => {
    api.tagVersion(versionId, 'published').then(() => selectPrompt(selected.id));
  };

  return (
    <div>
      <div class="page-header">
        <div>
          <h2 class="page-title">Prompts</h2>
          <p class="page-desc">Versioned prompt templates with runtime resolution</p>
        </div>
        <button class="btn btn-primary" onClick={() => setShowCreate(true)}>Create Prompt</button>
      </div>

      <div style="display:grid; grid-template-columns: 240px 1fr; gap: 16px">
        <div class="card" style="padding:8px; max-height: 560px; overflow-y: auto">
          {prompts.map((p: any) => (
            <button
              key={p.id}
              class={`nav-item ${selected?.id === p.id ? 'active' : ''}`}
              onClick={() => selectPrompt(p.id)}
              style="border-radius:6px"
            >
              <div>
                <div style="font-weight:500; color:var(--text)">{p.name}</div>
                <div class="mono" style="font-size:11px; color:var(--text-tertiary); margin-top:2px">{p.slug}</div>
              </div>
            </button>
          ))}
          {prompts.length === 0 && (
            <div class="empty-state" style="padding:32px 16px">
              <div class="empty-state-title">No prompts</div>
              <div class="empty-state-desc">Create one to get started</div>
            </div>
          )}
        </div>

        <div>
          {selected ? (
            <div class="card">
              <div class="flex-between mb-4">
                <div>
                  <div style="font-size:16px; font-weight:600; letter-spacing:-0.3px">{selected.name}</div>
                  <div class="mono" style="color:var(--text-tertiary); margin-top:2px">{selected.slug}</div>
                </div>
                <button class="btn btn-sm" onClick={() => setShowVersion(true)}>New Version</button>
              </div>
              {selected.description && <p style="color:var(--text-secondary); margin-bottom:16px; font-size:13px">{selected.description}</p>}

              <div class="section-title" style="margin-top:20px">Versions</div>
              {selected.versions?.length > 0 ? (
                <div style="border:1px solid var(--border); border-radius:8px; overflow:hidden">
                  <table>
                    <thead><tr><th>Version</th><th>Status</th><th>Model</th><th>Created</th><th></th></tr></thead>
                    <tbody>
                      {selected.versions.map((v: any) => (
                        <tr key={v.id}>
                          <td style="color:var(--text); font-weight:500">v{v.version}</td>
                          <td>
                            <span class={`badge ${v.tag === 'published' ? 'badge-green' : v.tag === 'draft' ? 'badge-yellow' : 'badge-gray'}`}>
                              <span class="badge-dot" /> {v.tag}
                            </span>
                          </td>
                          <td class="mono">{v.model || '\u2014'}</td>
                          <td style="font-size:12px; color:var(--text-tertiary)">{new Date(v.createdAt ?? v.created_at).toLocaleDateString()}</td>
                          <td style="text-align:right">
                            {v.tag !== 'published' && (
                              <button class="btn btn-sm" onClick={() => publish(v.id)}>Publish</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div class="empty-state" style="padding:24px">
                  <div class="empty-state-desc">No versions yet</div>
                </div>
              )}
            </div>
          ) : (
            <div class="card">
              <div class="empty-state">
                <div class="empty-state-title">Select a prompt</div>
                <div class="empty-state-desc">Choose from the list to view versions and details</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <div class="modal-overlay" onClick={() => setShowCreate(false)}>
          <div class="modal" onClick={(e: any) => e.stopPropagation()}>
            <div class="modal-title">New Prompt</div>
            <div class="form-group">
              <label class="form-label">Slug</label>
              <input class="input" value={form.slug} onInput={(e: any) => setForm({ ...form, slug: e.target.value })} placeholder="welcome-message" />
            </div>
            <div class="form-group">
              <label class="form-label">Name</label>
              <input class="input" value={form.name} onInput={(e: any) => setForm({ ...form, name: e.target.value })} placeholder="Welcome Message" />
            </div>
            <div class="form-group">
              <label class="form-label">Description</label>
              <input class="input" value={form.description} onInput={(e: any) => setForm({ ...form, description: e.target.value })} placeholder="Optional description" />
            </div>
            <div class="btn-group mt-4" style="justify-content:flex-end">
              <button class="btn" onClick={() => setShowCreate(false)}>Cancel</button>
              <button class="btn btn-primary" onClick={create}>Create</button>
            </div>
          </div>
        </div>
      )}

      {showVersion && (
        <div class="modal-overlay" onClick={() => setShowVersion(false)}>
          <div class="modal" onClick={(e: any) => e.stopPropagation()}>
            <div class="modal-title">New Version</div>
            <div class="form-group">
              <label class="form-label">Content</label>
              <textarea class="input" value={vForm.content} onInput={(e: any) => setVForm({ ...vForm, content: e.target.value })} placeholder="You are a helpful assistant that..." />
            </div>
            <div class="form-group">
              <label class="form-label">System Prompt</label>
              <textarea class="input" style="min-height:60px" value={vForm.systemPrompt} onInput={(e: any) => setVForm({ ...vForm, systemPrompt: e.target.value })} placeholder="Optional system-level instructions" />
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px">
              <div class="form-group">
                <label class="form-label">Model Override</label>
                <input class="input" value={vForm.model} onInput={(e: any) => setVForm({ ...vForm, model: e.target.value })} placeholder="gpt-4o" />
              </div>
              <div class="form-group">
                <label class="form-label">Tag</label>
                <select class="input" value={vForm.tag} onChange={(e: any) => setVForm({ ...vForm, tag: e.target.value })}>
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                </select>
              </div>
            </div>
            <div class="btn-group mt-4" style="justify-content:flex-end">
              <button class="btn" onClick={() => setShowVersion(false)}>Cancel</button>
              <button class="btn btn-primary" onClick={createVersion}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Budgets() {
  const [projects, setProjects] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', budgetLimit: '' });

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => {});
  }, []);

  const create = () => {
    api.createProject({
      name: form.name,
      description: form.description || undefined,
      budgetLimit: form.budgetLimit ? parseFloat(form.budgetLimit) : undefined,
    }).then(() => {
      setShowCreate(false);
      setForm({ name: '', description: '', budgetLimit: '' });
      api.listProjects().then(setProjects);
    });
  };

  return (
    <div>
      <div class="page-header">
        <div>
          <h2 class="page-title">Projects & Budgets</h2>
          <p class="page-desc">Cost tracking and spend limits per project</p>
        </div>
        <button class="btn btn-primary" onClick={() => setShowCreate(true)}>New Project</button>
      </div>

      {projects.length > 0 ? (
        <div class="card" style="padding:0; overflow:hidden">
          <table>
            <thead><tr><th>Project</th><th>Budget</th><th>Spent</th><th>Status</th></tr></thead>
            <tbody>
              {projects.map((p: any) => (
                <tr key={p.id}>
                  <td style="color:var(--text); font-weight:500">{p.name}</td>
                  <td class="mono">{p.budget_limit ? `$${p.budget_limit}` : '\u2014'}</td>
                  <td class="mono">${(p.budget_spent ?? 0).toFixed(2)}</td>
                  <td>
                    {p.is_active
                      ? <span class="badge badge-green"><span class="badge-dot" /> Active</span>
                      : <span class="badge badge-red"><span class="badge-dot" /> Inactive</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div class="card">
          <div class="empty-state">
            <div class="empty-state-icon">$</div>
            <div class="empty-state-title">No projects</div>
            <div class="empty-state-desc">Create a project to track spend and set budget limits</div>
          </div>
        </div>
      )}

      {showCreate && (
        <div class="modal-overlay" onClick={() => setShowCreate(false)}>
          <div class="modal" onClick={(e: any) => e.stopPropagation()}>
            <div class="modal-title">New Project</div>
            <div class="form-group">
              <label class="form-label">Name</label>
              <input class="input" value={form.name} onInput={(e: any) => setForm({ ...form, name: e.target.value })} placeholder="my-project" />
            </div>
            <div class="form-group">
              <label class="form-label">Description</label>
              <input class="input" value={form.description} onInput={(e: any) => setForm({ ...form, description: e.target.value })} placeholder="Optional" />
            </div>
            <div class="form-group">
              <label class="form-label">Monthly Budget ($)</label>
              <input class="input" type="number" value={form.budgetLimit} onInput={(e: any) => setForm({ ...form, budgetLimit: e.target.value })} placeholder="100" />
            </div>
            <div class="btn-group mt-4" style="justify-content:flex-end">
              <button class="btn" onClick={() => setShowCreate(false)}>Cancel</button>
              <button class="btn btn-primary" onClick={create}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ABTests() {
  const [tests, setTests] = useState<any[]>([]);

  useEffect(() => {
    api.listABTests().then(setTests).catch(() => {});
  }, []);

  return (
    <div>
      <div class="page-header">
        <div>
          <h2 class="page-title">A/B Tests</h2>
          <p class="page-desc">Compare prompt variants with traffic splitting</p>
        </div>
      </div>

      {tests.length > 0 ? (
        <div class="card" style="padding:0; overflow:hidden">
          <table>
            <thead><tr><th>Experiment</th><th>Status</th><th>Variants</th></tr></thead>
            <tbody>
              {tests.map((t: any) => (
                <tr key={t.id}>
                  <td style="color:var(--text); font-weight:500">{t.name}</td>
                  <td>
                    <span class={`badge ${t.status === 'running' ? 'badge-green' : t.status === 'stopped' ? 'badge-red' : 'badge-yellow'}`}>
                      <span class="badge-dot" /> {t.status}
                    </span>
                  </td>
                  <td>{t.variants?.length ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div class="card">
          <div class="empty-state">
            <div class="empty-state-icon">{'\u2194'}</div>
            <div class="empty-state-title">No experiments</div>
            <div class="empty-state-desc">Set up an A/B test to compare prompt variants</div>
          </div>
        </div>
      )}
    </div>
  );
}

function Settings() {
  const [status, setStatus] = useState<any>(null);

  useEffect(() => {
    api.systemStatus().then(setStatus).catch(() => {});
  }, []);

  return (
    <div>
      <div class="page-header">
        <div>
          <h2 class="page-title">Settings</h2>
          <p class="page-desc">System information and maintenance</p>
        </div>
      </div>

      <div class="section">
        <div class="section-title">System</div>
        <div class="kv-grid">
          <div class="kv-item">
            <div class="kv-label">Version</div>
            <div class="kv-value">{status?.version ?? '\u2014'}</div>
          </div>
          <div class="kv-item">
            <div class="kv-label">Request Logs</div>
            <div class="kv-value">{status?.totalLogs?.toLocaleString() ?? '0'}</div>
          </div>
          <div class="kv-item">
            <div class="kv-label">Cache Entries</div>
            <div class="kv-value">{status?.cacheEntries?.toLocaleString() ?? '0'}</div>
          </div>
          <div class="kv-item">
            <div class="kv-label">Providers</div>
            <div class="kv-value mono">{status?.providers?.join(', ') ?? 'none'}</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Maintenance</div>
        <div class="card">
          <div class="flex-between">
            <div>
              <div style="font-weight:500; font-size:13px">Clear Cache</div>
              <div style="font-size:12px; color:var(--text-tertiary); margin-top:2px">Remove all cached responses from the semantic cache</div>
            </div>
            <button class="btn btn-danger btn-sm" onClick={() => api.clearCache().then(() => alert('Cache cleared'))}>
              Clear
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Main App ----

type Page = 'dashboard' | 'providers' | 'logs' | 'prompts' | 'budgets' | 'ab-tests' | 'settings';

function App() {
  const [page, setPage] = useState<Page>('dashboard');

  const pages: Record<Page, { label: string; component: (props: { onNavigate: (p: string) => void }) => any }> = {
    dashboard: { label: 'Overview', component: ({ onNavigate }) => <Dashboard onNavigate={onNavigate} /> },
    providers: { label: 'Providers', component: () => <Providers /> },
    logs: { label: 'Logs', component: () => <Logs /> },
    prompts: { label: 'Prompts', component: () => <Prompts /> },
    budgets: { label: 'Budgets', component: () => <Budgets /> },
    'ab-tests': { label: 'Experiments', component: () => <ABTests /> },
    settings: { label: 'Settings', component: () => <Settings /> },
  };

  const CurrentPage = pages[page].component;

  return (
    <>
      <style>{styles}</style>
      <div class="layout">
        <nav class="sidebar">
          <div class="sidebar-brand">
            <span class="dot"></span>
            Freeport
          </div>
          <div class="sidebar-nav">
            {Object.entries(pages).map(([key, { label }]) => (
              <button
                key={key}
                class={`nav-item ${page === key ? 'active' : ''}`}
                onClick={() => setPage(key as Page)}
              >
                <span class="nav-icon">{icons[key]}</span>
                {label}
              </button>
            ))}
          </div>
          <div class="sidebar-footer">
            v0.1.0
          </div>
        </nav>
        <main class="main">
          <CurrentPage onNavigate={(p: string) => setPage(p as Page)} />
        </main>
      </div>
    </>
  );
}

render(<App />, document.getElementById('app')!);
