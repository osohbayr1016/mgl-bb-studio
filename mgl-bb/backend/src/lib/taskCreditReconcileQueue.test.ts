// Жин засварын дараах онооны тулгалтын дараалал (migration 0402) — БОДИТ SQLite + миграц файл.
// Тулгалтыг «унагахын» тулд `app_settings` / `task_roots` хүснэгтгүй DB ашиглана: `reconcileTaskCredit`
// хаалганы тохиргоог уншихдаа throw хийнэ — яг production дээрх D1-ийн түр алдааны адил.
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

const q = await import('./taskCreditReconcileQueue.ts');

/** `onSql` — тухайн SQL ажиллахаас ӨМНӨ дуудагдана (зэрэг ажиллагааг яг тэр агшинд оруулахад). */
function d1Shim(db: DatabaseSync, onSql?: (sql: string) => Promise<void> | void) {
  const hook = async (sql: string) => {
    if (onSql) await onSql(sql);
  };
  const prepare = (sql: string, params: unknown[] = []) => ({
    bind(...args: unknown[]) {
      return prepare(sql, args);
    },
    async all() {
      await hook(sql);
      return { results: db.prepare(sql).all(...(params as never[])) };
    },
    async first() {
      await hook(sql);
      return db.prepare(sql).get(...(params as never[])) ?? null;
    },
    async run() {
      await hook(sql);
      const r = db.prepare(sql).run(...(params as never[]));
      return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } };
    },
  });
  return { prepare, batch: async () => [] } as unknown as D1Database;
}

const migration = (name: string) => readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');

function setup(onSql?: (sql: string) => Promise<void> | void) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE tasks (id INTEGER PRIMARY KEY); CREATE TABLE projects (id INTEGER PRIMARY KEY);');
  db.exec('INSERT INTO tasks (id) VALUES (5); INSERT INTO projects (id) VALUES (9);');
  db.exec(migration('0402_task_credit_reconcile_queue.sql'));
  db.exec(migration('0404_task_credit_reconcile_claim.sql'));
  return { db, D1: d1Shim(db, onSql) };
}
const rows = (db: DatabaseSync) =>
  db.prepare('SELECT kind, target_id, status, attempts, last_error FROM task_credit_reconcile_queue ORDER BY kind, target_id').all() as Array<{
    kind: string;
    target_id: number;
    status: string;
    attempts: number;
    last_error: string | null;
  }>;
/** Мөрийг «2+ минутын настай» болгоно — sweep зөвхөн тэднийг авна. */
const age = (db: DatabaseSync) => db.exec("UPDATE task_credit_reconcile_queue SET updated_at = datetime('now', '-5 minutes')");

test('тулгалт унавал алга болохгүй — дараалалд мөр болж үлдэнэ (task ба project)', async () => {
  const { db, D1 } = setup();
  assert.equal(await q.reconcileCreditOrEnqueue(D1, 'task', 5, 3), 'queued');
  assert.equal(await q.reconcileCreditOrEnqueue(D1, 'project', 9, 3), 'queued');
  const r = rows(db);
  assert.equal(r.length, 2);
  assert.ok(r.every((x) => x.status === 'pending' && x.attempts === 0 && x.last_error));
  // Дахин унавал ижил мөр (давхардалгүй), тоолуур тэглэгдэнэ.
  db.exec("UPDATE task_credit_reconcile_queue SET attempts = 4 WHERE kind = 'task'");
  await q.reconcileCreditOrEnqueue(D1, 'task', 5, 3);
  assert.equal(rows(db).find((x) => x.kind === 'task')?.attempts, 0);
  assert.deepEqual(await q.creditReconcileCounts(D1), { pending: 2, failed: 0 });
});

test('sweep: шинэ мөрийг (2 минутаас залуу) хүлээнэ; алдаа бүрт +1, 8 дахь удаад failed', async () => {
  const { db, D1 } = setup();
  await q.reconcileCreditOrEnqueue(D1, 'task', 5, 3);
  assert.deepEqual(await q.sweepCreditReconcileQueue({ DB: D1 }), { processed: 0, done: 0, failed: 0 });
  for (let i = 1; i <= q.MAX_RECONCILE_ATTEMPTS; i++) {
    age(db);
    const out = await q.sweepCreditReconcileQueue({ DB: D1 });
    assert.equal(out.failed, 1);
    assert.equal(rows(db)[0]!.attempts, i);
  }
  assert.equal(rows(db)[0]!.status, 'failed');
  age(db);
  assert.equal((await q.sweepCreditReconcileQueue({ DB: D1 })).processed, 0, 'failed мөрийг дахин авахгүй');
  assert.deepEqual(await q.creditReconcileCounts(D1), { pending: 0, failed: 1 });
});

test('sweep: зорилт устсан бол мөрийг хаяна (done)', async () => {
  const { db, D1 } = setup();
  await q.enqueueCreditReconcile(D1, 'task', 777, 1, 'x');
  age(db);
  assert.deepEqual(await q.sweepCreditReconcileQueue({ DB: D1 }), { processed: 1, done: 1, failed: 0 });
  assert.equal(rows(db).length, 0);
});

test('0402-оос өмнөх DB (хүснэгтгүй) — дуудагч хэзээ ч унахгүй', async () => {
  const db = new DatabaseSync(':memory:');
  const D1 = d1Shim(db);
  assert.equal(await q.reconcileCreditOrEnqueue(D1, 'task', 1), 'queued');
  assert.deepEqual(await q.sweepCreditReconcileQueue({ DB: D1 }), { processed: 0, done: 0, failed: 0 });
  assert.deepEqual(await q.creditReconcileCounts(D1), { pending: 0, failed: 0 });
});

