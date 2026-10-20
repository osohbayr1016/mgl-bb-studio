// POST /api/blocks/:id/duplicate — НЭГ транзакц, request_id, жингийн төсөв (0401). Бодит SQLite + бодит route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { d1Shim } from '../../test-support/allocHarness.ts';

const blocksRoute = (await import('./blocks.ts')).default;
const { weightBudget, parseDuplicateBody } = await import('../lib/blockDuplicate.ts');

const SCHEMA = `
CREATE TABLE blocks (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, name TEXT NOT NULL,
  weight_percent REAL NOT NULL DEFAULT 0, sort_order INTEGER DEFAULT 0, team_id INTEGER, responsible_name TEXT,
  created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE drawings (id INTEGER PRIMARY KEY AUTOINCREMENT, block_id INTEGER NOT NULL, name TEXT NOT NULL,
  weight_percent REAL NOT NULL DEFAULT 0, sort_order INTEGER DEFAULT 0);
CREATE TABLE components (id INTEGER PRIMARY KEY AUTOINCREMENT, drawing_id INTEGER NOT NULL, name TEXT NOT NULL,
  weight_percent REAL NOT NULL DEFAULT 0, sort_order INTEGER DEFAULT 0);
CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, component_id INTEGER NOT NULL, name TEXT NOT NULL,
  weight_percent REAL NOT NULL DEFAULT 0, due_date TEXT, start_date TEXT, sort_order INTEGER DEFAULT 0,
  assigned_to INTEGER);
`;

/** Эх блок 1 (баг 7, жин 40): 2 зураг × 2 бүрэлдэхүүн × 3 таск.  Холилдохын тулд
 *  өөр блок 2-ын мөрүүдийг хооронд нь оруулна. */
