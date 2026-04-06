const BASE = '';

async function request(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...opts?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(err.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  // System
  health: () => request('/health'),
  systemStatus: () => request('/api/system/status'),

  // Logs
  getLogs: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request(`/api/logs${qs}`);
  },
  getLogStats: (projectId?: string) => {
    const qs = projectId ? `?project_id=${projectId}` : '';
    return request(`/api/logs/stats${qs}`);
  },

  // Prompts
  listPrompts: () => request('/api/prompts'),
  getPrompt: (id: string) => request(`/api/prompts/${id}`),
  createPrompt: (data: { slug: string; name: string; description?: string }) =>
    request('/api/prompts', { method: 'POST', body: JSON.stringify(data) }),
  updatePrompt: (id: string, data: { name?: string; description?: string }) =>
    request(`/api/prompts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePrompt: (id: string) =>
    request(`/api/prompts/${id}`, { method: 'DELETE' }),

  createVersion: (promptId: string, data: {
    content: string; model?: string; temperature?: number;
    maxTokens?: number; systemPrompt?: string; variables?: string[];
    tag?: string;
  }) => request(`/api/prompts/${promptId}/versions`, { method: 'POST', body: JSON.stringify(data) }),
  tagVersion: (versionId: string, tag: string) =>
    request(`/api/prompts/versions/${versionId}/tag`, {
      method: 'PUT', body: JSON.stringify({ tag }),
    }),
  resolvePrompt: (slug: string, variables?: Record<string, string>) =>
    request('/api/prompts/resolve', { method: 'POST', body: JSON.stringify({ slug, variables }) }),

  // Projects
  listProjects: () => request('/api/projects'),
  createProject: (data: { name: string; description?: string; budgetLimit?: number }) =>
    request('/api/projects', { method: 'POST', body: JSON.stringify(data) }),

  // Budgets
  getBudget: (projectId: string) => request(`/api/budgets/${projectId}`),
  setBudget: (projectId: string, data: { monthlyLimit?: number; dailyLimit?: number }) =>
    request(`/api/budgets/${projectId}`, { method: 'POST', body: JSON.stringify(data) }),
  resetBudget: (projectId: string) =>
    request(`/api/budgets/${projectId}/reset`, { method: 'POST' }),
  killSwitch: (projectId: string, killed: boolean) =>
    request(`/api/budgets/${projectId}/kill`, { method: 'POST', body: JSON.stringify({ killed }) }),

  // A/B Tests
  listABTests: () => request('/api/ab-tests'),
  getABTest: (id: string) => request(`/api/ab-tests/${id}`),
  createABTest: (data: { name: string; description?: string }) =>
    request('/api/ab-tests', { method: 'POST', body: JSON.stringify(data) }),
  addVariant: (testId: string, data: { name: string; promptId?: string; model?: string; weight?: number }) =>
    request(`/api/ab-tests/${testId}/variants`, { method: 'POST', body: JSON.stringify(data) }),
  setABTestStatus: (id: string, status: string) =>
    request(`/api/ab-tests/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),

  // Providers
  listProviders: () => request('/api/providers'),
  createProvider: (data: {
    name: string; type: string; apiBase?: string;
    apiKey: string; models?: string[]; enabled?: boolean;
  }) => request('/api/providers', { method: 'POST', body: JSON.stringify(data) }),
  updateProvider: (id: string, data: {
    name?: string; type?: string; apiBase?: string | null;
    apiKey?: string; models?: string[]; enabled?: boolean;
  }) => request(`/api/providers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProvider: (id: string) =>
    request(`/api/providers/${id}`, { method: 'DELETE' }),

  // Cache
  clearCache: () => request('/api/system/cache/clear', { method: 'POST' }),
};
