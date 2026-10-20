// Таскийн хуваарилалтын интеграцийн тестийн ЦАГ: бодит SQLite (node:sqlite) + бодит миграц файлууд + D1 shim.
// `src/**/*.test.ts`-ээс импортлоно.  tsc-ийн `include`-ээс гадуур (backend/src биш) тул Node төрөл шаардахгүй.
//
// D1 шиг: `bind` шинэ statement, `batch` = НЭГ транзакц (алдаа → ROLLBACK), RETURNING мөр `results`-д.
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

export function d1Shim(db: DatabaseSync): D1Database {
  const exec = (sql: string, params: unknown[]) => {
    if (/\bRETURNING\b/i.test(sql)) {
      const rows = db.prepare(sql).all(...(params as never[]));
      return { results: rows, meta: { last_row_id: 0, changes: rows.length } };
    }
    const r = db.prepare(sql).run(...(params as never[]));
    return { results: [], meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
  };
  const prepare = (sql: string, params: unknown[] = []) => {
    const stmt = {
      bind(...args: unknown[]) {
        // Бодит D1: нэг statement-д ХАМГИЙН ИХДЭЭ 100 bind параметр.  SQLite өөрөө 32766 хүртэл зөвшөөрдөг тул энд
        // зориуд хатуу болгов — IN (?,?,…) жагсаалтыг хэсэглээгүй код энд унана (прод дээр «too many SQL variables»).
        if (args.length > 100) throw new Error(`D1: too many SQL variables (${args.length} > 100)`);
        return prepare(sql, args);
      },
      async all() {
        return { results: db.prepare(sql).all(...(params as never[])) };
      },
      async first() {
        return db.prepare(sql).get(...(params as never[])) ?? null;
      },
      async run() {
        return exec(sql, params);
      },
      runSync: () => exec(sql, params),
    };
    return stmt;
  };
  return {
    prepare,
    async batch(stmts: Array<ReturnType<typeof prepare>>) {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => s.runSync());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as D1Database;
}

export const USERS = { CEO: 2, A: 3, B: 4, C: 5, SENIOR: 8, ADMIN: 9 } as const;
export const ROLE: Record<number, string> = { 2: 'admin', 3: 'engineer', 4: 'engineer', 5: 'architect', 8: 'senior', 9: 'admin' };
export const actorOf = (id: number) => ({ sub: id, role: ROLE[id] ?? 'engineer' });

const MIGRATIONS = [
  '0361_task_timer.sql',
  '0368_task_live_take.sql',
  '0370_task_personal_list.sql',
  '0376_task_allocations.sql',
  '0377_task_contributions.sql',
  '0378_allocation_ledger_links.sql',
  '0379_task_timer_voids.sql',
  '0380_task_timer_task_index.sql',
  '0383_task_alloc_hardening.sql',
  '0384_task_alloc_gate.sql',
  '0385_task_conversions.sql',
  '0393_task_allocation_label.sql',
  '0394_task_parts.sql',
];

/**
 * Төсөл 10 (идэвхтэй, AZ): нэг баг 100%, нэг блок/зураг 100 → таск 501 (жин 10) бүтэн 100% = төслийн 10%.
 * complexity_pct 100 → оноо = төслийн Δ%.  Таск: 501 (10), 502 (20), 503 (0 — хурлын даалгавар), 504 (10).
 * Төсөл 20 = цагаар бодогддог ZA.  Хэрэглэгч 3,4 (engineer), 5 (architect), 8 (senior), 2 (CEO admin), 9 (admin).
 */
export function makeDb(opts: { today?: string; state?: 'disabled' | 'enabled' | 'paused' | null } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, full_name TEXT, role TEXT,
      status TEXT DEFAULT 'active', is_support INTEGER DEFAULT 0, profile_image TEXT,
      employee_id TEXT, attendance_unrestricted INTEGER DEFAULT 0);
    CREATE TABLE attendance_sessions (id INTEGER PRIMARY KEY, user_id INTEGER, date TEXT,
      clock_in TEXT, clock_out TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      category TEXT, progress_mode TEXT DEFAULT 'tasks', completion_questions TEXT,
      complexity TEXT, complexity_pct REAL, updated_at TEXT);
    CREATE TABLE project_team_shares (project_id INTEGER, team_id INTEGER, share_percent REAL);
    CREATE TABLE blocks (id INTEGER PRIMARY KEY, project_id INTEGER, team_id INTEGER, name TEXT,
      weight_percent REAL DEFAULT 100, sort_order INTEGER DEFAULT 0);
    CREATE TABLE drawings (id INTEGER PRIMARY KEY, block_id INTEGER, name TEXT,
      weight_percent REAL DEFAULT 100, sort_order INTEGER DEFAULT 0);
    CREATE TABLE components (id INTEGER PRIMARY KEY, drawing_id INTEGER, name TEXT, sort_order INTEGER DEFAULT 0);
    CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, component_id INTEGER, name TEXT NOT NULL,
      weight_percent REAL NOT NULL DEFAULT 10, assigned_to INTEGER, due_date TEXT, start_date TEXT,
      sort_order INTEGER DEFAULT 0, ai_completion_summary TEXT, ai_completion_summary_at TEXT);
    CREATE TABLE task_assignees (task_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), self_joined INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (task_id, user_id));
    CREATE TABLE task_self_done (id INTEGER PRIMARY KEY, task_id INTEGER, user_id INTEGER, note TEXT,
      created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE task_shares (task_id INTEGER, user_id INTEGER, share_percent REAL, is_owner INTEGER DEFAULT 0);
    CREATE TABLE task_checklist_items (id INTEGER PRIMARY KEY, task_id INTEGER, user_id INTEGER, is_done INTEGER);
    CREATE TABLE task_deadlines (id INTEGER PRIMARY KEY, task_id INTEGER);
    CREATE TABLE task_hold_periods (id INTEGER PRIMARY KEY, task_id INTEGER, user_id INTEGER);
    CREATE TABLE project_milestones (id INTEGER PRIMARY KEY, task_id INTEGER);
    CREATE TABLE repair_entries (id INTEGER PRIMARY KEY, task_id INTEGER, user_id INTEGER, hours REAL, date TEXT, hours_source TEXT);
    CREATE TABLE repair_marks (id INTEGER PRIMARY KEY, task_id INTEGER, user_id INTEGER, date TEXT,
      award_points INTEGER, marked_at TEXT);
    CREATE TABLE progress_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, user_id INTEGER,
      percentage REAL CHECK (percentage >= 0 AND percentage <= 100), date TEXT, notes TEXT, status TEXT,
      reviewed_by INTEGER, reviewed_at TEXT, image_url TEXT, is_rest_day INTEGER DEFAULT 0,
      defer_next_day INTEGER DEFAULT 0, completion_qa TEXT, attachments TEXT, source TEXT NOT NULL DEFAULT 'web',
      is_baseline INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE user_points (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, project_id INTEGER,
      repair_project_id INTEGER, task_id INTEGER, progress_entry_id INTEGER, amount REAL NOT NULL,
      delta_pct REAL NOT NULL, assignee_count INTEGER NOT NULL, awarded_by INTEGER,
      source TEXT NOT NULL DEFAULT 'progress', awarded_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK ((project_id IS NULL) <> (repair_project_id IS NULL)));
    CREATE TABLE notifications (id INTEGER PRIMARY KEY, user_id INTEGER, type TEXT, title TEXT, body TEXT,
      link TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by INTEGER);
    CREATE TABLE employee_daily_snapshots (date TEXT, user_id INTEGER);
    INSERT INTO app_settings (key, value) VALUES ('lunch_enabled', '0');
  `);
  for (const f of MIGRATIONS) {
    sqlite.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
  }
  sqlite.exec(`
    INSERT INTO users (id, username, full_name, role) VALUES
      (2, 'ceo', 'Захирал', 'admin'), (3, 'bat', 'Болд Бат', 'engineer'), (4, 'dorj', 'Дорж Дорж', 'engineer'),
      (5, 'saraa', 'Сараа Сараа', 'architect'), (8, 'ahlah', 'Ахлах Ахлах', 'senior'), (9, 'admin', 'Админ', 'admin');
    INSERT INTO projects (id, name, status, category, progress_mode, complexity_pct) VALUES
      (10, 'ABC Tower', 'active', 'AZ', 'tasks', 100), (20, 'Засвар', 'active', 'ZA', 'hours', 100);
    INSERT INTO project_team_shares VALUES (10, 1, 100), (20, 1, 100);
    INSERT INTO blocks (id, project_id, team_id, name) VALUES (100, 10, 1, 'Блок'), (200, 20, 1, 'Блок');
    INSERT INTO drawings (id, block_id, name) VALUES (1000, 100, 'BA-01'), (2000, 200, 'ZA-01');
    INSERT INTO components (id, drawing_id, name) VALUES (1, 1000, 'К'), (2, 2000, 'К');
    INSERT INTO tasks (id, component_id, name, weight_percent, sort_order) VALUES
      (501, 1, 'Фасад', 10, 10), (502, 1, 'План', 20, 20), (503, 1, 'Хурлын даалгавар', 0, 30),
      (504, 1, 'Огтлол', 10, 40), (601, 2, 'Засвар', 10, 10);
  `);
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  void today;
  // 0384 нь шинэ орчинд `disabled` (root байхгүй) тавьдаг — тест өгөгдмөлөөр ИДЭВХТЭЙ (state: null = мөрийг устгана → fail-safe paused).
  if (opts.state === null) sqlite.exec("DELETE FROM app_settings WHERE key = 'task_alloc.state'");
  else sqlite.exec(`UPDATE app_settings SET value = '${opts.state ?? 'enabled'}' WHERE key = 'task_alloc.state'`);
  return { sqlite, d1: d1Shim(sqlite) };
}

/** Хуучин (managed биш) явцын бичлэг + түүний оноо. */
export function legacyEntry(
  sqlite: DatabaseSync,
  p: { taskId: number; userId: number; pct: number; createdAt: string; points?: { amount: number; deltaPct: number } },
): { entryId: number; pointsId: number | null } {
  const r = sqlite
    .prepare(
      `INSERT INTO progress_entries (task_id, user_id, percentage, date, status, reviewed_by, source, created_at)
       VALUES (?, ?, ?, ?, 'approved', ?, 'web', ?)`,
    )
    .run(p.taskId, p.userId, p.pct, p.createdAt.slice(0, 10), p.userId, p.createdAt);
  const entryId = Number(r.lastInsertRowid);
  let pointsId: number | null = null;
  if (p.points) {
    const q = sqlite
      .prepare(
        `INSERT INTO user_points (user_id, project_id, task_id, progress_entry_id, amount, delta_pct, assignee_count,
                                  awarded_by, source, awarded_at)
         VALUES (?, 10, ?, ?, ?, ?, 1, ?, 'progress', ?)`,
      )
      .run(p.userId, p.taskId, entryId, p.points.amount, p.points.deltaPct, p.userId, p.createdAt);
    pointsId = Number(q.lastInsertRowid);
  }
  return { entryId, pointsId };
}

/** Дууссан (эсвэл явж буй) албан таймерын сэшн — хувь оруулах эрх (TAKE_REQUIRED) ба цагийн тестэд. */
export function session(
  sqlite: DatabaseSync,
  p: { userId: number; taskId: number; startedAt: string; endedAt?: string | null; projectId?: number },
): number {
  const r = sqlite
    .prepare(
      `INSERT INTO task_timer_sessions (user_id, task_id, project_id, started_at, ended_at, duration_ms,
                                         start_reason, started_by, start_request_id, end_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'start', ?, ?, ?, ?, ?)`,
    )
    .run(
      p.userId,
      p.taskId,
      p.projectId ?? 10,
      p.startedAt,
      p.endedAt ?? null,
      p.endedAt ? Math.max(0, Date.parse(p.endedAt) - Date.parse(p.startedAt)) : null,
      p.userId,
      `seed-${p.userId}-${p.taskId}-${p.startedAt}`,
      p.endedAt ? 'pause' : null,
      p.startedAt,
      p.startedAt,
    );
  return Number(r.lastInsertRowid);
}

export const sum = (sqlite: DatabaseSync, sql: string, ...params: unknown[]): number =>
  Number((sqlite.prepare(sql).get(...(params as never[])) as { v: number | null } | undefined)?.v ?? 0);

export const rows = <T = Record<string, unknown>>(sqlite: DatabaseSync, sql: string, ...params: unknown[]): T[] =>
  sqlite.prepare(sql).all(...(params as never[])) as T[];

export const uid = (() => {
  let n = 0;
  return (prefix = 'req') => `${prefix}-${String(++n).padStart(6, '0')}-test`;
})();
