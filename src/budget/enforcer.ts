import { getDb } from '../db/connection.js';
import { BudgetExceededError } from '../utils/errors.js';
import { getLogger } from '../logging/logger.js';

export function checkBudget(projectId: string, enforcementMode: string = 'hard'): void {
  const db = getDb();
  const log = getLogger();

  const budget = db.prepare(`
    SELECT monthly_spent, daily_spent, monthly_limit, daily_limit, is_killed
    FROM budgets WHERE project_id = ?
  `).get(projectId) as Record<string, unknown> | undefined;

  if (!budget) return; // No budget set, allow

  // Kill switch
  if (budget.is_killed === 1) {
    throw new BudgetExceededError('Project budget kill switch is active');
  }

  // Check monthly limit
  if (budget.monthly_limit !== null && (budget.monthly_spent as number) >= (budget.monthly_limit as number)) {
    const msg = `Monthly budget exceeded: $${(budget.monthly_spent as number).toFixed(2)} / $${(budget.monthly_limit as number).toFixed(2)}`;
    if (enforcementMode === 'hard') {
      throw new BudgetExceededError(msg);
    }
    log.warn({ projectId, spent: budget.monthly_spent, limit: budget.monthly_limit }, msg);
  }

  // Check daily limit
  if (budget.daily_limit !== null && (budget.daily_spent as number) >= (budget.daily_limit as number)) {
    const msg = `Daily budget exceeded: $${(budget.daily_spent as number).toFixed(2)} / $${(budget.daily_limit as number).toFixed(2)}`;
    if (enforcementMode === 'hard') {
      throw new BudgetExceededError(msg);
    }
    log.warn({ projectId, spent: budget.daily_spent, limit: budget.daily_limit }, msg);
  }
}

/** Toggle kill switch for a project */
export function setKillSwitch(projectId: string, killed: boolean): void {
  const db = getDb();
  db.prepare(`
    UPDATE budgets SET is_killed = ?, updated_at = datetime('now') WHERE project_id = ?
  `).run(killed ? 1 : 0, projectId);
}
