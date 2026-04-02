import { getDb } from '../connection.js';

export function ensureDefaultProject(): string {
  const db = getDb();

  const existing = db.prepare("SELECT id FROM projects WHERE name = 'default'").get() as { id: string } | undefined;
  if (existing) return existing.id;

  const row = db.prepare(`
    INSERT INTO projects (name, description) VALUES ('default', 'Default project')
    RETURNING id
  `).get() as { id: string };

  return row.id;
}

export function getProject(id: string) {
  const db = getDb();
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
}

export function listProjects() {
  const db = getDb();
  return db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
}
