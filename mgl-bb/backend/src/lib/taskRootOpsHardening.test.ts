// Таскийн хуваарилалт — идемпотентийн хурууны хээ + commit-ийн дараах үр дагаврын төлөвийн машин (2026-10-05, 0383).
// Хариу алдагдаж клиент дахин оролдох, ижил request_id өөр агуулгатай ирэх, үр дагавар унаж дахин оролдох тохиолдлууд.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { USERS, actorOf, makeDb, rows, session, uid } from '../../test-support/allocHarness.ts';

const Ops = await import('./taskRootOps.ts');
const Post = await import('./taskPostCommit.ts');
const U = 10_000;
const pt = (p: number) => Math.round(p * U);
const { A, B } = USERS;

const NOW = Date.parse('2026-09-02T10:00:00Z');
const ctxOf = (d1: D1Database, extra: Record<string, unknown> = {}) => ({ db: d1, nowMs: NOW, today: '2026-09-02', ...extra });

async function splitAB(h: ReturnType<typeof makeDb>, requestId = uid('split')) {
  const r = await Ops.applyAllocation(ctxOf(h.d1), actorOf(A), {
    taskId: 501,
    requestId,
    expectedRevision: 0,
    mode: 'total',
    targets: [
      { userId: A, targetUnits: pt(40) },
      { userId: B, targetUnits: pt(60) },
    ],
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}

const opRow = (h: ReturnType<typeof makeDb>, requestId: string) =>
  rows<{ post_status: string; post_json: string | null; post_attempts: number; post_error: string | null; request_hash: string | null }>(
    h.sqlite,
    'SELECT post_status, post_json, post_attempts, post_error, request_hash FROM task_ops WHERE request_id = ?',
    requestId,
  )[0]!;

/* ------------------------------------------------------------------ */
/*  Хурууны хээ                                                         */
/* ------------------------------------------------------------------ */

test('payloadHash: каноник — түлхүүрийн дараалалгүй, утга/төрөл өөр бол өөр', async () => {
  const a = await Post.payloadHash('x', { b: 1, a: [1, 2], c: { y: 1, x: 2 } });
  const b = await Post.payloadHash('x', { c: { x: 2, y: 1 }, a: [1, 2], b: 1 });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, await Post.payloadHash('x', { b: 1, a: [2, 1], c: { y: 1, x: 2 } }));
  assert.notEqual(a, await Post.payloadHash('y', { b: 1, a: [1, 2], c: { y: 1, x: 2 } }));
  assert.notEqual(await Post.payloadHash('x', { n: 1 }), await Post.payloadHash('x', { n: '1' }));
  assert.equal(await Post.payloadHash('x', { n: undefined, m: 1 }), await Post.payloadHash('x', { m: 1 }));
});

test('split: ИЖИЛ request_id + ИЖИЛ агуулга (хүмүүсийн дараалал өөр ч) = replay; ӨӨР агуулга = 409 REQUEST_REUSED', async () => {
  const h = makeDb();
  const rid = uid('split');
  await splitAB(h, rid);
  const swapped = await Ops.applyAllocation(ctxOf(h.d1), actorOf(A), {
    taskId: 501, requestId: rid, expectedRevision: 0, mode: 'total',
    targets: [{ userId: B, targetUnits: pt(60) }, { userId: A, targetUnits: pt(40) }],
  });
  assert.equal(swapped.ok, true);
  assert.equal(swapped.ok && swapped.replayed, true);

  const different = await Ops.applyAllocation(ctxOf(h.d1), actorOf(A), {
    taskId: 501, requestId: rid, expectedRevision: 0, mode: 'total',
    targets: [{ userId: A, targetUnits: pt(50) }, { userId: B, targetUnits: pt(50) }],
  });
  assert.equal(different.ok, false);
  assert.equal(!different.ok && different.code, 'REQUEST_REUSED');
  // Өөр горимтой ижил тоо ч өөр агуулга.
  const otherMode = await Ops.applyAllocation(ctxOf(h.d1), actorOf(A), {
    taskId: 501, requestId: rid, expectedRevision: 0, mode: 'remainder',
    targets: [{ userId: A, targetUnits: pt(40) }, { userId: B, targetUnits: pt(60) }],
  });
  assert.equal(!otherMode.ok && otherMode.code, 'REQUEST_REUSED');
  // Анхны хуваарилалт ХӨНДӨГДӨӨГҮЙ.
  const a = rows<{ target_units: number }>(h.sqlite, 'SELECT target_units FROM task_allocations WHERE user_id = ?', A)[0]!;
  assert.equal(a.target_units, pt(40));
  assert.match(opRow(h, rid).request_hash ?? '', /^[0-9a-f]{64}$/);
});

test('progress: хариу алдагдаж ИЖИЛ хүсэлт дахин ирвэл replay (давхар оноо үгүй); өөр done_units = REQUEST_REUSED', async () => {
  const h = makeDb();
  await splitAB(h);
  session(h.sqlite, { userId: A, taskId: 501, startedAt: '2026-09-02T09:00:00.000Z', endedAt: '2026-09-02T09:30:00.000Z' });
  const rid = uid('p');
  const input = { taskId: 501, requestId: rid, expectedRevision: 1, doneUnits: pt(10) };
  const first = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), input);
  assert.equal(first.ok, true, JSON.stringify(first));
  const pointsAfter = rows<{ n: number }>(h.sqlite, 'SELECT COUNT(*) AS n FROM user_points')[0]!.n;

  const retry = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), input);
  assert.equal(retry.ok && retry.replayed, true);
  assert.deepEqual(retry.ok && retry.data, first.ok && first.data);
  assert.equal(rows<{ n: number }>(h.sqlite, 'SELECT COUNT(*) AS n FROM user_points')[0]!.n, pointsAfter);

  // revision хуучирсан ч (клиент ижил хүсэлтийг дахин илгээв) replay.
  const staleRetry = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), { ...input, expectedRevision: 1 });
  assert.equal(staleRetry.ok && staleRetry.replayed, true);

  const changed = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), { ...input, doneUnits: pt(15) });
  assert.equal(changed.ok, false);
  assert.equal(!changed.ok && changed.code, 'REQUEST_REUSED');
  assert.equal(rows<{ n: number }>(h.sqlite, 'SELECT done_units AS n FROM task_allocations WHERE user_id = ?', A)[0]!.n, pt(10));
});