function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA);
  sqlite.exec(readFileSync(new URL('../../migrations/0401_block_duplicate_ops.sql', import.meta.url), 'utf8'));
  sqlite.exec(`INSERT INTO blocks (id, project_id, name, weight_percent, sort_order, team_id, responsible_name)
    VALUES (1, 10, 'Блок А', 40, 0, 7, 'Б.Бат'), (2, 10, 'Блок Б', 30, 1, 7, NULL), (3, 10, 'Бусад', 90, 2, NULL, NULL)`);
  let t = 0;
  for (const [did, bid] of [[1, 1], [2, 2], [3, 1]] as const) {
    sqlite.exec(`INSERT INTO drawings (id, block_id, name, weight_percent, sort_order) VALUES (${did}, ${bid}, 'Зураг ${did}', 50, ${did})`);
    for (let k = 0; k < 2; k++) {
      const cid = did * 10 + k;
      sqlite.exec(`INSERT INTO components (id, drawing_id, name, weight_percent, sort_order) VALUES (${cid}, ${did}, 'Бүрдэл ${cid}', 0, ${k})`);
      for (let j = 0; j < 3; j++) {
        t++;
        sqlite.exec(`INSERT INTO tasks (id, component_id, name, weight_percent, due_date, sort_order, assigned_to)
          VALUES (${100 + t}, ${cid}, 'Таск ${cid}.${j}', ${j + 1}, '2026-11-0${j + 1}', ${j}, 5)`);
      }
    }
  }
  const d1 = d1Shim(sqlite);
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: unknown } }>();
  app.use('*', async (c, next) => {
    c.set('user', JSON.parse(c.req.header('x-test-user') ?? '{"sub":8,"role":"senior"}'));
    await next();
  });
  app.route('/api/blocks', blocksRoute as never);
  const req = async (path: string, body: unknown, user = { sub: 8, role: 'senior' }) => {
    const res = await app.request(
      `http://x${path}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-user': JSON.stringify(user) },
        body: JSON.stringify(body),
      },
      { DB: d1 } as never,
    );
    return { status: res.status, json: (await res.json()) as any };
  };
  return { sqlite, d1, req };
}

const all = (db: DatabaseSync, sql: string, ...p: unknown[]) => db.prepare(sql).all(...(p as never[])) as any[];
const one = (db: DatabaseSync, sql: string, ...p: unknown[]) => db.prepare(sql).get(...(p as never[])) as any;

/** Блокийн модыг id-гүйгээр (бүтэц + утга) — эх ба хуулбарыг харьцуулахад. */
function shape(db: DatabaseSync, blockId: number) {
  return all(db, 'SELECT id, name, weight_percent, sort_order FROM drawings WHERE block_id = ? ORDER BY id', blockId).map((d) => ({
    name: d.name,
    w: d.weight_percent,
    so: d.sort_order,
    comps: all(db, 'SELECT id, name, weight_percent, sort_order FROM components WHERE drawing_id = ? ORDER BY id', d.id).map((c) => ({
      name: c.name,
      so: c.sort_order,
      tasks: all(db, 'SELECT name, weight_percent, due_date, sort_order FROM tasks WHERE component_id = ? ORDER BY id', c.id),
    })),
  }));
}

test('цэвэр дүрэм: жингийн төсөв ба биеийн шалгалт', () => {
  assert.deepEqual(weightBudget(70, 30), { team_total: 70, added: 30, after: 100, over: false });
  assert.equal(weightBudget(70.1 + 0.2, 29.7).over, false); // хөвөгч цэгийн шуугиан 100-г давуулахгүй
  assert.equal(weightBudget(70, 40).over, true);
  assert.equal(parseDuplicateBody({}).ok, true);
  assert.equal(parseDuplicateBody({ weight_percent: 120 }).ok, false);
  assert.equal(parseDuplicateBody({ weight_percent: Number.NaN }).ok, false);
  assert.equal(parseDuplicateBody({ request_id: 'short' }).ok, false);
  assert.equal(parseDuplicateBody({ name: 'x'.repeat(201) }).ok, false);
});

test('бүтэн мод НЭГ транзакцаар хуулагдана; хариуцагч/явц хуулагдахгүй; эх мод хөндөгдөхгүй', async () => {
  const { sqlite, req } = setup();
  const before = shape(sqlite, 1);
  const r = await req('/api/blocks/1/duplicate', { request_id: 'dup-aaaaaaaa', weight_percent: 30 });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const nb = one(sqlite, 'SELECT * FROM blocks WHERE id = ?', r.json.id);
  assert.equal(nb.name, 'Блок А (хуулбар)');
  assert.equal(nb.team_id, 7);
  assert.equal(nb.responsible_name, 'Б.Бат');
  assert.equal(nb.weight_percent, 30);
  assert.equal(nb.sort_order, 3);
  assert.deepEqual(r.json.counts, { drawings: 2, components: 4, tasks: 12 });
  assert.deepEqual(shape(sqlite, r.json.id), before);
  assert.deepEqual(shape(sqlite, 1), before);
  assert.equal(
    one(sqlite, `SELECT COUNT(*) AS n FROM tasks t JOIN components c ON c.id = t.component_id
                 JOIN drawings d ON d.id = c.drawing_id WHERE d.block_id = ? AND t.assigned_to IS NOT NULL`, r.json.id).n,
    0,
  );
  // Блок 2-ын мод хуулбарт холилдоогүй.
  assert.equal(one(sqlite, 'SELECT COUNT(*) AS n FROM drawings WHERE block_id = 2').n, 1);
});

test('ижил request_id → анхны үр дүн, хоёр дахь хуулбар үүсэхгүй; өөр блок дээр → 409', async () => {
  const { sqlite, req } = setup();
  const a = await req('/api/blocks/1/duplicate', { request_id: 'dup-bbbbbbbb', allow_over_budget: true });
  assert.equal(a.status, 201);
  const b = await req('/api/blocks/1/duplicate', { request_id: 'dup-bbbbbbbb', allow_over_budget: true });
  assert.equal(b.status, 200);
  assert.equal(b.json.replayed, true);
  assert.equal(b.json.id, a.json.id);
  assert.equal(one(sqlite, 'SELECT COUNT(*) AS n FROM blocks').n, 4);
  const c = await req('/api/blocks/2/duplicate', { request_id: 'dup-bbbbbbbb', allow_over_budget: true });
  assert.equal(c.status, 409);
  assert.equal(c.json.code, 'REQUEST_REUSED');
  const d = await req('/api/blocks/1/duplicate', { request_id: 'dup-bbbbbbbb' }, { sub: 9, role: 'admin' });
  assert.equal(d.json.code, 'REQUEST_REUSED');
});

test('жингийн төсөв: баг 7 = 70 + 40 > 100 → 409, юу ч үүсэхгүй; зөвшөөрвөл үүснэ', async () => {
  const { sqlite, req } = setup();
  const r = await req('/api/blocks/1/duplicate', {});
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'WEIGHT_BUDGET_EXCEEDED');
  assert.deepEqual(r.json.weight_budget, { team_total: 70, added: 40, after: 110, over: true });
  assert.equal(one(sqlite, 'SELECT COUNT(*) AS n FROM blocks').n, 3);
  // Баггүй блокууд өөрийн бүлэг: 90 + 90 → мөн хэтэрнэ.
  assert.equal((await req('/api/blocks/3/duplicate', {})).json.code, 'WEIGHT_BUDGET_EXCEEDED');
  // Жин 0-ээр хуулахад төсөвт багтана.
  assert.equal((await req('/api/blocks/3/duplicate', { weight_percent: 0 })).status, 201);
  const ok = await req('/api/blocks/1/duplicate', { allow_over_budget: true });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.weight_budget.after, 110);
});

test('дундаас унавал БҮХ мод буцна — хоосон/дутуу блок үлдэхгүй', async () => {
  const { sqlite, req } = setup();
  // Таскийн INSERT-ийг (сүүлийн statement) хүчээр унагана.
  sqlite.exec(`CREATE TRIGGER boom BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT, 'boom'); END`);
  const r = await req('/api/blocks/1/duplicate', { request_id: 'dup-cccccccc', allow_over_budget: true });
  assert.equal(r.status, 500);
  assert.equal(r.json.code, 'DUPLICATE_FAILED');
  assert.equal(one(sqlite, 'SELECT COUNT(*) AS n FROM blocks').n, 3);
  assert.equal(one(sqlite, 'SELECT COUNT(*) AS n FROM drawings').n, 3);
  assert.equal(one(sqlite, 'SELECT COUNT(*) AS n FROM components').n, 6);
  assert.equal(one(sqlite, 'SELECT COUNT(*) AS n FROM block_duplicate_ops').n, 0);
  // Алдаа арилсны дараа ижил request_id-аар дахин оролдвол хуулагдана.
  sqlite.exec('DROP TRIGGER boom');
  const again = await req('/api/blocks/1/duplicate', { request_id: 'dup-cccccccc', allow_over_budget: true });
  assert.equal(again.status, 201);
  assert.deepEqual(again.json.counts, { drawings: 2, components: 4, tasks: 12 });
});

test('эх блок олдохгүй → 404; эх блок preflight-ийн дараа устсан ч юу ч үүсэхгүй', async () => {
  const { sqlite, d1, req } = setup();
  const { duplicateStatements, loadOp } = await import('../lib/blockDuplicate.ts');
  assert.equal((await req('/api/blocks/999/duplicate', {})).status, 404);
  // Preflight-ийн дараах устгалыг batch-ийг шууд ажиллуулж дуурайна (эх мөр алга, хүүхдүүд нь өнчин үлдсэн).
  sqlite.exec('DELETE FROM blocks WHERE id = 1');
  await d1.batch(duplicateStatements(d1, { requestId: 'dup-dddddddd', userId: 8, srcId: 1, name: 'x', weight: 0, now: 'n', allowOverBudget: false }));
  assert.equal(await loadOp(d1, 'dup-dddddddd'), null);
  assert.equal(one(sqlite, 'SELECT COUNT(*) AS n FROM blocks').n, 2);
  assert.equal(one(sqlite, 'SELECT COUNT(*) AS n FROM drawings').n, 3);
  assert.equal(one(sqlite, 'SELECT COUNT(*) AS n FROM tasks').n, 18);
});

test('зэрэг хуулалт: preflight-ийг хоёулаа давсан ч транзакц дотор 100%-ийг давуулахгүй', async () => {
  const { sqlite, d1, req } = setup();
  // Блок 2 (жин 30) → баг 7 = 70 + 30 = 100 (preflight OK).  Preflight ба batch-ийн
  // хооронд өөр бичилт баг 7-д 30 нэмнэ — хуучин код энэ үед 130% болгодог байв.
  const realBatch = d1.batch.bind(d1);
  let injected = false;
  (d1 as any).batch = async (stmts: unknown[]) => {
    if (!injected) {
      injected = true;
      sqlite.exec(`INSERT INTO blocks (project_id, name, weight_percent, team_id) VALUES (10, 'Зэрэг', 30, 7)`);
    }
    return realBatch(stmts as never);
  };
  const r = await req('/api/blocks/2/duplicate', { request_id: 'dup-eeeeeeee' });
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.code, 'WEIGHT_BUDGET_EXCEEDED');
  assert.deepEqual(r.json.weight_budget, { team_total: 100, added: 30, after: 130, over: true });
  assert.equal(one(sqlite, 'SELECT COUNT(*) AS n FROM blocks').n, 4); // 3 + зэрэг бичилт, хуулбар алга
  assert.equal(one(sqlite, 'SELECT COUNT(*) AS n FROM drawings').n, 3);
  assert.equal(one(sqlite, 'SELECT COUNT(*) AS n FROM block_duplicate_ops').n, 0);
  // Хэрэглэгч зөвшөөрвөл ижил request_id-аар үүснэ.
  const ok = await req('/api/blocks/2/duplicate', { request_id: 'dup-eeeeeeee', allow_over_budget: true });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(one(sqlite, 'SELECT SUM(weight_percent) AS w FROM blocks WHERE team_id = 7').w, 130);
});

test('хоёр хуулалт ЗЭРЭГ (өөр request_id): ЯГ НЭГ нь үүснэ, нийт ≤ 100', async () => {
  const { sqlite, req } = setup();
  const [a, b] = await Promise.all([
    req('/api/blocks/2/duplicate', { request_id: 'dup-ffffffff' }),
    req('/api/blocks/2/duplicate', { request_id: 'dup-gggggggg' }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409], JSON.stringify([a.json, b.json]));
  assert.equal((a.status === 409 ? a : b).json.code, 'WEIGHT_BUDGET_EXCEEDED');
  assert.equal(one(sqlite, 'SELECT SUM(weight_percent) AS w FROM blocks WHERE team_id = 7').w, 100);
  assert.equal(one(sqlite, 'SELECT COUNT(*) AS n FROM block_duplicate_ops').n, 1);
  // Үүссэн хуулбарын журнал ЗӨВ блокийг заана (бүтэн мод нь түүн дор).
  const op = one(sqlite, 'SELECT new_block_id FROM block_duplicate_ops');
  assert.equal(op.new_block_id, (a.status === 201 ? a : b).json.id);
  assert.equal(one(sqlite, 'SELECT COUNT(*) AS n FROM drawings WHERE block_id = ?', op.new_block_id).n, 1);
});

test('батч доторх төсвийн шалгалт хөвөгч цэгийн шуугианд 100-г давсан гэж үзэхгүй', async () => {
  const { sqlite, d1 } = setup();
  const { duplicateStatements, loadOp } = await import('../lib/blockDuplicate.ts');
  sqlite.exec(`UPDATE blocks SET weight_percent = 70.1 WHERE id = 1; UPDATE blocks SET weight_percent = 0.2 WHERE id = 2`);
  await d1.batch(duplicateStatements(d1, { requestId: 'dup-hhhhhhhh', userId: 8, srcId: 2, name: 'x', weight: 29.7, now: 'n', allowOverBudget: false }));
  assert.notEqual(await loadOp(d1, 'dup-hhhhhhhh'), null);
});
