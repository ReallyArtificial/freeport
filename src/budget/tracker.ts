import { getDb } from '../db/connection.js';
import { calculateCost } from './pricing.js';

export interface SpendRecord {
  projectId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export function trackSpend(record: SpendRecord): number {
  const cost = calculateCost(record.model, record.inputTokens, record.outputTokens);
  if (!record.projectId) return cost;

  const db = getDb();

  // Atomically update both tables in a single transaction
  const updateSpend = db.transaction((projectId: string, amount: number) => {
    db.prepare(`
      UPDATE projects SET budget_spent = budget_spent + ? WHERE id = ?
    `).run(amount, projectId);

    db.prepare(`
      UPDATE budgets
      SET monthly_spent = monthly_spent + ?,
          daily_spent = daily_spent + ?,
          updated_at = datetime('now')
      WHERE project_id = ?
    `).run(amount, amount, projectId);
  });

  updateSpend(record.projectId, cost);

  return cost;
}

export function getProjectSpend(projectId: string): {
  monthlySpent: number;
  dailySpent: number;
  monthlyLimit: number | null;
  dailyLimit: number | null;
} {
  const db = getDb();
  const row = db.prepare(`
    SELECT monthly_spent, daily_spent, monthly_limit, daily_limit
    FROM budgets WHERE project_id = ?
  `).get(projectId) as Record<string, unknown> | undefined;

  if (!row) {
    return { monthlySpent: 0, dailySpent: 0, monthlyLimit: null, dailyLimit: null };
  }

  return {
    monthlySpent: row.monthly_spent as number,
    dailySpent: row.daily_spent as number,
    monthlyLimit: row.monthly_limit as number | null,
    dailyLimit: row.daily_limit as number | null,
  };
}

export function resetDailyBudgets(): void {
  const db = getDb();
  db.prepare(`
    UPDATE budgets SET daily_spent = 0, daily_reset_at = datetime('now')
  `).run();
}

export function resetMonthlyBudgets(): void {
  const db = getDb();
  db.prepare(`
    UPDATE budgets SET monthly_spent = 0, monthly_reset_at = datetime('now')
  `).run();
}