// ── Зэрэг ажиллагаа (migration 0404) ─────────────────────────────────────────────────────────────
// Тулгалт ажиллаж байх ЯГ тэр агшинд (`targetExists`-ийн SELECT) шинэ enqueue оруулна.
const DURING_RUN = /^SELECT 1 AS x FROM (tasks|projects)/;

test('sweep амжилттай дуусахад тэр хооронд ирсэн ШИНЭ ажил устахгүй', async () => {
  let D1!: D1Database;
  let injected = false;
  const s = setup(async (sql) => {
    if (!injected && DURING_RUN.test(sql)) {
      injected = true;
      await q.enqueueCreditReconcile(D1, 'task', 777, 2, 'NEW');
    }
  });
  D1 = s.D1;
  await q.enqueueCreditReconcile(D1, 'task', 777, 1, 'OLD'); // зорилт байхгүй → sweep «done»
  age(s.db);
  assert.deepEqual(await q.sweepCreditReconcileQueue({ DB: D1 }), { processed: 1, done: 1, failed: 0 });
  const r = rows(s.db);
  assert.equal(r.length, 1, 'шинэ ажил дараалалд үлдэнэ');
  assert.equal(r[0]!.status, 'pending');
  assert.equal(r[0]!.last_error, 'NEW');
  // Дараагийн sweep (2+ минутын дараа) шинэ ажлыг ажиллуулж устгана.
  age(s.db);
  assert.equal((await q.sweepCreditReconcileQueue({ DB: D1 })).done, 1);
  assert.equal(rows(s.db).length, 0);
});

test('sweep унахад тэр хооронд ирсэн шинэ ажлын оролдлогыг хуучин алдаа өсгөхгүй', async () => {
  let D1!: D1Database;
  let injected = false;
  const s = setup(async (sql) => {
    if (!injected && DURING_RUN.test(sql)) {
      injected = true;
      await q.enqueueCreditReconcile(D1, 'task', 5, 2, 'NEW');
    }
  });
  D1 = s.D1;
  await q.enqueueCreditReconcile(D1, 'task', 5, 1, 'OLD'); // таск 5 бий → тулгалт throw
  s.db.exec("UPDATE task_credit_reconcile_queue SET attempts = 7");
  age(s.db);
  await q.sweepCreditReconcileQueue({ DB: D1 });
  const r = rows(s.db)[0]!;
  assert.equal(r.status, 'pending', '7 + 1 = 8 болж failed болохгүй — шинэ ажил');
  assert.equal(r.attempts, 0);
  assert.equal(r.last_error, 'NEW');
  const claim = s.db.prepare('SELECT claim_token FROM task_credit_reconcile_queue').get() as { claim_token: string | null };
  assert.equal(claim.claim_token, null, 'enqueue эзэмшлийг чөлөөлнө');
});

test('давхцсан хоёр sweep — мөрийг НЭГ нь л ажиллуулна, оролдлого +1', async () => {
  const { db, D1 } = setup();
  await q.enqueueCreditReconcile(D1, 'task', 5, 1, 'x');
  age(db);
  const [a, b] = await Promise.all([q.sweepCreditReconcileQueue({ DB: D1 }), q.sweepCreditReconcileQueue({ DB: D1 })]);
  assert.equal(a.processed + b.processed, 1);
  assert.equal(a.failed + b.failed, 1);
  assert.equal(rows(db)[0]!.attempts, 1);
});

test('өөр sweep эзэмшсэн мөрийг алгасна; эзэмшил хуучирвал дахин авна', async () => {
  const { db, D1 } = setup();
  await q.enqueueCreditReconcile(D1, 'task', 777, 1, 'x');
  age(db);
  db.exec("UPDATE task_credit_reconcile_queue SET claim_token = 'other', claimed_at = datetime('now')");
  assert.equal((await q.sweepCreditReconcileQueue({ DB: D1 })).processed, 0);
  assert.equal(rows(db).length, 1);
  db.exec(`UPDATE task_credit_reconcile_queue SET claimed_at = datetime('now', '-${q.CLAIM_TTL_MINUTES + 1} minutes')`);
  assert.deepEqual(await q.sweepCreditReconcileQueue({ DB: D1 }), { processed: 1, done: 1, failed: 0 });
  assert.equal(rows(db).length, 0);
});

test('уншсаны дараа, эзэмшихээс ӨМНӨ ирсэн enqueue — sweep тэр мөрийг авахгүй (хувилбар зөрнө)', async () => {
  let D1!: D1Database;
  let injected = false;
  const s = setup(async (sql) => {
    if (!injected && sql.includes('SET claim_token = ?1')) {
      injected = true;
      await q.enqueueCreditReconcile(D1, 'task', 777, 2, 'NEW');
    }
  });
  D1 = s.D1;
  await q.enqueueCreditReconcile(D1, 'task', 777, 1, 'OLD');
  age(s.db);
  assert.equal((await q.sweepCreditReconcileQueue({ DB: D1 })).processed, 0);
  assert.equal(rows(s.db)[0]!.last_error, 'NEW');
});

test('0404-өөс өмнөх DB (version баганагүй) — enqueue ажлыг алдахгүй', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(migration('0402_task_credit_reconcile_queue.sql'));
  const D1 = d1Shim(db);
  await q.enqueueCreditReconcile(D1, 'task', 5, 1, 'x');
  await q.enqueueCreditReconcile(D1, 'task', 5, 1, 'y');
  assert.equal(rows(db).length, 1);
  assert.equal(rows(db)[0]!.last_error, 'y');
});
