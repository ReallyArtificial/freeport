import { render } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
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
  .btn-warning { background: white; border-color: var(--warning); color: #915e0d; }
  .btn-warning:hover { background: var(--warning); color: white; }
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

  @keyframes live-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
  .live-indicator { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #e00; font-weight: 600; }
  .live-dot { width: 8px; height: 8px; border-radius: 50%; background: #e00; animation: live-pulse 1.5s ease-in-out infinite; }

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
    max-height: 90vh; overflow-y: auto;
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
    position: relative; overflow: hidden;
    background-color: #dbeafe;
    background-image:
      radial-gradient(ellipse at 20% 50%, #c7d9f5 0%, transparent 50%),
      radial-gradient(ellipse at 80% 20%, #bfdbfe 0%, transparent 40%),
      radial-gradient(ellipse at 60% 80%, #e0eafc 0%, transparent 45%),
      radial-gradient(circle at 10% 10%, rgba(165,180,252,0.3) 0%, transparent 30%),
      radial-gradient(circle at 90% 90%, rgba(147,197,253,0.4) 0%, transparent 35%),
      url("data:image/svg+xml,%3Csvg width='60' height='60' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
    border: 1px solid #bfcfea; border-radius: 12px;
    padding: 32px; margin-bottom: 24px; color: #1e3a5f;
  }
  .setup-banner::before {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    background-image:
      linear-gradient(135deg, transparent 25%, rgba(255,255,255,0.15) 25%, rgba(255,255,255,0.15) 50%, transparent 50%, transparent 75%, rgba(255,255,255,0.15) 75%);
    background-size: 20px 20px;
    opacity: 0.5;
  }
  .setup-banner > * { position: relative; z-index: 1; }
  .setup-banner-title {
    font-size: 18px; font-weight: 600; color: #1e3a5f; margin-bottom: 8px;
    letter-spacing: -0.3px;
  }
  .setup-banner-desc { font-size: 13px; color: #3b6a9e; margin-bottom: 20px; line-height: 1.5; }
  .setup-banner .btn-primary { background: #3b6cf5; border-color: #3b6cf5; color: #fff; }
  .setup-banner .btn-primary:hover { background: #2b5ce5; border-color: #2b5ce5; }

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

  /* Copy button */
  .copy-btn {
    padding: 2px 8px; border-radius: 4px; border: 1px solid var(--border);
    background: var(--surface); cursor: pointer; font-size: 11px; color: var(--text-tertiary);
    font-family: var(--font);
  }
  .copy-btn:hover { border-color: var(--text); color: var(--text); }

  /* Detail panel */
  .detail-panel {
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    padding: 24px; margin-top: 16px;
  }

  /* Clickable row */
  tr.clickable { cursor: pointer; }
  tr.clickable:hover td { background: var(--accent-light); }

  /* Toggle */
  .toggle {
    position: relative; width: 36px; height: 20px; border-radius: 10px;
    background: var(--border); cursor: pointer; border: none; transition: background 0.2s;
  }
  .toggle.active { background: var(--success); }
  .toggle::after {
    content: ''; position: absolute; top: 2px; left: 2px;
    width: 16px; height: 16px; border-radius: 50%; background: white;
    transition: transform 0.2s;
  }
  .toggle.active::after { transform: translateX(16px); }

  /* Filter bar */
  .filter-bar {
    display: flex; align-items: end; gap: 12px; margin-bottom: 16px; flex-wrap: wrap;
  }
  .filter-bar .form-group { margin-bottom: 0; min-width: 140px; }
  .filter-bar .input { padding: 6px 10px; font-size: 12px; }

  /* Log detail */
  .log-detail {
    background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
    margin-top: 8px; overflow: hidden;
  }
  .log-detail pre {
    white-space: pre-wrap; word-break: break-word; margin: 0;
    max-height: 400px; overflow-y: auto; font-size: 12px; line-height: 1.6;
  }

  /* Log detail meta grid */
  .log-meta {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 0;
    border-bottom: 1px solid var(--border);
  }
  .log-meta-item {
    padding: 12px 16px; border-right: 1px solid var(--border);
  }
  .log-meta-item:nth-child(4n) { border-right: none; }
  .log-meta-label { font-size: 10px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; font-weight: 500; }
  .log-meta-value { font-size: 13px; color: var(--text); font-weight: 600; }
  .log-meta-value.mono { font-family: var(--mono); font-size: 12px; }

  /* Log sections */
  .log-section { border-bottom: 1px solid var(--border); }
  .log-section:last-child { border-bottom: none; }
  .log-section-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 16px; cursor: pointer; user-select: none;
  }
  .log-section-header:hover { background: var(--surface2); }
  .log-section-title {
    font-size: 11px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.5px; color: var(--text-secondary);
    display: flex; align-items: center; gap: 6px;
  }
  .log-section-body { padding: 0 16px 12px; }

  /* Chat messages */
  .log-msg { margin-bottom: 8px; border-radius: 6px; overflow: hidden; }
  .log-msg:last-child { margin-bottom: 0; }
  .log-msg-role {
    font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
    padding: 4px 10px; display: inline-block; border-radius: 4px; margin-bottom: 4px;
  }
  .log-msg-role.system { background: #ede9fe; color: #6b21a8; }
  .log-msg-role.user { background: #dbeafe; color: #1e40af; }
  .log-msg-role.assistant { background: #dcfce7; color: #166534; }
  .log-msg-content {
    font-size: 13px; line-height: 1.6; color: var(--text);
    padding: 8px 12px; background: var(--surface); border: 1px solid var(--border);
    border-radius: 6px; white-space: pre-wrap; word-break: break-word;
  }

  /* Log actions bar */
  .log-actions {
    display: flex; align-items: center; gap: 6px; padding: 10px 16px;
    background: var(--surface2); border-top: 1px solid var(--border); flex-wrap: wrap;
  }
  .log-action-btn {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 4px 10px; border-radius: 4px; border: 1px solid var(--border);
    background: var(--surface); cursor: pointer; font-size: 11px; color: var(--text-secondary);
    font-family: var(--font); font-weight: 500; transition: all 0.15s;
  }
  .log-action-btn:hover { border-color: var(--text); color: var(--text); }
  .log-action-btn.copied { background: var(--success-light); border-color: #0cce6b; color: #0a7c42; }

  /* Collapsible raw JSON */
  .log-raw { padding: 12px 16px; }
  .log-raw pre {
    background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
    padding: 12px; font-size: 11px; line-height: 1.5; max-height: 300px; overflow: auto;
  }
  .chevron { font-size: 10px; transition: transform 0.15s; display: inline-block; }
  .chevron.open { transform: rotate(90deg); }

  /* Key reveal */
  .key-reveal {
    background: #fffde7; border: 1px solid #fff59d; border-radius: 8px;
    padding: 16px; margin-bottom: 16px;
  }
  .key-reveal-text {
    font-family: var(--mono); font-size: 13px; background: white;
    padding: 8px 12px; border-radius: 4px; border: 1px solid var(--border);
    word-break: break-all; margin: 8px 0;
  }
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
  'api-keys': '\u{1F511}',
  logs: '\u2261',
  prompts: '\u270E',
  budgets: '\u0024',
  'ab-tests': '\u2194',
  fallbacks: '\u21C5',
  settings: '\u2699',
  'audit-log': '\u{1F4CB}',
};

// ---- Utility ----
function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

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
              <div class="empty-state-icon">{'-'}</div>
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
  const [showEdit, setShowEdit] = useState<any>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '', type: 'openai', apiBase: '', apiKey: '', models: '', enabled: true,
  });
  const [editForm, setEditForm] = useState({
    name: '', type: '', apiBase: '', apiKey: '', models: '', enabled: true,
  });
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<any>(null);

  const testConnection = (id: string) => {
    setTesting(id);
    setTestResult(null);
    api.testProvider(id)
      .then((res: any) => setTestResult({ id, ...res }))
      .catch((err: any) => setTestResult({ id, success: false, error: err.message }))
      .finally(() => setTesting(null));
  };

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

  const openEdit = (p: any) => {
    setEditForm({
      name: p.name,
      type: p.type,
      apiBase: p.api_base || '',
      apiKey: '',
      models: p.models ? JSON.parse(p.models).join(', ') : '',
      enabled: !!p.enabled,
    });
    setShowEdit(p);
    setError('');
  };

  const saveEdit = () => {
    setError('');
    const models = editForm.models
      ? editForm.models.split(',').map((s: string) => s.trim()).filter(Boolean)
      : undefined;
    const data: any = {
      name: editForm.name,
      models,
      enabled: editForm.enabled,
      apiBase: editForm.apiBase || null,
    };
    if (editForm.apiKey) data.apiKey = editForm.apiKey;
    api.updateProvider(showEdit.id, data).then(() => {
      setShowEdit(null);
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
            <button class="btn" style="background:rgba(255,255,255,0.7);border-color:#93b5e1;color:#1e3a5f" onClick={() => { resetForm(); prefillName('anthropic'); setShowCreate(true); }}>
              Add Anthropic
            </button>
            <button class="btn" style="background:rgba(255,255,255,0.7);border-color:#93b5e1;color:#1e3a5f" onClick={() => { resetForm(); prefillName('google'); setShowCreate(true); }}>
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
                    <div class="btn-group" style="justify-content:flex-end">
                      <button class="btn btn-sm" onClick={() => testConnection(p.id)} disabled={testing === p.id}>
                        {testing === p.id ? 'Testing...' : 'Test'}
                      </button>
                      <button class="btn btn-sm" onClick={() => openEdit(p)}>Edit</button>
                      <button class="btn btn-danger btn-sm" onClick={() => remove(p.id, p.name)}>Remove</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {testResult && (
        <div style={`border:1px solid ${testResult.success ? 'var(--success)' : 'var(--danger)'}; background:${testResult.success ? 'var(--success-light)' : 'var(--danger-light)'}; border-radius:8px; padding:14px 18px; margin-bottom:16px`}>
          <div class="flex-between">
            <div>
              <div style={`font-weight:600; font-size:13px; color:${testResult.success ? '#0a7c42' : '#c00'}`}>
                {testResult.success ? 'Connection successful' : 'Connection failed'}
              </div>
              {testResult.success ? (
                <div style="font-size:12px; color:var(--text-secondary); margin-top:4px">
                  Response in {testResult.latencyMs}ms
                  {testResult.models && <span>  - {testResult.models.length} model{testResult.models.length !== 1 ? 's' : ''} available</span>}
                  {testResult.model && <span>  - model: {testResult.model}</span>}
                </div>
              ) : (
                <div style="font-size:12px; color:#c00; margin-top:4px; font-family:var(--mono)">{testResult.error}</div>
              )}
            </div>
            <button class="btn btn-sm" onClick={() => setTestResult(null)}>Dismiss</button>
          </div>
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

      {showEdit && (
        <div class="modal-overlay" onClick={() => { setShowEdit(null); setError(''); }}>
          <div class="modal" onClick={(e: any) => e.stopPropagation()}>
            <div class="modal-title">Edit Provider</div>
            {error && <div style="color:var(--danger); font-size:13px; margin-bottom:12px">{error}</div>}
            <div class="form-group">
              <label class="form-label">Name</label>
              <input class="input" value={editForm.name} onInput={(e: any) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div class="form-group">
              <label class="form-label">API Key <span style="color:var(--text-tertiary)">(leave blank to keep existing)</span></label>
              <input class="input" type="password" value={editForm.apiKey} onInput={(e: any) => setEditForm({ ...editForm, apiKey: e.target.value })} placeholder="Leave blank to keep existing" />
            </div>
            <div class="form-group">
              <label class="form-label">API Base URL</label>
              <input class="input" value={editForm.apiBase} onInput={(e: any) => setEditForm({ ...editForm, apiBase: e.target.value })} placeholder="Leave blank for default" />
            </div>
            <div class="form-group">
              <label class="form-label">Models <span style="color:var(--text-tertiary)">(comma-separated)</span></label>
              <input class="input" value={editForm.models} onInput={(e: any) => setEditForm({ ...editForm, models: e.target.value })} />
            </div>
            <div class="form-group">
              <label class="form-label">Enabled</label>
              <button class={`toggle ${editForm.enabled ? 'active' : ''}`} onClick={() => setEditForm({ ...editForm, enabled: !editForm.enabled })} />
            </div>
            <div class="btn-group mt-4" style="justify-content:flex-end">
              <button class="btn" onClick={() => { setShowEdit(null); setError(''); }}>Cancel</button>
              <button class="btn btn-primary" onClick={saveEdit}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ApiKeys() {
  const [keys, setKeys] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', projectId: '', rateLimitRpm: '', rateLimitTpm: '', scopes: '*', expiresIn: '' });

  const load = () => {
    Promise.all([api.listApiKeys(), api.listProjects()])
      .then(([k, p]) => { setKeys(k); setProjects(p); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const create = () => {
    setError('');
    let expiresAt: string | undefined;
    if (form.expiresIn) {
      const days = parseInt(form.expiresIn);
      if (days > 0) {
        const d = new Date();
        d.setDate(d.getDate() + days);
        expiresAt = d.toISOString();
      }
    }
    api.createApiKey({
      name: form.name,
      projectId: form.projectId || undefined,
      rateLimitRpm: form.rateLimitRpm ? parseInt(form.rateLimitRpm) : undefined,
      rateLimitTpm: form.rateLimitTpm ? parseInt(form.rateLimitTpm) : undefined,
      scopes: form.scopes || undefined,
      expiresAt,
    }).then((res: any) => {
      setNewKey(res.plainTextKey);
      setForm({ name: '', projectId: '', rateLimitRpm: '', rateLimitTpm: '', scopes: '*', expiresIn: '' });
      load();
    }).catch((err: any) => setError(err.message));
  };

  const rotate = (id: string, name: string) => {
    if (!confirm(`Rotate API key "${name}"? The old key will be revoked.`)) return;
    api.rotateApiKey(id).then((res: any) => {
      setNewKey(res.plainTextKey);
      load();
    }).catch((err: any) => setError(err.message));
  };

  const revoke = (id: string) => {
    api.revokeApiKey(id).then(load);
  };

  const activate = (id: string) => {
    api.activateApiKey(id).then(load);
  };

  const remove = (id: string, name: string) => {
    if (!confirm(`Delete API key "${name}"? This cannot be undone.`)) return;
    api.deleteApiKey(id).then(load);
  };

  const projectName = (pid: string | null) => {
    if (!pid) return '-';
    const p = projects.find((p: any) => p.id === pid);
    return p?.name ?? pid;
  };

  return (
    <div>
      <div class="page-header">
        <div>
          <h2 class="page-title">API Keys</h2>
          <p class="page-desc">Manage Freeport gateway API keys for proxy authentication</p>
        </div>
        <button class="btn btn-primary" onClick={() => { setShowCreate(true); setNewKey(null); }}>Create Key</button>
      </div>

      {newKey && (
        <div class="key-reveal">
          <div style="font-weight:600; font-size:14px; margin-bottom:4px">Your new API key</div>
          <div style="font-size:12px; color:#915e0d; margin-bottom:8px">
            Copy this key now. It will not be shown again.
          </div>
          <div class="key-reveal-text">{newKey}</div>
          <div class="btn-group">
            <button class="btn btn-sm" onClick={() => { copyToClipboard(newKey); }}>
              Copy to clipboard
            </button>
            <button class="btn btn-sm" onClick={() => setNewKey(null)}>Dismiss</button>
          </div>
        </div>
      )}

      {loading ? <div class="empty">Loading...</div> : keys.length === 0 ? (
        <div class="card">
          <div class="empty-state">
            <div class="empty-state-icon">{'\u{1F511}'}</div>
            <div class="empty-state-title">No API keys</div>
            <div class="empty-state-desc">Create an API key to authenticate proxy requests with fport_ keys</div>
          </div>
        </div>
      ) : (
        <div class="card" style="padding:0; overflow:hidden">
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Key Prefix</th><th>Project</th><th>Scopes</th>
                <th>Rate Limits</th><th>Expires</th><th>Status</th><th>Last Used</th><th></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k: any) => (
                <tr key={k.id}>
                  <td style="color:var(--text); font-weight:500">{k.name}</td>
                  <td><span class="key-mask">{k.key_prefix}...</span></td>
                  <td>{projectName(k.project_id)}</td>
                  <td><span class="mono" style="font-size:11px">{k.scopes ?? '*'}</span></td>
                  <td class="mono" style="font-size:11px">
                    {k.rate_limit_rpm ? `${k.rate_limit_rpm} RPM` : ''}
                    {k.rate_limit_rpm && k.rate_limit_tpm ? ' / ' : ''}
                    {k.rate_limit_tpm ? `${k.rate_limit_tpm} TPM` : ''}
                    {!k.rate_limit_rpm && !k.rate_limit_tpm ? '-' : ''}
                  </td>
                  <td style="font-size:12px; color:var(--text-tertiary)">
                    {k.expires_at ? new Date(k.expires_at).toLocaleDateString() : 'Never'}
                  </td>
                  <td>
                    <span class={`badge ${k.is_active ? 'badge-green' : 'badge-red'}`}>
                      <span class="badge-dot" /> {k.is_active ? 'Active' : 'Revoked'}
                    </span>
                  </td>
                  <td style="font-size:12px; color:var(--text-tertiary)">
                    {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'Never'}
                  </td>
                  <td style="text-align:right">
                    <div class="btn-group" style="justify-content:flex-end">
                      {k.is_active && <button class="btn btn-sm" onClick={() => rotate(k.id, k.name)}>Rotate</button>}
                      {k.is_active ? (
                        <button class="btn btn-warning btn-sm" onClick={() => revoke(k.id)}>Revoke</button>
                      ) : (
                        <button class="btn btn-sm" onClick={() => activate(k.id)}>Activate</button>
                      )}
                      <button class="btn btn-danger btn-sm" onClick={() => remove(k.id, k.name)}>Delete</button>
                    </div>
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
            <div class="modal-title">Create API Key</div>
            {error && <div style="color:var(--danger); font-size:13px; margin-bottom:12px">{error}</div>}
            <div class="form-group">
              <label class="form-label">Name</label>
              <input class="input" value={form.name} onInput={(e: any) => setForm({ ...form, name: e.target.value })} placeholder="e.g. production-backend" />
            </div>
            <div class="form-group">
              <label class="form-label">Project <span style="color:var(--text-tertiary)">(optional)</span></label>
              <select class="input" value={form.projectId} onChange={(e: any) => setForm({ ...form, projectId: e.target.value })}>
                <option value="">No project</option>
                {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Scopes</label>
              <select class="input" value={form.scopes} onChange={(e: any) => setForm({ ...form, scopes: e.target.value })}>
                <option value="*">Full access (*)</option>
                <option value="proxy">Proxy only</option>
                <option value="admin:read">Admin read-only</option>
                <option value="admin:read,admin:write">Admin read+write</option>
                <option value="proxy,admin:read">Proxy + Admin read</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Expires in <span style="color:var(--text-tertiary)">(days, optional)</span></label>
              <input class="input" type="number" value={form.expiresIn} onInput={(e: any) => setForm({ ...form, expiresIn: e.target.value })} placeholder="e.g. 90 (blank = never)" />
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px">
              <div class="form-group">
                <label class="form-label">RPM Limit <span style="color:var(--text-tertiary)">(optional)</span></label>
                <input class="input" type="number" value={form.rateLimitRpm} onInput={(e: any) => setForm({ ...form, rateLimitRpm: e.target.value })} placeholder="60" />
              </div>
              <div class="form-group">
                <label class="form-label">TPM Limit <span style="color:var(--text-tertiary)">(optional)</span></label>
                <input class="input" type="number" value={form.rateLimitTpm} onInput={(e: any) => setForm({ ...form, rateLimitTpm: e.target.value })} placeholder="100000" />
              </div>
            </div>
            <div class="btn-group mt-4" style="justify-content:flex-end">
              <button class="btn" onClick={() => { setShowCreate(false); setError(''); }}>Cancel</button>
              <button class="btn btn-primary" onClick={create} disabled={!form.name}>Create Key</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function parseJsonSafe(raw: unknown): any {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return null; } }
  return null;
}

function extractMessages(requestBody: unknown): Array<{ role: string; content: string }> {
  const parsed = parseJsonSafe(requestBody);
  if (!parsed?.messages) return [];
  return parsed.messages.filter((m: any) => m.role && m.content);
}

function extractAssistantContent(responseBody: unknown): string | null {
  const parsed = parseJsonSafe(responseBody);
  if (!parsed?.choices?.[0]?.message?.content) return null;
  return parsed.choices[0].message.content;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const doCopy = (e: Event) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return <button class={`log-action-btn ${copied ? 'copied' : ''}`} onClick={doCopy}>{copied ? '\u2713 Copied' : label}</button>;
}

function CollapsibleSection({ title, defaultOpen, badge, actions, children }: {
  title: string; defaultOpen?: boolean; badge?: any; actions?: any; children: any;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div class="log-section">
      <div class="log-section-header" onClick={() => setOpen(!open)}>
        <span class="log-section-title">
          <span class={`chevron ${open ? 'open' : ''}`}>{'\u25B6'}</span>
          {title}
          {badge}
        </span>
        {actions && <span onClick={(e: Event) => e.stopPropagation()}>{actions}</span>}
      </div>
      {open && <div class="log-section-body">{children}</div>}
    </div>
  );
}

function LogDetailPanel({ log }: { log: any }) {
  const messages = extractMessages(log.requestBody);
  const assistantContent = extractAssistantContent(log.responseBody);
  const parsedReq = parseJsonSafe(log.requestBody);
  const parsedResp = parseJsonSafe(log.responseBody);
  const prettyReq = parsedReq ? JSON.stringify(parsedReq, null, 2) : (log.requestBody || 'N/A');
  const prettyResp = parsedResp ? JSON.stringify(parsedResp, null, 2) : (log.responseBody || 'N/A');
  const reqModel = parsedReq?.model || log.model;
  const inputTok = parsedResp?.usage?.prompt_tokens ?? log.inputTokens ?? 0;
  const outputTok = parsedResp?.usage?.completion_tokens ?? log.outputTokens ?? 0;
  const totalTok = log.totalTokens ?? (inputTok + outputTok);
  const finishReason = parsedResp?.choices?.[0]?.finish_reason;

  // Build cURL command
  const curlCmd = parsedReq ? `curl -X POST http://localhost:4000/v1/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer YOUR_KEY" \\\n  -d '${JSON.stringify(parsedReq)}'` : '';

  return (
    <div class="log-detail">
      {/* Meta grid */}
      <div class="log-meta">
        <div class="log-meta-item">
          <div class="log-meta-label">Model</div>
          <div class="log-meta-value mono">{reqModel}</div>
        </div>
        <div class="log-meta-item">
          <div class="log-meta-label">Provider</div>
          <div class="log-meta-value">{log.provider}</div>
        </div>
        <div class="log-meta-item">
          <div class="log-meta-label">Latency</div>
          <div class="log-meta-value">{log.latencyMs}ms</div>
        </div>
        <div class="log-meta-item">
          <div class="log-meta-label">Cost</div>
          <div class="log-meta-value">${(log.cost ?? 0).toFixed(4)}</div>
        </div>
        <div class="log-meta-item">
          <div class="log-meta-label">Tokens</div>
          <div class="log-meta-value mono" style="font-size:12px">{inputTok} in / {outputTok} out / {totalTok} total</div>
        </div>
        <div class="log-meta-item">
          <div class="log-meta-label">Cache</div>
          <div class="log-meta-value">{log.isCached ? <span class="badge badge-green" style="font-size:11px"><span class="badge-dot" /> Hit</span> : <span class="badge badge-gray" style="font-size:11px">Miss</span>}</div>
        </div>
        <div class="log-meta-item">
          <div class="log-meta-label">Status</div>
          <div class="log-meta-value">{finishReason ? <span class="badge badge-green" style="font-size:11px">{finishReason}</span> : <span>{log.statusCode}</span>}</div>
        </div>
        <div class="log-meta-item">
          <div class="log-meta-label">Request ID</div>
          <div class="log-meta-value mono" style="font-size:11px; display:flex; align-items:center; gap:6px">
            <span style="max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{log.id}</span>
            <CopyButton text={log.id} label="Copy" />
          </div>
        </div>
      </div>

      {/* Input Messages */}
      {messages.length > 0 && (
        <CollapsibleSection title="Input Messages" defaultOpen={true} badge={<span class="badge badge-gray" style="margin-left:6px; font-size:10px">{messages.length}</span>}>
          {messages.map((msg: any, i: number) => (
            <div class="log-msg" key={i}>
              <span class={`log-msg-role ${msg.role}`}>{msg.role}</span>
              <div class="log-msg-content">{msg.content}</div>
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* Output */}
      {assistantContent && (
        <CollapsibleSection
          title="Output"
          defaultOpen={true}
          actions={<CopyButton text={assistantContent} label="Copy text" />}
        >
          <div class="log-msg">
            <span class="log-msg-role assistant">assistant</span>
            <div class="log-msg-content">{assistantContent}</div>
          </div>
        </CollapsibleSection>
      )}

      {/* Error */}
      {log.error && (
        <CollapsibleSection title="Error" defaultOpen={true}>
          <div style="padding:8px 12px; background:var(--danger-light); border:1px solid rgba(224,0,0,0.2); border-radius:6px; color:#c00; font-size:13px">
            {log.error}
          </div>
        </CollapsibleSection>
      )}

      {/* Raw Request JSON */}
      <CollapsibleSection title="Raw Request JSON" actions={<CopyButton text={prettyReq} label="Copy" />}>
        <div class="log-raw"><pre>{prettyReq}</pre></div>
      </CollapsibleSection>

      {/* Raw Response JSON */}
      <CollapsibleSection title="Raw Response JSON" actions={<CopyButton text={prettyResp} label="Copy" />}>
        <div class="log-raw"><pre>{prettyResp}</pre></div>
      </CollapsibleSection>

      {/* Actions bar */}
      <div class="log-actions">
        {assistantContent && <CopyButton text={assistantContent} label="Copy response text" />}
        {curlCmd && <CopyButton text={curlCmd} label="Copy as cURL" />}
        <CopyButton text={prettyReq} label="Copy request JSON" />
        <CopyButton text={prettyResp} label="Copy response JSON" />
        <CopyButton text={log.id} label="Copy request ID" />
      </div>
    </div>
  );
}

function Logs() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [live, setLive] = useState(false);
  const [filters, setFilters] = useState({
    provider: '', model: '', project_id: '', since: '', until: '',
  });
  const limit = 50;
  const liveRef = useRef(live);
  liveRef.current = live;
  const logsRef = useRef(logs);
  logsRef.current = logs;

  const load = (newOffset = 0) => {
    setLoading(true);
    const params: Record<string, string> = { limit: String(limit), offset: String(newOffset) };
    if (filters.provider) params.provider = filters.provider;
    if (filters.model) params.model = filters.model;
    if (filters.project_id) params.project_id = filters.project_id;
    if (filters.since) params.since = filters.since;
    if (filters.until) params.until = filters.until;
    api.getLogs(params)
      .then((data: any) => { setLogs(data); setOffset(newOffset); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    Promise.all([api.listProviders(), api.listProjects()])
      .then(([prov, proj]) => { setProviders(prov); setProjects(proj); })
      .catch(() => {});
    load();
  }, []);

  // Live polling: fetch latest logs every 3s and merge new ones
  useEffect(() => {
    if (!live) return;
    const interval = setInterval(() => {
      if (!liveRef.current) return;
      const params: Record<string, string> = { limit: '20', offset: '0' };
      if (filters.provider) params.provider = filters.provider;
      if (filters.model) params.model = filters.model;
      if (filters.project_id) params.project_id = filters.project_id;
      api.getLogs(params).then((fresh: any[]) => {
        if (!liveRef.current) return;
        const current = logsRef.current;
        const existingIds = new Set(current.map((l: any) => l.id));
        const newItems = fresh.filter((l: any) => !existingIds.has(l.id));
        if (newItems.length > 0) {
          setLogs([...newItems, ...current].slice(0, limit));
        }
      }).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [live, filters.provider, filters.model, filters.project_id]);

  const applyFilters = () => { setLive(false); load(0); };

  return (
    <div>
      <div class="page-header">
        <div>
          <h2 class="page-title">Request Logs</h2>
          <p class="page-desc">Recent requests through the gateway</p>
        </div>
        <div style="display:flex; align-items:center; gap:12px">
          <button
            class={`btn btn-sm ${live ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => { if (!live) { load(0); } setLive(!live); setOffset(0); }}
          >
            {live ? '\u25A0 Stop Live' : '\u25B6 Live'}
          </button>
        </div>
      </div>

      <div class="filter-bar">
        <div class="form-group">
          <label class="form-label">Provider</label>
          <select class="input" value={filters.provider} onChange={(e: any) => setFilters({ ...filters, provider: e.target.value })}>
            <option value="">All</option>
            {providers.map((p: any) => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Model</label>
          <input class="input" value={filters.model} onInput={(e: any) => setFilters({ ...filters, model: e.target.value })} placeholder="gpt-4o" />
        </div>
        <div class="form-group">
          <label class="form-label">Project</label>
          <select class="input" value={filters.project_id} onChange={(e: any) => setFilters({ ...filters, project_id: e.target.value })}>
            <option value="">All</option>
            {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Since</label>
          <input class="input" type="datetime-local" value={filters.since} onInput={(e: any) => setFilters({ ...filters, since: e.target.value })} />
        </div>
        <div class="form-group">
          <label class="form-label">Until</label>
          <input class="input" type="datetime-local" value={filters.until} onInput={(e: any) => setFilters({ ...filters, until: e.target.value })} />
        </div>
        <div class="form-group" style="display:flex; align-items:flex-end">
          <button class="btn btn-primary btn-sm" onClick={applyFilters}>Filter</button>
        </div>
      </div>

      {live && <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px; padding:8px 12px; background:var(--danger-light); border-radius:8px; border:1px solid rgba(224,0,0,0.15)">
        <span class="live-dot" /><span style="font-size:13px; color:#c00; font-weight:500">Live - auto-refreshing every 3s</span>
      </div>}

      {loading && !live ? <div class="empty">Loading...</div> : logs.length === 0 ? (
        <div class="card">
          <div class="empty-state">
            <div class="empty-state-icon">{'\u2261'}</div>
            <div class="empty-state-title">No requests logged</div>
            <div class="empty-state-desc">Proxy a request through the gateway to see it here</div>
          </div>
        </div>
      ) : (
        <>
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
                  <>
                    <tr key={log.id} class="clickable" onClick={() => setExpanded(expanded === log.id ? null : log.id)}>
                      <td style="font-size:12px; color:var(--text-tertiary)">{new Date((log.createdAt ?? log.created_at ?? '').replace(' ', 'T') + 'Z').toLocaleString()}</td>
                      <td><span class="mono" style="color:var(--text)">{log.model}</span></td>
                      <td>{log.provider}</td>
                      <td>{log.totalTokens ?? log.total_tokens}</td>
                      <td class="mono">${(log.cost ?? 0).toFixed(4)}</td>
                      <td>{log.latencyMs ?? log.latency_ms}ms</td>
                      <td>{(log.isCached ?? log.is_cached) ? <span class="badge badge-green"><span class="badge-dot" /> Hit</span> : <span class="badge badge-gray">Miss</span>}</td>
                      <td>{log.error ? <span class="badge badge-red"><span class="badge-dot" /> Error</span> : <span class="badge badge-green"><span class="badge-dot" /> {log.statusCode ?? log.status_code}</span>}</td>
                    </tr>
                    {expanded === log.id && (
                      <tr key={`${log.id}-detail`}>
                        <td colSpan={8} style="padding:4px 8px 12px">
                          <LogDetailPanel log={log} />
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          {!live && <div class="flex-between mt-2">
            <button class="btn btn-sm" disabled={offset === 0} onClick={() => load(Math.max(0, offset - limit))}>
              Previous
            </button>
            <span style="font-size:12px; color:var(--text-tertiary)">
              Showing {offset + 1} - {offset + logs.length}
            </span>
            <button class="btn btn-sm" disabled={logs.length < limit} onClick={() => load(offset + limit)}>
              Next
            </button>
          </div>}
        </>
      )}
    </div>
  );
}

function Prompts() {
  const [prompts, setPrompts] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showVersion, setShowVersion] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [testVars, setTestVars] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ slug: '', name: '', description: '' });
  const [editForm, setEditForm] = useState({ name: '', description: '' });
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

  const openEdit = () => {
    if (!selected) return;
    setEditForm({ name: selected.name, description: selected.description || '' });
    setShowEdit(true);
  };

  const saveEdit = () => {
    api.updatePrompt(selected.id, editForm).then(() => {
      setShowEdit(false);
      selectPrompt(selected.id);
      load();
    });
  };

  const deletePrompt = () => {
    if (!selected) return;
    if (!confirm(`Delete prompt "${selected.name}"? This cannot be undone.`)) return;
    api.deletePrompt(selected.id).then(() => {
      setSelected(null);
      load();
    });
  };

  const openTest = () => {
    if (!selected) return;
    // Find variables from latest published version
    const published = selected.versions?.find((v: any) => v.tag === 'published');
    const content = published?.content ?? selected.versions?.[0]?.content ?? '';
    const vars = (content.match(/\{\{(\w+)\}\}/g) || []).map((m: string) => m.slice(2, -2));
    const initial: Record<string, string> = {};
    vars.forEach((v: string) => { initial[v] = ''; });
    setTestVars(initial);
    setTestResult(null);
    setShowTest(true);
  };

  const runTest = () => {
    api.resolvePrompt(selected.slug, testVars).then(setTestResult).catch((err: any) => {
      setTestResult({ error: err.message });
    });
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
                  <div style="margin-top:4px">
                    <span class="mono" style="font-size:11px; color:var(--text-tertiary)">ID: {selected.id}</span>
                    <button class="copy-btn" style="margin-left:6px" onClick={() => copyToClipboard(selected.id)}>Copy</button>
                  </div>
                </div>
                <div class="btn-group">
                  <button class="btn btn-sm" onClick={openTest}>Test</button>
                  <button class="btn btn-sm" onClick={openEdit}>Edit</button>
                  <button class="btn btn-danger btn-sm" onClick={deletePrompt}>Delete</button>
                  <button class="btn btn-sm" onClick={() => setShowVersion(true)}>New Version</button>
                </div>
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
                          <td class="mono">{v.model || '-'}</td>
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

      {showEdit && (
        <div class="modal-overlay" onClick={() => setShowEdit(false)}>
          <div class="modal" onClick={(e: any) => e.stopPropagation()}>
            <div class="modal-title">Edit Prompt</div>
            <div class="form-group">
              <label class="form-label">Name</label>
              <input class="input" value={editForm.name} onInput={(e: any) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div class="form-group">
              <label class="form-label">Description</label>
              <input class="input" value={editForm.description} onInput={(e: any) => setEditForm({ ...editForm, description: e.target.value })} />
            </div>
            <div class="btn-group mt-4" style="justify-content:flex-end">
              <button class="btn" onClick={() => setShowEdit(false)}>Cancel</button>
              <button class="btn btn-primary" onClick={saveEdit}>Save</button>
            </div>
          </div>
        </div>
      )}

      {showTest && (
        <div class="modal-overlay" onClick={() => setShowTest(false)}>
          <div class="modal" onClick={(e: any) => e.stopPropagation()}>
            <div class="modal-title">Test Prompt: {selected?.slug}</div>
            {Object.keys(testVars).length > 0 ? (
              <div>
                <div style="font-size:12px; color:var(--text-tertiary); margin-bottom:12px">Fill in template variables:</div>
                {Object.keys(testVars).map(v => (
                  <div class="form-group" key={v}>
                    <label class="form-label">{`{{${v}}}`}</label>
                    <input class="input" value={testVars[v]} onInput={(e: any) => setTestVars({ ...testVars, [v]: e.target.value })} placeholder={`Value for ${v}`} />
                  </div>
                ))}
              </div>
            ) : (
              <div style="font-size:13px; color:var(--text-secondary); margin-bottom:12px">No template variables found. Click Resolve to test.</div>
            )}
            <button class="btn btn-primary btn-sm" onClick={runTest}>Resolve</button>
            {testResult && (
              <div class="log-detail" style="margin-top:12px">
                <pre>{testResult.error ? testResult.error : JSON.stringify(testResult, null, 2)}</pre>
              </div>
            )}
            <div class="btn-group mt-4" style="justify-content:flex-end">
              <button class="btn" onClick={() => setShowTest(false)}>Close</button>
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
  const [selected, setSelected] = useState<any>(null);
  const [budget, setBudget] = useState<any>(null);
  const [editLimits, setEditLimits] = useState({ monthlyLimit: '', dailyLimit: '' });
  const [form, setForm] = useState({ name: '', description: '', budgetLimit: '' });

  const load = () => api.listProjects().then(setProjects).catch(() => {});
  useEffect(() => { load(); }, []);

  const create = () => {
    api.createProject({
      name: form.name,
      description: form.description || undefined,
      budgetLimit: form.budgetLimit ? parseFloat(form.budgetLimit) : undefined,
    }).then(() => {
      setShowCreate(false);
      setForm({ name: '', description: '', budgetLimit: '' });
      load();
    });
  };

  const selectProject = (p: any) => {
    setSelected(p);
    api.getBudget(p.id).then((b: any) => {
      setBudget(b);
      setEditLimits({
        monthlyLimit: b.monthlyLimit != null ? String(b.monthlyLimit) : '',
        dailyLimit: b.dailyLimit != null ? String(b.dailyLimit) : '',
      });
    }).catch(() => setBudget(null));
  };

  const saveLimits = () => {
    if (!selected) return;
    api.setBudget(selected.id, {
      monthlyLimit: editLimits.monthlyLimit ? parseFloat(editLimits.monthlyLimit) : undefined,
      dailyLimit: editLimits.dailyLimit ? parseFloat(editLimits.dailyLimit) : undefined,
    }).then(() => selectProject(selected));
  };

  const resetSpend = () => {
    if (!selected || !confirm('Reset all spend tracking for this project?')) return;
    api.resetBudget(selected.id).then(() => selectProject(selected));
  };

  const toggleKill = () => {
    if (!selected || !budget) return;
    api.killSwitch(selected.id, !budget.isKilled).then(() => selectProject(selected));
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
                <tr key={p.id} class="clickable" onClick={() => selectProject(p)} style={selected?.id === p.id ? 'background:var(--accent-light)' : ''}>
                  <td style="color:var(--text); font-weight:500">{p.name}</td>
                  <td class="mono">{p.budget_limit ? `$${p.budget_limit}` : '-'}</td>
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

      {selected && budget && (
        <div class="detail-panel">
          <div class="flex-between mb-4">
            <div style="font-size:16px; font-weight:600">{selected.name}</div>
            <div class="btn-group">
              <button class={`btn btn-sm ${budget.isKilled ? 'btn-primary' : 'btn-danger'}`} onClick={toggleKill}>
                {budget.isKilled ? 'Resume (Unkill)' : 'Kill Switch'}
              </button>
              <button class="btn btn-warning btn-sm" onClick={resetSpend}>Reset Spend</button>
            </div>
          </div>

          {budget.isKilled && (
            <div style="background:var(--danger-light); border:1px solid #fcc; border-radius:6px; padding:10px 14px; margin-bottom:16px; font-size:13px; color:#c00">
              Kill switch is active. All requests for this project are blocked.
            </div>
          )}

          <div class="stat-grid" style="grid-template-columns: repeat(4, 1fr)">
            <div class="stat-card">
              <div class="stat-label">Monthly Spent</div>
              <div class="stat-value">${(budget.monthlySpent ?? 0).toFixed(2)}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Monthly Limit</div>
              <div class="stat-value">{budget.monthlyLimit != null ? `$${budget.monthlyLimit}` : '-'}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Daily Spent</div>
              <div class="stat-value">${(budget.dailySpent ?? 0).toFixed(2)}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Daily Limit</div>
              <div class="stat-value">{budget.dailyLimit != null ? `$${budget.dailyLimit}` : '-'}</div>
            </div>
          </div>

          <div class="section-title">Edit Limits</div>
          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; align-items:end">
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">Monthly Limit ($)</label>
              <input class="input" type="number" value={editLimits.monthlyLimit} onInput={(e: any) => setEditLimits({ ...editLimits, monthlyLimit: e.target.value })} placeholder="No limit" />
            </div>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">Daily Limit ($)</label>
              <input class="input" type="number" value={editLimits.dailyLimit} onInput={(e: any) => setEditLimits({ ...editLimits, dailyLimit: e.target.value })} placeholder="No limit" />
            </div>
            <button class="btn btn-primary btn-sm" onClick={saveLimits}>Save Limits</button>
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
  const [selected, setSelected] = useState<any>(null);
  const [results, setResults] = useState<any[]>([]);
  const [analysis, setAnalysis] = useState<any>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showVariant, setShowVariant] = useState(false);
  const [prompts, setPrompts] = useState<any[]>([]);
  const [form, setForm] = useState({ name: '', description: '' });
  const [vForm, setVForm] = useState({ name: '', promptId: '', model: '', weight: '0.5' });

  const load = () => api.listABTests().then(setTests).catch(() => {});
  useEffect(() => {
    load();
    api.listPrompts().then(setPrompts).catch(() => {});
  }, []);

  const selectTest = (id: string) => {
    api.getABTest(id).then((data: any) => {
      setSelected(data);
      setResults(data.results || []);
    }).catch(() => {});
    api.getABTestAnalysis(id).then(setAnalysis).catch(() => setAnalysis(null));
  };

  const create = () => {
    api.createABTest(form).then(() => {
      setShowCreate(false);
      setForm({ name: '', description: '' });
      load();
    });
  };

  const addVariant = () => {
    if (!selected) return;
    api.addVariant(selected.id, {
      name: vForm.name,
      promptId: vForm.promptId || undefined,
      model: vForm.model || undefined,
      weight: parseFloat(vForm.weight) || 0.5,
    }).then(() => {
      setShowVariant(false);
      setVForm({ name: '', promptId: '', model: '', weight: '0.5' });
      selectTest(selected.id);
      load();
    });
  };

  const setStatus = (status: string) => {
    if (!selected) return;
    api.setABTestStatus(selected.id, status).then(() => {
      selectTest(selected.id);
      load();
    });
  };

  const statusBadge = (status: string) => {
    const cls = status === 'running' ? 'badge-green' : status === 'stopped' ? 'badge-red' : status === 'completed' ? 'badge-blue' : 'badge-yellow';
    return <span class={`badge ${cls}`}><span class="badge-dot" /> {status}</span>;
  };

  return (
    <div>
      <div class="page-header">
        <div>
          <h2 class="page-title">A/B Tests</h2>
          <p class="page-desc">Compare prompt variants with traffic splitting</p>
        </div>
        <button class="btn btn-primary" onClick={() => setShowCreate(true)}>New Experiment</button>
      </div>

      <div style="display:grid; grid-template-columns: 260px 1fr; gap: 16px">
        <div class="card" style="padding:8px; max-height: 560px; overflow-y: auto">
          {tests.map((t: any) => (
            <button
              key={t.id}
              class={`nav-item ${selected?.id === t.id ? 'active' : ''}`}
              onClick={() => selectTest(t.id)}
              style="border-radius:6px"
            >
              <div>
                <div style="font-weight:500; color:var(--text)">{t.name}</div>
                <div style="font-size:11px; margin-top:2px">{statusBadge(t.status)}</div>
              </div>
            </button>
          ))}
          {tests.length === 0 && (
            <div class="empty-state" style="padding:32px 16px">
              <div class="empty-state-title">No experiments</div>
              <div class="empty-state-desc">Create one to get started</div>
            </div>
          )}
        </div>

        <div>
          {selected ? (
            <div class="card">
              <div class="flex-between mb-4">
                <div>
                  <div style="font-size:16px; font-weight:600">{selected.name}</div>
                  {selected.description && <div style="font-size:13px; color:var(--text-secondary); margin-top:2px">{selected.description}</div>}
                  <div style="margin-top:6px">{statusBadge(selected.status)}</div>
                </div>
                <div class="btn-group">
                  {selected.status === 'draft' && <button class="btn btn-primary btn-sm" onClick={() => setStatus('running')}>Start</button>}
                  {selected.status === 'running' && <button class="btn btn-warning btn-sm" onClick={() => setStatus('stopped')}>Stop</button>}
                  {selected.status === 'stopped' && (
                    <>
                      <button class="btn btn-primary btn-sm" onClick={() => setStatus('running')}>Resume</button>
                      <button class="btn btn-sm" onClick={() => setStatus('completed')}>Complete</button>
                    </>
                  )}
                  <button class="btn btn-sm" onClick={() => setShowVariant(true)}>Add Variant</button>
                </div>
              </div>

              <div class="section-title">Variants & Results</div>
              {results.length > 0 ? (
                <div style="border:1px solid var(--border); border-radius:8px; overflow:hidden">
                  <table>
                    <thead>
                      <tr>
                        <th>Variant</th><th>Weight</th><th>Requests</th>
                        <th>Avg Latency</th><th>Avg Cost</th><th>Total Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r: any) => (
                        <tr key={r.id}>
                          <td style="color:var(--text); font-weight:500">{r.name}</td>
                          <td>{((r.weight ?? 0) * 100).toFixed(0)}%</td>
                          <td>{r.total_requests ?? 0}</td>
                          <td>{(r.avg_latency_ms ?? 0).toFixed(0)}ms</td>
                          <td class="mono">${(r.avg_cost ?? 0).toFixed(4)}</td>
                          <td class="mono">${(r.total_cost ?? 0).toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div class="empty-state" style="padding:24px">
                  <div class="empty-state-desc">No variants yet. Add one to start testing.</div>
                </div>
              )}

              {analysis && analysis.comparison && (
                <div style="margin-top:16px">
                  <div class="section-title">Statistical Analysis</div>
                  <div style="border:1px solid var(--border); border-radius:8px; padding:16px">
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px">
                      <div>
                        <div style="font-size:12px; color:var(--text-tertiary); margin-bottom:4px">Latency</div>
                        <div style="font-size:13px">
                          {analysis.comparison.latencySignificant ? (
                            <span class="badge badge-green">Winner: {analysis.comparison.latencyWinner}</span>
                          ) : (
                            <span class="badge badge-gray">Not significant</span>
                          )}
                          <div class="mono" style="font-size:11px; margin-top:4px">p={analysis.comparison.latencyPValue}, z={analysis.comparison.latencyZScore}</div>
                        </div>
                      </div>
                      <div>
                        <div style="font-size:12px; color:var(--text-tertiary); margin-bottom:4px">Cost</div>
                        <div style="font-size:13px">
                          {analysis.comparison.costSignificant ? (
                            <span class="badge badge-green">Winner: {analysis.comparison.costWinner}</span>
                          ) : (
                            <span class="badge badge-gray">Not significant</span>
                          )}
                          <div class="mono" style="font-size:11px; margin-top:4px">p={analysis.comparison.costPValue}, z={analysis.comparison.costZScore}</div>
                        </div>
                      </div>
                    </div>
                    {analysis.variants && (
                      <div style="margin-top:12px">
                        {analysis.variants.map((v: any) => (
                          <div key={v.id} style="font-size:12px; color:var(--text-secondary); margin-top:4px">
                            {v.name}: n={v.sampleSize}, latency={v.meanLatencyMs}ms [{v.latencyCI[0]}-{v.latencyCI[1]}], cost=${v.meanCost} [{v.costCI[0]}-{v.costCI[1]}]
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div class="card">
              <div class="empty-state">
                <div class="empty-state-title">Select an experiment</div>
                <div class="empty-state-desc">Choose from the list to view details and results</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <div class="modal-overlay" onClick={() => setShowCreate(false)}>
          <div class="modal" onClick={(e: any) => e.stopPropagation()}>
            <div class="modal-title">New Experiment</div>
            <div class="form-group">
              <label class="form-label">Name</label>
              <input class="input" value={form.name} onInput={(e: any) => setForm({ ...form, name: e.target.value })} placeholder="GPT-4o vs Claude comparison" />
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

      {showVariant && (
        <div class="modal-overlay" onClick={() => setShowVariant(false)}>
          <div class="modal" onClick={(e: any) => e.stopPropagation()}>
            <div class="modal-title">Add Variant</div>
            <div class="form-group">
              <label class="form-label">Name</label>
              <input class="input" value={vForm.name} onInput={(e: any) => setVForm({ ...vForm, name: e.target.value })} placeholder="Variant A" />
            </div>
            <div class="form-group">
              <label class="form-label">Prompt <span style="color:var(--text-tertiary)">(optional)</span></label>
              <select class="input" value={vForm.promptId} onChange={(e: any) => setVForm({ ...vForm, promptId: e.target.value })}>
                <option value="">None</option>
                {prompts.map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.slug})</option>)}
              </select>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px">
              <div class="form-group">
                <label class="form-label">Model</label>
                <input class="input" value={vForm.model} onInput={(e: any) => setVForm({ ...vForm, model: e.target.value })} placeholder="gpt-4o" />
              </div>
              <div class="form-group">
                <label class="form-label">Weight (0-1)</label>
                <input class="input" type="number" step="0.1" min="0" max="1" value={vForm.weight} onInput={(e: any) => setVForm({ ...vForm, weight: e.target.value })} />
              </div>
            </div>
            <div class="btn-group mt-4" style="justify-content:flex-end">
              <button class="btn" onClick={() => setShowVariant(false)}>Cancel</button>
              <button class="btn btn-primary" onClick={addVariant} disabled={!vForm.name}>Add Variant</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Fallbacks() {
  const [chains, setChains] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState<any>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', providers: '', failureThreshold: '3', resetTimeoutMs: '60000' });
  const [editForm, setEditForm] = useState({ name: '', providers: '', failureThreshold: '3', resetTimeoutMs: '60000', enabled: true });

  const load = () => {
    Promise.all([api.listFallbackChains(), api.listProviders()])
      .then(([c, p]) => { setChains(c); setProviders(p); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const create = () => {
    setError('');
    const providerList = form.providers.split(',').map(s => s.trim()).filter(Boolean);
    api.createFallbackChain({
      name: form.name,
      providers: providerList,
      failureThreshold: parseInt(form.failureThreshold) || 3,
      resetTimeoutMs: parseInt(form.resetTimeoutMs) || 60000,
    }).then(() => {
      setShowCreate(false);
      setForm({ name: '', providers: '', failureThreshold: '3', resetTimeoutMs: '60000' });
      load();
    }).catch((err: any) => setError(err.message));
  };

  const openEdit = (chain: any) => {
    const provOrder = JSON.parse(chain.provider_order);
    setEditForm({
      name: chain.name,
      providers: provOrder.join(', '),
      failureThreshold: String(chain.failure_threshold),
      resetTimeoutMs: String(chain.reset_timeout_ms),
      enabled: !!chain.enabled,
    });
    setShowEdit(chain);
    setError('');
  };

  const saveEdit = () => {
    setError('');
    const providerList = editForm.providers.split(',').map(s => s.trim()).filter(Boolean);
    api.updateFallbackChain(showEdit.id, {
      name: editForm.name,
      providers: providerList,
      failureThreshold: parseInt(editForm.failureThreshold) || 3,
      resetTimeoutMs: parseInt(editForm.resetTimeoutMs) || 60000,
      enabled: editForm.enabled,
    }).then(() => {
      setShowEdit(null);
      load();
    }).catch((err: any) => setError(err.message));
  };

  const remove = (id: string, name: string) => {
    if (!confirm(`Delete fallback chain "${name}"?`)) return;
    api.deleteFallbackChain(id).then(load);
  };

  const toggleEnabled = (chain: any) => {
    api.updateFallbackChain(chain.id, { enabled: !chain.enabled }).then(load);
  };

  return (
    <div>
      <div class="page-header">
        <div>
          <h2 class="page-title">Fallback Chains</h2>
          <p class="page-desc">Configure provider failover order and circuit breaker settings</p>
        </div>
        <button class="btn btn-primary" onClick={() => setShowCreate(true)}>Create Chain</button>
      </div>

      <div style="font-size:12px; color:var(--text-tertiary); margin-bottom:12px">
        Available providers: {providers.map(p => p.name).join(', ') || 'none'}
      </div>

      {loading ? <div class="empty">Loading...</div> : chains.length === 0 ? (
        <div class="card">
          <div class="empty-state">
            <div class="empty-state-icon">{'\u21C5'}</div>
            <div class="empty-state-title">No fallback chains</div>
            <div class="empty-state-desc">Create a chain to configure provider failover</div>
          </div>
        </div>
      ) : (
        <div class="card" style="padding:0; overflow:hidden">
          <table>
            <thead>
              <tr><th>Name</th><th>Provider Order</th><th>Threshold</th><th>Timeout</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {chains.map((c: any) => {
                const order = JSON.parse(c.provider_order);
                return (
                  <tr key={c.id}>
                    <td style="color:var(--text); font-weight:500">{c.name}</td>
                    <td>
                      <span class="mono" style="font-size:11px">{order.join(' \u2192 ')}</span>
                    </td>
                    <td>{c.failure_threshold} failures</td>
                    <td>{(c.reset_timeout_ms / 1000).toFixed(0)}s</td>
                    <td>
                      <span class={`badge ${c.enabled ? 'badge-green' : 'badge-gray'}`} style="cursor:pointer" onClick={() => toggleEnabled(c)}>
                        <span class="badge-dot" /> {c.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td style="text-align:right">
                      <div class="btn-group" style="justify-content:flex-end">
                        <button class="btn btn-sm" onClick={() => openEdit(c)}>Edit</button>
                        <button class="btn btn-danger btn-sm" onClick={() => remove(c.id, c.name)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div class="modal-overlay" onClick={() => { setShowCreate(false); setError(''); }}>
          <div class="modal" onClick={(e: any) => e.stopPropagation()}>
            <div class="modal-title">Create Fallback Chain</div>
            {error && <div style="color:var(--danger); font-size:13px; margin-bottom:12px">{error}</div>}
            <div class="form-group">
              <label class="form-label">Name</label>
              <input class="input" value={form.name} onInput={(e: any) => setForm({ ...form, name: e.target.value })} placeholder="primary-chain" />
            </div>
            <div class="form-group">
              <label class="form-label">Providers <span style="color:var(--text-tertiary)">(comma-separated, in order)</span></label>
              <input class="input" value={form.providers} onInput={(e: any) => setForm({ ...form, providers: e.target.value })} placeholder="openai, anthropic, google" />
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px">
              <div class="form-group">
                <label class="form-label">Failure Threshold</label>
                <input class="input" type="number" value={form.failureThreshold} onInput={(e: any) => setForm({ ...form, failureThreshold: e.target.value })} />
              </div>
              <div class="form-group">
                <label class="form-label">Reset Timeout (ms)</label>
                <input class="input" type="number" value={form.resetTimeoutMs} onInput={(e: any) => setForm({ ...form, resetTimeoutMs: e.target.value })} />
              </div>
            </div>
            <div class="btn-group mt-4" style="justify-content:flex-end">
              <button class="btn" onClick={() => { setShowCreate(false); setError(''); }}>Cancel</button>
              <button class="btn btn-primary" onClick={create} disabled={!form.name || !form.providers}>Create</button>
            </div>
          </div>
        </div>
      )}

      {showEdit && (
        <div class="modal-overlay" onClick={() => { setShowEdit(null); setError(''); }}>
          <div class="modal" onClick={(e: any) => e.stopPropagation()}>
            <div class="modal-title">Edit Fallback Chain</div>
            {error && <div style="color:var(--danger); font-size:13px; margin-bottom:12px">{error}</div>}
            <div class="form-group">
              <label class="form-label">Name</label>
              <input class="input" value={editForm.name} onInput={(e: any) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div class="form-group">
              <label class="form-label">Providers <span style="color:var(--text-tertiary)">(comma-separated, in order)</span></label>
              <input class="input" value={editForm.providers} onInput={(e: any) => setEditForm({ ...editForm, providers: e.target.value })} />
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px">
              <div class="form-group">
                <label class="form-label">Failure Threshold</label>
                <input class="input" type="number" value={editForm.failureThreshold} onInput={(e: any) => setEditForm({ ...editForm, failureThreshold: e.target.value })} />
              </div>
              <div class="form-group">
                <label class="form-label">Reset Timeout (ms)</label>
                <input class="input" type="number" value={editForm.resetTimeoutMs} onInput={(e: any) => setEditForm({ ...editForm, resetTimeoutMs: e.target.value })} />
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Enabled</label>
              <button class={`toggle ${editForm.enabled ? 'active' : ''}`} onClick={() => setEditForm({ ...editForm, enabled: !editForm.enabled })} />
            </div>
            <div class="btn-group mt-4" style="justify-content:flex-end">
              <button class="btn" onClick={() => { setShowEdit(null); setError(''); }}>Cancel</button>
              <button class="btn btn-primary" onClick={saveEdit}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Settings() {
  const [status, setStatus] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.systemStatus().then(setStatus).catch(() => {});
    api.getSettings().then(setSettings).catch(() => {});
  }, []);

  const updateField = (section: string, field: string, value: any) => {
    setSettings((s: any) => ({
      ...s,
      [section]: { ...s[section], [field]: value },
    }));
    setSaved(false);
  };

  const save = () => {
    setSaving(true);
    api.updateSettings(settings).then(() => {
      setSaving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }).catch(() => setSaving(false));
  };

  return (
    <div>
      <div class="page-header">
        <div>
          <h2 class="page-title">Settings</h2>
          <p class="page-desc">System configuration and maintenance</p>
        </div>
        <div class="btn-group">
          {saved && <span style="font-size:12px; color:var(--success)">Saved!</span>}
          <button class="btn btn-primary" onClick={save} disabled={saving || !settings}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">System</div>
        <div class="kv-grid">
          <div class="kv-item">
            <div class="kv-label">Version</div>
            <div class="kv-value">{status?.version ?? '-'}</div>
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

      {settings && (
        <>
          <div class="section">
            <div class="section-title">Cache</div>
            <div class="card">
              <div class="flex-between mb-4">
                <div>
                  <div style="font-weight:500; font-size:13px">Semantic Cache</div>
                  <div style="font-size:12px; color:var(--text-tertiary)">Cache similar requests to reduce costs and latency</div>
                </div>
                <button class={`toggle ${settings.cache.enabled ? 'active' : ''}`} onClick={() => updateField('cache', 'enabled', !settings.cache.enabled)} />
              </div>
              <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px">
                <div class="form-group" style="margin-bottom:0">
                  <label class="form-label">Similarity Threshold</label>
                  <input class="input" type="number" step="0.01" min="0" max="1" value={settings.cache.similarityThreshold} onInput={(e: any) => updateField('cache', 'similarityThreshold', parseFloat(e.target.value))} />
                </div>
                <div class="form-group" style="margin-bottom:0">
                  <label class="form-label">Max Entries</label>
                  <input class="input" type="number" value={settings.cache.maxEntries} onInput={(e: any) => updateField('cache', 'maxEntries', parseInt(e.target.value))} />
                </div>
                <div class="form-group" style="margin-bottom:0">
                  <label class="form-label">TTL (seconds)</label>
                  <input class="input" type="number" value={settings.cache.ttlSeconds} onInput={(e: any) => updateField('cache', 'ttlSeconds', parseInt(e.target.value))} />
                </div>
              </div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Rate Limiting</div>
            <div class="card">
              <div class="flex-between mb-4">
                <div>
                  <div style="font-weight:500; font-size:13px">Rate Limits</div>
                  <div style="font-size:12px; color:var(--text-tertiary)">Limit requests and tokens per minute</div>
                </div>
                <button class={`toggle ${settings.rateLimit.enabled ? 'active' : ''}`} onClick={() => updateField('rateLimit', 'enabled', !settings.rateLimit.enabled)} />
              </div>
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px">
                <div class="form-group" style="margin-bottom:0">
                  <label class="form-label">Requests Per Minute</label>
                  <input class="input" type="number" value={settings.rateLimit.requestsPerMinute} onInput={(e: any) => updateField('rateLimit', 'requestsPerMinute', parseInt(e.target.value))} />
                </div>
                <div class="form-group" style="margin-bottom:0">
                  <label class="form-label">Tokens Per Minute</label>
                  <input class="input" type="number" value={settings.rateLimit.tokensPerMinute} onInput={(e: any) => updateField('rateLimit', 'tokensPerMinute', parseInt(e.target.value))} />
                </div>
              </div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Guardrails</div>
            <div class="card">
              <div class="flex-between mb-4">
                <div>
                  <div style="font-weight:500; font-size:13px">Safety Guardrails</div>
                  <div style="font-size:12px; color:var(--text-tertiary)">Content filtering and PII detection</div>
                </div>
                <button class={`toggle ${settings.guardrails.enabled ? 'active' : ''}`} onClick={() => updateField('guardrails', 'enabled', !settings.guardrails.enabled)} />
              </div>
              <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px">
                <div class="form-group" style="margin-bottom:0">
                  <label class="form-label">PII Detection</label>
                  <button class={`toggle ${settings.guardrails.piiDetection ? 'active' : ''}`} onClick={() => updateField('guardrails', 'piiDetection', !settings.guardrails.piiDetection)} />
                </div>
                <div class="form-group" style="margin-bottom:0">
                  <label class="form-label">Content Filter</label>
                  <button class={`toggle ${settings.guardrails.contentFilter ? 'active' : ''}`} onClick={() => updateField('guardrails', 'contentFilter', !settings.guardrails.contentFilter)} />
                </div>
                <div class="form-group" style="margin-bottom:0">
                  <label class="form-label">Max Tokens</label>
                  <input class="input" type="number" value={settings.guardrails.maxTokens} onInput={(e: any) => updateField('guardrails', 'maxTokens', parseInt(e.target.value))} />
                </div>
              </div>
            </div>
          </div>
        </>
      )}

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

// ---- Audit Log ----
function AuditLog() {
  const [entries, setEntries] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ action: '', resource_type: '' });

  const load = () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (filter.action) params.action = filter.action;
    if (filter.resource_type) params.resource_type = filter.resource_type;
    api.getAuditLog(params)
      .then((res: any) => { setEntries(res.entries || []); setTotal(res.total || 0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [filter.action, filter.resource_type]);

  return (
    <div>
      <div class="page-header">
        <div>
          <h2 class="page-title">Audit Log</h2>
          <p class="page-desc">Track all administrative actions ({total} total entries)</p>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div style="display:flex; gap:12px; align-items:center">
          <select class="input" style="width:auto" value={filter.action} onChange={(e: any) => setFilter({ ...filter, action: e.target.value })}>
            <option value="">All actions</option>
            <option value="create">Create</option>
            <option value="update">Update</option>
            <option value="delete">Delete</option>
            <option value="revoke">Revoke</option>
            <option value="activate">Activate</option>
            <option value="rotate">Rotate</option>
            <option value="settings_change">Settings Change</option>
          </select>
          <select class="input" style="width:auto" value={filter.resource_type} onChange={(e: any) => setFilter({ ...filter, resource_type: e.target.value })}>
            <option value="">All resources</option>
            <option value="provider">Provider</option>
            <option value="api_key">API Key</option>
            <option value="prompt">Prompt</option>
            <option value="fallback_chain">Fallback Chain</option>
            <option value="ab_test">A/B Test</option>
            <option value="settings">Settings</option>
          </select>
        </div>
      </div>

      {loading ? <div class="empty">Loading...</div> : entries.length === 0 ? (
        <div class="card">
          <div class="empty-state">
            <div class="empty-state-icon">{'\u{1F4CB}'}</div>
            <div class="empty-state-title">No audit entries</div>
            <div class="empty-state-desc">Admin actions will be logged here</div>
          </div>
        </div>
      ) : (
        <div class="card" style="padding:0; overflow:hidden">
          <table>
            <thead>
              <tr>
                <th>Time</th><th>Action</th><th>Resource</th><th>Resource ID</th><th>Actor</th><th>Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e: any) => (
                <tr key={e.id}>
                  <td style="font-size:12px; color:var(--text-tertiary); white-space:nowrap">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td>
                    <span class={`badge ${e.action === 'delete' || e.action === 'revoke' ? 'badge-red' : e.action === 'create' ? 'badge-green' : 'badge-blue'}`}>
                      {e.action}
                    </span>
                  </td>
                  <td style="font-size:12px">{e.resource_type}</td>
                  <td class="mono" style="font-size:11px">{e.resource_id ? e.resource_id.slice(0, 12) : '-'}</td>
                  <td style="font-size:12px">{e.actor ?? 'system'}</td>
                  <td class="mono" style="font-size:11px; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">
                    {e.details ?? '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Main App ----

type Page = 'dashboard' | 'providers' | 'api-keys' | 'logs' | 'prompts' | 'budgets' | 'ab-tests' | 'fallbacks' | 'settings' | 'audit-log';

function App() {
  const [page, setPage] = useState<Page>('dashboard');

  const pages: Record<Page, { label: string; component: (props: { onNavigate: (p: string) => void }) => any }> = {
    dashboard: { label: 'Overview', component: ({ onNavigate }) => <Dashboard onNavigate={onNavigate} /> },
    providers: { label: 'Providers', component: () => <Providers /> },
    'api-keys': { label: 'API Keys', component: () => <ApiKeys /> },
    logs: { label: 'Logs', component: () => <Logs /> },
    prompts: { label: 'Prompts', component: () => <Prompts /> },
    budgets: { label: 'Budgets', component: () => <Budgets /> },
    'ab-tests': { label: 'Experiments', component: () => <ABTests /> },
    fallbacks: { label: 'Fallbacks', component: () => <Fallbacks /> },
    settings: { label: 'Settings', component: () => <Settings /> },
    'audit-log': { label: 'Audit Log', component: () => <AuditLog /> },
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
