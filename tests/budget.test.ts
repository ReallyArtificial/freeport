import { describe, it, expect } from 'vitest';
import { getDb } from '../src/db/connection.js';
import { trackSpend, getProjectSpend } from '../src/budget/tracker.js';
import { checkBudget, setKillSwitch } from '../src/budget/enforcer.js';
import { calculateCost, getModelPricing } from '../src/budget/pricing.js';

describe('Pricing', () => {
  it('calculates cost for known models', () => {
    const cost = calculateCost('gpt-4o-mini', 1000, 500);
    // input: 0.15 per 1M, output: 0.60 per 1M
    const expected = (1000 * 0.15 + 500 * 0.60) / 1_000_000;
    expect(cost).toBeCloseTo(expected, 10);
  });

  it('uses default pricing for unknown models', () => {
    const cost = calculateCost('some-unknown-model', 1000, 500);
    const expected = (1000 * 5 + 500 * 15) / 1_000_000;
    expect(cost).toBeCloseTo(expected, 10);
  });

  it('returns pricing info for known models', () => {
    const pricing = getModelPricing('gpt-4o');
    expect(pricing).toBeDefined();
    expect(pricing!.input).toBe(2.50);
    expect(pricing!.output).toBe(10.00);
  });

  it('returns undefined for unknown models', () => {
    expect(getModelPricing('nonexistent-model')).toBeUndefined();
  });
});

describe('Budget Tracker', () => {
  function createTestProject(id: string = 'test-project') {
    const db = getDb();
    db.prepare("INSERT INTO projects (id, name) VALUES (?, ?)").run(id, 'Test Project');
    db.prepare("INSERT INTO budgets (project_id, monthly_limit, daily_limit) VALUES (?, ?, ?)").run(id, 10.0, 1.0);
  }

  it('tracks spend and updates both tables atomically', () => {
    createTestProject();

    const cost = trackSpend({
      projectId: 'test-project',
      model: 'gpt-4o-mini',
      inputTokens: 1000,
      outputTokens: 500,
    });

    expect(cost).toBeGreaterThan(0);

    const spend = getProjectSpend('test-project');
    expect(spend.monthlySpent).toBeCloseTo(cost, 10);
    expect(spend.dailySpent).toBeCloseTo(cost, 10);
    expect(spend.monthlyLimit).toBe(10.0);
    expect(spend.dailyLimit).toBe(1.0);
  });

  it('returns zero spend for unknown project', () => {
    const spend = getProjectSpend('nonexistent');
    expect(spend.monthlySpent).toBe(0);
    expect(spend.dailySpent).toBe(0);
    expect(spend.monthlyLimit).toBeNull();
    expect(spend.dailyLimit).toBeNull();
  });

  it('returns cost without tracking when no projectId', () => {
    const cost = trackSpend({
      model: 'gpt-4o-mini',
      inputTokens: 1000,
      outputTokens: 500,
    });
    expect(cost).toBeGreaterThan(0);
  });
});

describe('Budget Enforcer', () => {
  function createProjectWithBudget(id: string, monthly: number, daily: number) {
    const db = getDb();
    db.prepare("INSERT INTO projects (id, name) VALUES (?, ?)").run(id, 'Test');
    db.prepare("INSERT INTO budgets (project_id, monthly_limit, daily_limit, monthly_spent, daily_spent) VALUES (?, ?, ?, 0, 0)").run(id, monthly, daily);
  }

  it('allows requests within budget', () => {
    createProjectWithBudget('within', 100, 10);
    // Should not throw
    expect(() => checkBudget('within')).not.toThrow();
  });

  it('throws when monthly budget exceeded in hard mode', () => {
    const db = getDb();
    createProjectWithBudget('over-monthly', 1.0, 100);
    db.prepare("UPDATE budgets SET monthly_spent = 1.5 WHERE project_id = ?").run('over-monthly');

    expect(() => checkBudget('over-monthly', 'hard')).toThrow('Monthly budget exceeded');
  });

  it('throws when daily budget exceeded in hard mode', () => {
    const db = getDb();
    createProjectWithBudget('over-daily', 100, 1.0);
    db.prepare("UPDATE budgets SET daily_spent = 1.5 WHERE project_id = ?").run('over-daily');

    expect(() => checkBudget('over-daily', 'hard')).toThrow('Daily budget exceeded');
  });

  it('does not throw in warn mode', () => {
    const db = getDb();
    createProjectWithBudget('warn-mode', 1.0, 1.0);
    db.prepare("UPDATE budgets SET monthly_spent = 5, daily_spent = 5 WHERE project_id = ?").run('warn-mode');

    expect(() => checkBudget('warn-mode', 'warn')).not.toThrow();
  });

  it('allows requests with no budget set', () => {
    expect(() => checkBudget('no-budget-project')).not.toThrow();
  });

  it('blocks requests when kill switch is active', () => {
    createProjectWithBudget('kill-me', 100, 100);
    setKillSwitch('kill-me', true);

    expect(() => checkBudget('kill-me')).toThrow('kill switch');
  });

  it('resumes when kill switch is deactivated', () => {
    createProjectWithBudget('resume-me', 100, 100);
    setKillSwitch('resume-me', true);
    setKillSwitch('resume-me', false);

    expect(() => checkBudget('resume-me')).not.toThrow();
  });
});
