/**
 * `lib/categoryTemplates.ts` — ангиллын загвар төслөөс шинэ төсөлд бүтэц
 * хуулах, БОДИТ миграц 0392 дээр (node:sqlite + D1 shim).
 *
 * Run with:  node --test src/lib/categoryTemplates.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
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

const { applyCategoryTemplate, loadCategoryTemplates, resolveCategoryTemplate } = await import(
  './categoryTemplates.ts'
);

/** node:sqlite дээрх D1 shim — `batch` нь нэг transaction, RETURNING-ийг дэмжинэ. */
function fakeD1(db: DatabaseSync): D1Database {
  const exec = (sql: string, args: unknown[]) =>
    /\bRETURNING\b/i.test(sql)
      ? { results: db.prepare(sql).all(...(args as never[])) }
      : { results: [], meta: { changes: db.prepare(sql).run(...(args as never[])).changes } };
  const mk = (sql: string, args: unknown[] = []) => ({
    __sql: sql,
    __args: args,
    bind: (...a: unknown[]) => mk(sql, a),
    all: async <T>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[] }) as never,
    first: async <T>() => (db.prepare(sql).get(...(args as never[])) as T | undefined) ?? null,
    run: async () => exec(sql, args) as never,
  });
  return {
    prepare: (sql: string) => mk(sql),
    batch: async (stmts: Array<{ __sql: string; __args: unknown[] }>) => {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => exec(s.__sql, s.__args));
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as D1Database;
}

/** node:sqlite мөрүүд null-prototype — deepStrictEqual-д энгийн объект болгоно. */
const plain = <T,>(rows: T): T => JSON.parse(JSON.stringify(rows)) as T;

const TEMPLATE = 75;
const NEW = 200;

