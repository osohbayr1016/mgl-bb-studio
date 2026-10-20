#!/usr/bin/env node
// =============================================================
// bootstrap-local-db.mjs — build the LOCAL (miniflare) D1 from scratch
// =============================================================
// Why this exists instead of `wrangler d1 migrations apply --local`:
//
// `0136_worker_role.sql` rebuilds `users` (CREATE → INSERT → DROP →
// RENAME) because SQLite cannot rewrite a CHECK in place. Miniflare's
// `--local` path runs each migration file inside a transaction with
// `PRAGMA foreign_keys = 1`, where `PRAGMA foreign_keys = OFF` is
// silently a no-op — so `DROP TABLE users` performs the implicit
// `DELETE FROM users` and cascades through the ~40 child tables
// (attendance_sessions, progress_entries, user_points, notifications…).
// That is the same trap documented in 0136's own header for production,
// where the sanctioned workaround is the non-transactional
// `d1 execute --file` path.
//
// The local equivalent, per CLAUDE.md, is to drive
// `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite` directly
// with `node:sqlite`. That is what this script does: it applies every
// migration in filename order, outside any transaction, with foreign
// keys OFF, and maintains `d1_migrations` bookkeeping itself so a later
// `wrangler d1 migrations apply --local` correctly sees everything as
// already applied.
//
// Usage (from backend/):
//   node scripts/bootstrap-local-db.mjs           # apply what's pending
//   node scripts/bootstrap-local-db.mjs --reset   # wipe, then apply all
// =============================================================

import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wranglerNames } from './wranglerNames.mjs';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(backendDir, 'migrations');
const stateDir = path.join(
  backendDir,
  '.wrangler',
  'state',
  'v3',
  'd1',
  'miniflare-D1DatabaseObject',
);

const reset = process.argv.includes('--reset');

function findDbFile() {
  if (!fs.existsSync(stateDir)) return null;
  const f = fs
    .readdirSync(stateDir)
    .filter((n) => n.endsWith('.sqlite') && n !== 'metadata.sqlite')
    .sort();
  return f.length ? path.join(stateDir, f[0]) : null;
}

if (reset && fs.existsSync(stateDir)) {
  for (const n of fs.readdirSync(stateDir)) {
    if (n.startsWith('metadata.sqlite')) continue;
    fs.rmSync(path.join(stateDir, n));
  }
  console.log('• local D1 wiped');
}

// Let wrangler create the miniflare database file (and its internal
// bookkeeping) if it isn't there — we only want to *write* to a store
// miniflare already understands, never to invent one.
if (!findDbFile()) {
  console.log('• creating local D1 via wrangler…');
  execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      wranglerNames().databaseName,
      '--local',
      '--config',
      'wrangler.toml',
      '--command',
      'SELECT 1',
    ],
    { cwd: backendDir, stdio: 'ignore' },
  );
}

const dbFile = findDbFile();
if (!dbFile) {
  console.error('✘ could not locate the local D1 sqlite file under', stateDir);
  process.exit(1);
}

const db = new DatabaseSync(dbFile);
// Must be set outside a transaction to have any effect — this is the
// whole point of the script.
db.exec('PRAGMA foreign_keys = OFF');
db.exec(`CREATE TABLE IF NOT EXISTS d1_migrations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);

const applied = new Set(db.prepare('SELECT name FROM d1_migrations').all().map((r) => r.name));
// Filename order — the same order wrangler uses. Note the repo has
// several duplicate numeric prefixes (0002, 0060, 0080, 0110, 0120,
// 0121); ordering within a pair is therefore alphabetical, which is
// why 0080_report_template_team_code.sql creates its parent table
// defensively.
const files = fs
  .readdirSync(migrationsDir)
  .filter((n) => n.endsWith('.sql'))
  .sort();

const record = db.prepare('INSERT INTO d1_migrations (name) VALUES (?)');
let count = 0;
for (const name of files) {
  if (applied.has(name)) continue;
  const sql = fs.readFileSync(path.join(migrationsDir, name), 'utf8');
  if (!sql.trim()) {
    record.run(name);
    continue;
  }
  try {
    db.exec(sql);
  } catch (err) {
    console.error(`\n✘ ${name} failed:\n  ${err.message}\n`);
    process.exit(1);
  }
  record.run(name);
  count++;
  if (count % 25 === 0) console.log(`  …${count} applied (at ${name})`);
}

const tables = db
  .prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'")
  .get().n;
const users = db.prepare('SELECT COUNT(*) n FROM users').get().n;
const fkBroken = db.prepare('PRAGMA foreign_key_check').all().length;

console.log(`\n✓ ${count} migration(s) applied — ${tables} tables, ${users} users`);
console.log(fkBroken === 0 ? '✓ foreign_key_check clean' : `✘ ${fkBroken} FK violations`);
db.close();