test('release / retake / correct / restore: ижил request_id өөр агуулгатай бол REQUEST_REUSED', async () => {
  const h = makeDb();
  await splitAB(h);
  const rel = uid('rel');
  const r1 = await Ops.releaseOwn(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: rel, expectedRevision: 1, toUserId: B });
  assert.equal(r1.ok, true, JSON.stringify(r1));
  const r2 = await Ops.releaseOwn(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: rel, expectedRevision: 1, toUserId: null });
  assert.equal(!r2.ok && r2.code, 'REQUEST_REUSED');
  const r3 = await Ops.releaseOwn(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: rel, expectedRevision: 1, toUserId: B });
  assert.equal(r3.ok && r3.replayed, true);

  const take = uid('take');
  const t1 = await Ops.retakeAllocation(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: take, expectedRevision: 2, units: pt(5) });
  // Хүлээн авагчид бүгдийг шилжүүлсэн тул чөлөөт ажил 0 — татгалзана (op бичигдэхгүй) → ижил id шинэ агуулгаар ЧӨЛӨӨТЭЙ.
  assert.equal(t1.ok, false);
  const t2 = await Ops.retakeAllocation(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: take, expectedRevision: 2, units: pt(1) });
  assert.equal(t2.ok, false);
  assert.notEqual(!t2.ok && t2.code, 'REQUEST_REUSED', 'амжилтгүй хүсэлт request_id-г ЗАРЦУУЛААГҮЙ');
});

test('0383-ээс өмнөх мөр (request_hash = NULL) харьцуулагдахгүй — хуучин зан төлөв (replay)', async () => {
  const h = makeDb();
  const rid = uid('split');
  await splitAB(h, rid);
  h.sqlite.prepare('UPDATE task_ops SET request_hash = NULL WHERE request_id = ?').run(rid);
  const r = await Ops.applyAllocation(ctxOf(h.d1), actorOf(A), {
    taskId: 501, requestId: rid, expectedRevision: 0, mode: 'total',
    targets: [{ userId: A, targetUnits: pt(10) }, { userId: B, targetUnits: pt(90) }],
  });
  assert.equal(r.ok && r.replayed, true);
});