function freshDb(): { db: DatabaseSync; d1: D1Database } {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by INTEGER);
    CREATE TABLE teams (id INTEGER PRIMARY KEY, code TEXT NOT NULL, name_mn TEXT NOT NULL);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT,
      status TEXT NOT NULL DEFAULT 'active', asr_only INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE project_team_shares (id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL, team_id INTEGER NOT NULL, share_percent REAL NOT NULL,
      sort_order INTEGER);
    CREATE TABLE blocks (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL,
      name TEXT NOT NULL, weight_percent REAL NOT NULL DEFAULT 0, sort_order INTEGER,
      team_id INTEGER, responsible_name TEXT);
    CREATE TABLE drawings (id INTEGER PRIMARY KEY AUTOINCREMENT, block_id INTEGER NOT NULL,
      name TEXT NOT NULL, weight_percent REAL NOT NULL DEFAULT 0, sort_order INTEGER);
    CREATE TABLE components (id INTEGER PRIMARY KEY AUTOINCREMENT, drawing_id INTEGER NOT NULL,
      name TEXT NOT NULL, weight_percent REAL NOT NULL DEFAULT 0, sort_order INTEGER);
    CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, component_id INTEGER NOT NULL,
      name TEXT NOT NULL, weight_percent REAL NOT NULL DEFAULT 0, sort_order INTEGER,
      assigned_to INTEGER, due_date TEXT, start_date TEXT);

    INSERT INTO teams VALUES (1, 'BA', 'Архитектур'), (9, 'EZ', 'Эскиз');
    INSERT INTO projects (id, name, category) VALUES
      (${TEMPLATE}, 'MGL-260915 ПРАЙМ РОУ', 'EZ'), (${NEW}, 'Шинэ эскиз', 'EZ');
    INSERT INTO project_team_shares (project_id, team_id, share_percent, sort_order)
      VALUES (${TEMPLATE}, 9, 100, 0);
    INSERT INTO blocks (id, project_id, name, weight_percent, sort_order, team_id, responsible_name)
      VALUES (500, ${TEMPLATE}, 'Бүх блок', 100, 0, 9, 'Б.Бат');
    INSERT INTO drawings (id, block_id, name, weight_percent, sort_order)
      VALUES (600, 500, 'EZ - Эскиз зураг', 100, 0);
    INSERT INTO components (id, drawing_id, name, weight_percent, sort_order) VALUES
      (700, 600, 'Судалгааны үе шат', 10, 0),
      (701, 600, 'Концепц санаа', 14, 1),
      (702, 600, 'Хоосон бүрэлдэхүүн', 0, 2);
    INSERT INTO tasks (component_id, name, weight_percent, sort_order, assigned_to, due_date, start_date) VALUES
      (700, 'Concept Book судалгааны ажил', 7, 10, 42, '2026-10-01', '2026-09-20'),
      (700, 'Газрын судалгаа', 1, 30, NULL, NULL, NULL),
      (701, 'Масс модель', 3, 30, 43, NULL, NULL);
  `);
  db.exec(readFileSync(new URL('../../migrations/0392_ez_category_template.sql', import.meta.url), 'utf8'));
  return { db, d1: fakeD1(db) };
}

test('0392: EZ загвар = 75, resolver нь ангилал/ЗХ/устгалыг шалгана', async () => {
  const { db, d1 } = freshDb();
  assert.deepEqual(await resolveCategoryTemplate(d1, 'EZ'), {
    project_id: TEMPLATE,
    name: 'MGL-260915 ПРАЙМ РОУ',
  });
  assert.equal(await resolveCategoryTemplate(d1, 'AZ'), null);

  // INSERT OR IGNORE — дахин ажиллуулахад админы сонголтыг дарахгүй.
  db.exec(`UPDATE app_settings SET value = '${NEW}' WHERE key = 'project_template.EZ'`);
  db.exec(readFileSync(new URL('../../migrations/0392_ez_category_template.sql', import.meta.url), 'utf8'));
  assert.equal((await resolveCategoryTemplate(d1, 'EZ'))?.project_id, NEW);
  db.exec(`UPDATE app_settings SET value = '${TEMPLATE}' WHERE key = 'project_template.EZ'`);

  db.exec(`UPDATE projects SET category = 'AZ' WHERE id = ${TEMPLATE}`);
  assert.equal(await resolveCategoryTemplate(d1, 'EZ'), null, 'ангилал өөрчлөгдвөл хүчингүй');
  db.exec(`UPDATE projects SET category = 'EZ', asr_only = 1 WHERE id = ${TEMPLATE}`);
  assert.equal(await resolveCategoryTemplate(d1, 'EZ'), null, 'ЗХ бүрхүүл загвар биш');
  db.exec(`UPDATE projects SET asr_only = 0, status = 'archived' WHERE id = ${TEMPLATE}`);
  assert.equal((await resolveCategoryTemplate(d1, 'EZ'))?.project_id, TEMPLATE, 'архивласан ч загвар');
  db.exec(`DELETE FROM projects WHERE id = ${TEMPLATE}`);
  assert.equal(await resolveCategoryTemplate(d1, 'EZ'), null, 'устсан төсөл');
});

test('загвар хуулах: багийн хувь, мод, жин ЯГ ХЭВЭЭР — хүн, огноо ХУУЛАГДАХГҮЙ', async () => {
  const { db, d1 } = freshDb();
  const template = await resolveCategoryTemplate(d1, 'EZ');
  assert.ok(template);
  const res = await applyCategoryTemplate(d1, NEW, template);
  assert.equal(res.applied, true);
  assert.ok(res.applied);
  assert.equal(res.team_shares_written, true);
  assert.deepEqual(res.counts, { teams: 1, blocks: 1, drawings: 1, components: 2, tasks: 3 });

  assert.deepEqual(
    plain(db.prepare('SELECT team_id, share_percent, sort_order FROM project_team_shares WHERE project_id = ?').all(NEW)),
    [{ team_id: 9, share_percent: 100, sort_order: 0 }],
  );
  assert.deepEqual(
    plain(
      db
        .prepare('SELECT name, weight_percent, sort_order, team_id, responsible_name FROM blocks WHERE project_id = ?')
        .all(NEW),
    ),
    [{ name: 'Бүх блок', weight_percent: 100, sort_order: 0, team_id: 9, responsible_name: 'Б.Бат' }],
  );
  const tasks = plain(db
    .prepare(
      `SELECT co.name AS comp, co.weight_percent AS cw, t.name, t.weight_percent, t.sort_order,
              t.assigned_to, t.due_date, t.start_date
       FROM tasks t JOIN components co ON co.id = t.component_id
       JOIN drawings d ON d.id = co.drawing_id JOIN blocks b ON b.id = d.block_id
       WHERE b.project_id = ? ORDER BY co.sort_order, t.sort_order`,
    )
    .all(NEW));
  assert.deepEqual(tasks, [
    { comp: 'Судалгааны үе шат', cw: 10, name: 'Concept Book судалгааны ажил', weight_percent: 7, sort_order: 10, assigned_to: null, due_date: null, start_date: null },
    { comp: 'Судалгааны үе шат', cw: 10, name: 'Газрын судалгаа', weight_percent: 1, sort_order: 30, assigned_to: null, due_date: null, start_date: null },
    { comp: 'Концепц санаа', cw: 14, name: 'Масс модель', weight_percent: 3, sort_order: 30, assigned_to: null, due_date: null, start_date: null },
  ]);
  // Загвар төсөл өөрөө хөндөгдөөгүй.
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM blocks WHERE project_id = ?').get(TEMPLATE) as { n: number }).n,
    1,
  );
});

test('унавал бичсэнээ БУЦААНА — төсөл бүтэцгүй, ростергүй үлдэнэ', async () => {
  const { db, d1 } = freshDb();
  db.exec(`CREATE TRIGGER boom BEFORE INSERT ON tasks WHEN NEW.name = 'Масс модель'
           BEGIN SELECT RAISE(ABORT, 'boom'); END;`);
  const res = await applyCategoryTemplate(d1, NEW, { project_id: TEMPLATE, name: 'x' });
  assert.equal(res.applied, false);
  assert.ok(!res.applied && res.reason === 'FAILED');
  for (const table of ['blocks', 'project_team_shares']) {
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id = ?`).get(NEW) as { n: number }).n;
    assert.equal(n, 0, table);
  }
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM drawings').get() as { n: number }).n, 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM components').get() as { n: number }).n, 3);
});

