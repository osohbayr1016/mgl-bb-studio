// Managed root устгалын хамгаалалт (2026-10-05): fail-closed, төслийн хүрээ, scaffold-ийн блокийн гишүүнчлэл,
// хуучин task_shares дахин хуваалт managed таскийг хөндөхгүй.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { USERS, actorOf, makeDb, rows, session, uid } from '../../test-support/allocHarness.ts';

const Ops = await import('./taskRootOps.ts');
const Guard = await import('./taskRootGuard.ts');
const Shares = await import('./taskShares.ts');
const Blocks = await import('../routes/blocks.ts');
const U = 10_000;
const pt = (p: number) => Math.round(p * U);
const { A, B } = USERS;
const NOW = Date.parse('2026-10-02T10:00:00Z');
const ctx = (d1: D1Database) => ({ db: d1, nowMs: NOW, today: '2026-10-02' });

async function managedWithHistory(h: ReturnType<typeof makeDb>) {
  const s = await Ops.applyAllocation(ctx(h.d1), actorOf(A), {
    taskId: 501, requestId: uid('s'), expectedRevision: 0, mode: 'total',
    targets: [{ userId: A, targetUnits: pt(60) }, { userId: B, targetUnits: pt(40) }],
  });
  assert.equal(s.ok, true, JSON.stringify(s));
  session(h.sqlite, { userId: A, taskId: 501, startedAt: '2026-10-02T08:00:00.000Z', endedAt: '2026-10-02T08:30:00.000Z' });
  const p = await Ops.setOwnProgress(ctx(h.d1), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: 1, doneUnits: pt(20) });
  assert.equal(p.ok, true, JSON.stringify(p));
}

test('protectedRootsIn: түүхтэй root устгалыг хаана (task / block / project хүрээ)', async () => {
  const h = makeDb();
  await managedWithHistory(h);
  assert.deepEqual(await Guard.protectedRootsIn(h.d1, { kind: 'task', id: 501 }), [501]);
  assert.deepEqual(await Guard.protectedRootsIn(h.d1, { kind: 'block', id: 100 }), [501]);
  assert.deepEqual(await Guard.protectedRootsIn(h.d1, { kind: 'project', id: 10 }), [501]);
  assert.deepEqual(await Guard.protectedRootsIn(h.d1, { kind: 'project', id: 20 }), [], 'өөр төсөл');
});

test('protectedRootsIn: түүхгүй root хаагдахгүй (эхний хуваалт, хэн ч хийгээгүй)', async () => {
  const h = makeDb();
  const s = await Ops.applyAllocation(ctx(h.d1), actorOf(A), {
    taskId: 501, requestId: uid('s'), expectedRevision: 0, mode: 'total', targets: [{ userId: A, targetUnits: pt(100) }],
  });
  assert.equal(s.ok, true);
  assert.deepEqual(await Guard.protectedRootsIn(h.d1, { kind: 'project', id: 10 }), []);
});

test('protectedRootsIn FAIL-CLOSED: D1 алдаа гарвал [] биш шидэгдэнэ; зөвхөн «хүснэгт байхгүй» л тэр хүснэгтийн хувьд []', async () => {
  const boom = { prepare: () => { throw new Error('D1_ERROR: network connection lost'); } } as unknown as D1Database;
  await assert.rejects(Guard.protectedRootsIn(boom, { kind: 'task', id: 1 }), /network connection lost/);
  const noTables = {
    prepare: (sql: string) => {
      throw new Error(`D1_ERROR: no such table: ${sql.includes('task_conversion_members') ? 'task_conversion_members' : 'task_roots'}`);
    },
  } as unknown as D1Database;
  assert.deepEqual(await Guard.protectedRootsIn(noTables, { kind: 'task', id: 1 }), []);
  // task_roots-ийн ӨӨР алдаа 0385-ын «хүснэгт байхгүй» болж далдлагдахгүй.
  const rootsBoom = {
    prepare: (sql: string) => {
      if (sql.includes('task_conversion_members')) throw new Error('D1_ERROR: no such table: task_conversion_members');
      throw new Error('D1_ERROR: network connection lost');
    },
  } as unknown as D1Database;
  await assert.rejects(Guard.protectedRootsIn(rootsBoom, { kind: 'task', id: 1 }), /network connection lost/);
});

test('0385 хараахан хэрэгжээгүй (worker миграцаас түрүүлсэн) орчинд ч түүхтэй managed root-ийн устгал ХААГДАНА (fail-open биш)', async () => {
  const h = makeDb();
  await managedWithHistory(h);
  h.sqlite.exec('DROP TABLE task_conversion_members; DROP TABLE task_conversions;');
  assert.deepEqual(await Guard.protectedRootsIn(h.d1, { kind: 'task', id: 501 }), [501]);
  assert.deepEqual(await Guard.protectedRootsIn(h.d1, { kind: 'block', id: 100 }), [501]);
  assert.deepEqual(await Guard.protectedRootsIn(h.d1, { kind: 'project', id: 10 }), [501]);
  // түүхгүй root: хамгаалагдахгүй (хуучин зан)
  const clean = makeDb();
  clean.sqlite.exec('DROP TABLE task_conversion_members; DROP TABLE task_conversions;');
  assert.deepEqual(await Guard.protectedRootsIn(clean.d1, { kind: 'task', id: 501 }), []);
});

test('scaffold: idsOutsideBlock — өөр блок/төслийн id-г илрүүлнэ, өөрийн блокийнхыг зөвшөөрнө', async () => {
  const h = makeDb();
  // блок 100: зураг 1000, компонент 1, таск 501/502/503/504; блок 200: зураг 2000, компонент 2, таск 601
  const ok = await Blocks.idsOutsideBlock(h.d1, 100, { drawings: [1000], components: [1], tasks: [501, 502] });
  assert.deepEqual(ok, { drawings: [], components: [], tasks: [] });
  const bad = await Blocks.idsOutsideBlock(h.d1, 100, { drawings: [1000, 2000], components: [1, 2], tasks: [501, 601, 9999] });
  assert.deepEqual(bad, { drawings: [2000], components: [2], tasks: [601, 9999] });
  // давхардсан id нэг удаа, 90-ээс олон id хэсэглэгдэнэ
  const many = Array.from({ length: 250 }, (_, i) => 700_000 + i);
  const big = await Blocks.idsOutsideBlock(h.d1, 100, { drawings: [], components: [], tasks: [...many, ...many] });
  assert.equal(big.tasks.length, 250);
});

test('redistributeTaskPoints: managed таскийн оноог ХӨНДӨХГҮЙ', async () => {
  const h = makeDb();
  await managedWithHistory(h);
  const before = rows(h.sqlite, 'SELECT id, user_id, amount, delta_pct FROM user_points WHERE task_id = 501 ORDER BY id');
  h.sqlite.prepare('INSERT INTO task_shares (task_id, user_id, share_percent, is_owner) VALUES (501, ?, 50, 1), (501, ?, 50, 0)').run(A, B);
  await Shares.redistributeTaskPoints(h.d1, 501);
  const after = rows(h.sqlite, 'SELECT id, user_id, amount, delta_pct FROM user_points WHERE task_id = 501 ORDER BY id');
  assert.deepEqual(after, before);
});
