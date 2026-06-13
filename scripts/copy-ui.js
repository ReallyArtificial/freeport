// Copies the built admin UI into dist/admin-ui so it ships in the npm package
// and resolves at runtime relative to the compiled server module (not cwd).
import { cpSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const src = resolve('admin-ui', 'dist');
const dest = resolve('dist', 'admin-ui');

if (!existsSync(src)) {
  console.error('admin-ui/dist not found — run "npm run build:ui" first.');
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`Copied admin UI: ${src} -> ${dest}`);