test('ажилгүй загвар → EMPTY, юу ч бичихгүй', async () => {
  const { db, d1 } = freshDb();
  db.exec('DELETE FROM tasks');
  const res = await applyCategoryTemplate(d1, NEW, { project_id: TEMPLATE, name: 'x' });
  assert.ok(!res.applied && res.reason === 'EMPTY');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM project_team_shares WHERE project_id = ?').get(NEW) as { n: number }).n, 0);
});

test('loadCategoryTemplates: тоо + багийн хувь, хүчингүй мөрийг алгасна', async () => {
  const { db, d1 } = freshDb();
  db.exec(`INSERT INTO app_settings (key, value) VALUES
    ('project_template.AZ', '${TEMPLATE}'), ('project_template.XX', '1'), ('project_template.IZ', 'abc')`);
  const list = await loadCategoryTemplates(d1);
  assert.equal(list.length, 1, 'AZ мөр нь EZ төслийг заасан тул хүчингүй');
  assert.deepEqual(list[0], {
    category: 'EZ',
    project_id: TEMPLATE,
    name: 'MGL-260915 ПРАЙМ РОУ',
    status: 'active',
    counts: { teams: 1, blocks: 1, drawings: 1, components: 3, tasks: 3 },
    team_shares: [{ team_code: 'EZ', share_percent: 100 }],
  });
});