/* ------------------------------------------------------------------ */
/*  Commit-ийн дараах үр дагавар                                        */
/* ------------------------------------------------------------------ */

test('үр дагаваргүй үйлдэл (split) → post_status done, post_json null', async () => {
  const h = makeDb();
  const rid = uid('split');
  await splitAB(h, rid);
  const op = opRow(h, rid);
  assert.equal(op.post_status, 'done');
  assert.equal(op.post_json, null);
});

/** Өмнөх өдрийн оноо бүхий managed ажлыг залруулах → snapshotFrom (өнгөрсөн өдөр) → refreshSnapshotsAfter. */
async function correctionWithSnapshotEffect(h: ReturnType<typeof makeDb>, extra: Record<string, unknown> = {}) {
  await splitAB(h);
  session(h.sqlite, { userId: A, taskId: 501, startedAt: '2026-09-02T09:00:00.000Z', endedAt: '2026-09-02T09:30:00.000Z' });
  const up = await Ops.setOwnProgress(ctxOf(h.d1, extra), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: 1, doneUnits: pt(10) });
  assert.equal(up.ok, true, JSON.stringify(up));
  const slice = rows<{ id: number }>(h.sqlite, "SELECT id FROM task_contributions WHERE kind = 'work' ORDER BY id LIMIT 1")[0]!;
  // Дараагийн өдөр залруулна → буцаалт 09-02-д бичигдэнэ → 09-02-оос хойших snapshot дахин бодогдох ёстой.
  const rid = uid('corr');
  const corr = await Ops.correctOwnProgress(
    { db: h.d1, nowMs: NOW + 86_400_000, today: '2026-09-03', ...extra },
    actorOf(A),
    { taskId: 501, requestId: rid, expectedRevision: 2, items: [{ sliceId: slice.id }] },
  );
  assert.equal(corr.ok, true, JSON.stringify(corr));
  return rid;
}

test('залруулга: post_status pending → (үр дагавар амжилттай) done; post_json-д өнгөрсөн өдөр', async () => {
  const h = makeDb();
  const rid = await correctionWithSnapshotEffect(h);
  const op = opRow(h, rid);
  assert.equal(op.post_status, 'done', JSON.stringify(op));
  const effects = JSON.parse(op.post_json ?? 'null');
  assert.equal(effects.snapshotFrom, '2026-09-02');
  assert.equal(effects.taskId, 501);
});

test('үр дагавар унавал pending + алдаа + оролдлого; sweep дахин оролдож 8 дахь удаа failed болгоно', async () => {
  const h = makeDb();
  // snapshot-ийн мөр байвал `snapshotDay` ажиллаж (хялбаршуулсан схемд) унана — бодит алдааны эх.
  h.sqlite.exec("INSERT INTO employee_daily_snapshots (date, user_id) VALUES ('2026-09-10', 3)");
  const rid = await correctionWithSnapshotEffect(h);
  let op = opRow(h, rid);
  assert.equal(op.post_status, 'pending', JSON.stringify(op));
  assert.equal(op.post_attempts, 1);
  assert.equal(op.post_error, 'snapshot');

  // Шинэ marker (2 минутаас залуу) sweep-д ороогүй.
  const fresh = await Post.sweepPendingPostCommit({ DB: h.d1 });
  assert.equal(fresh.processed, 0);

  h.sqlite.prepare("UPDATE task_ops SET created_at = datetime('now', '-10 minutes') WHERE request_id = ?").run(rid);
  for (let i = 0; i < 7; i++) {
    const r = await Post.sweepPendingPostCommit({ DB: h.d1 });
    assert.equal(r.processed, 1, `оролдлого ${i + 2}`);
  }
  op = opRow(h, rid);
  assert.equal(op.post_status, 'failed', JSON.stringify(op));
  assert.equal(op.post_attempts, 8);
  assert.equal((await Post.sweepPendingPostCommit({ DB: h.d1 })).processed, 0, 'failed дахин оролдогдохгүй');
});

test('унасан үр дагавар шалтгаан арилмагц sweep-ээр done болно (гараар засах шаардлагагүй)', async () => {
  const h = makeDb();
  h.sqlite.exec("INSERT INTO employee_daily_snapshots (date, user_id) VALUES ('2026-09-10', 3)");
  const rid = await correctionWithSnapshotEffect(h);
  assert.equal(opRow(h, rid).post_status, 'pending');
  h.sqlite.exec('DELETE FROM employee_daily_snapshots'); // шалтгаан арилав
  h.sqlite.prepare("UPDATE task_ops SET created_at = datetime('now', '-10 minutes') WHERE request_id = ?").run(rid);
  const r = await Post.sweepPendingPostCommit({ DB: h.d1 });
  assert.deepEqual(r, { processed: 1, done: 1, failed: 0 });
  const op = opRow(h, rid);
  assert.equal(op.post_status, 'done');
  assert.equal(op.post_error, null);
});

test('хариу алдагдаж клиент ижил хүсэлтийг дахин илгээвэл pending үр дагавар ДАХИН ажиллана (replay)', async () => {
  const h = makeDb();
  h.sqlite.exec("INSERT INTO employee_daily_snapshots (date, user_id) VALUES ('2026-09-10', 3)");
  const rid = await correctionWithSnapshotEffect(h);
  assert.equal(opRow(h, rid).post_status, 'pending');
  h.sqlite.exec('DELETE FROM employee_daily_snapshots');

  const jobs: Promise<unknown>[] = [];
  const slice = rows<{ id: number }>(h.sqlite, "SELECT id FROM task_contributions WHERE kind = 'work' ORDER BY id LIMIT 1")[0]!;
  const replay = await Ops.correctOwnProgress(
    { db: h.d1, nowMs: NOW + 86_400_000, today: '2026-09-03', waitUntil: (p: Promise<unknown>) => void jobs.push(p) },
    actorOf(A),
    { taskId: 501, requestId: rid, expectedRevision: 2, items: [{ sliceId: slice.id }] },
  );
  assert.equal(replay.ok && replay.replayed, true);
  assert.equal(jobs.length, 1, 'арын дэвсгэрт нэг дахин оролдлого');
  await Promise.all(jobs);
  assert.equal(opRow(h, rid).post_status, 'done');
});

test('settlePostCommit: үр дагаваргүй бол юу ч бичихгүй; hasPostEffects', () => {
  const base = { taskId: 1, projectId: 1, owner: 1, today: '2026-09-02', completedRoot: false, increase: false, snapshotFrom: null };
  assert.equal(Post.hasPostEffects(base), false);
  assert.equal(Post.hasPostEffects({ ...base, increase: true }), true);
  assert.equal(Post.hasPostEffects({ ...base, completedRoot: true }), true);
  assert.equal(Post.hasPostEffects({ ...base, snapshotFrom: '2026-09-01' }), true);
  assert.equal(Post.hasPostEffects({ ...base, snapshotFrom: '2026-09-02' }), false, 'өнөөдөр = хуучирсан snapshot байхгүй');
});

/* ------------------------------------------------------------------ */
/*  D1-ийн 100-bind хязгаар                                              */
/* ------------------------------------------------------------------ */

test('loadRootsForTasks: 250 таскийн id-г хэсэглэнэ (D1 100-bind хязгаар) — өмнө нь managed таскууд чимээгүй алга болдог байв', async () => {
  const Store = await import('./taskRootStore.ts');
  const h = makeDb();
  const ids: number[] = [];
  const stmt = h.sqlite.prepare('INSERT INTO task_roots (task_id, revision, unallocated_units) VALUES (?, 1, 1000000)');
  for (let i = 0; i < 250; i++) {
    const id = 10_000 + i;
    ids.push(id);
    if (i % 2 === 0) stmt.run(id); // тэн хагас нь managed
  }
  h.sqlite.prepare('INSERT INTO task_allocations (task_id, user_id, ordinal, target_units) VALUES (10124, 3, 1, 100000)').run();
  // Хязгаарыг харуулах: хэсэглээгүй бол shim-д унана.
  assert.throws(
    () => h.d1.prepare(`SELECT task_id FROM task_roots WHERE task_id IN (${ids.map(() => '?').join(',')})`).bind(...ids),
    /too many SQL variables/,
  );
  const map = await Store.loadRootsForTasks(h.d1, [...ids, ...ids]); // давхардал ч зөв
  assert.equal(map.size, 125);
  assert.equal(map.get(10124)?.allocations.length, 1);
  assert.equal(map.has(10001), false);
  assert.deepEqual(Store.chunked([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(Store.chunked([], 2), []);
});
