// «Сарын статистик» (users.ts) ба managed (хуваарилагдсан) таск — БОДИТ SQLite + бодит миграц (2026-10-05).
// Асуудал: сарын онооны LAG («өмнөх хамгийн өндөр хувь») нь alloc_adj залруулгын projection мөрийг уншиж, «20 → 5 → 12»-ыг
// 20 гэж тоолж буцаалтыг үгүйсгэдэг (эсвэл залруулж-сэргээхийг давхар тоолдог) байв.  Managed таскийн сарын оноо одоо
// журналын (user_points.delta_pct) нийлбэр; legacy таск хуучин LAG-аараа хэвээр.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { USERS, actorOf, legacyEntry, makeDb, rows, session, sum, uid } from '../../test-support/allocHarness.ts';

const Ops = await import('../lib/taskRootOps.ts');
const Users = await import('./users.ts');
const U = 10_000;
const pt = (p: number) => Math.round(p * U);
const { A, B } = USERS;
const OFFSET = '+480 minutes';

const day = (n: number) => `2026-09-${String(n).padStart(2, '0')}`;
const ms = (n: number) => Date.parse(`${day(n)}T10:00:00Z`);
const rev = (h: ReturnType<typeof makeDb>) => rows<{ revision: number }>(h.sqlite, 'SELECT revision FROM task_roots WHERE task_id = 501')[0]!.revision;

async function split(h: ReturnType<typeof makeDb>) {
  const r = await Ops.applyAllocation({ db: h.d1, nowMs: ms(1), today: day(1) }, actorOf(A), {
    taskId: 501,
    requestId: uid('split'),
    expectedRevision: 0,
    mode: 'total',
    targets: [
      { userId: A, targetUnits: pt(60) },
      { userId: B, targetUnits: pt(40) },
    ],
  });
  assert.equal(r.ok, true, JSON.stringify(r));
}

async function progress(h: ReturnType<typeof makeDb>, user: number, percent: number, d: number) {
  const has = sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_timer_sessions WHERE user_id = ? AND task_id = 501', user);
  if (has === 0) session(h.sqlite, { userId: user, taskId: 501, startedAt: `${day(d)}T08:00:00.000Z`, endedAt: `${day(d)}T08:30:00.000Z` });
  const r = await Ops.setOwnProgress({ db: h.d1, nowMs: ms(d), today: day(d) }, actorOf(user), {
    taskId: 501,
    requestId: uid('p'),
    expectedRevision: rev(h),
    doneUnits: pt(percent),
  });
  assert.equal(r.ok, true, JSON.stringify(r));
}

const monthly = (h: ReturnType<typeof makeDb>, from = '2026-09-01', to = '2026-10-01'): Map<number, number> => {
  const r = rows<{ user_id: number; progress_points: number | null }>(h.sqlite, Users.MONTHLY_POINTS_SQL.replace(/\?3/g, `'${OFFSET}'`).replace(/\?1/g, `'${from}'`).replace(/\?2/g, `'${to}'`));
  return new Map(r.map((x) => [x.user_id, x.progress_points ?? 0]));
};

const near = (a: number | undefined, b: number, msg: string) => assert.ok(a !== undefined && Math.abs(a - b) < 1e-3, `${msg}: ${a} ≠ ${b}`);

test('managed таскийн сарын оноо = журналын Δ% (A 30% → 3, B 20% → 2)', async () => {
  const h = makeDb();
  await split(h);
  await progress(h, A, 30, 2);
  await progress(h, B, 20, 3);
  const m = monthly(h);
  near(m.get(A), 3, 'A');
  near(m.get(B), 2, 'B');
});

test('залруулга: A 30% хийгээд бүтнээр нь буцаавал сарын оноо 0 — LAG-ийн «20→5→12» гажуудал үгүй', async () => {
  const h = makeDb();
  await split(h);
  await progress(h, A, 30, 2);
  const [slice] = rows<{ id: number }>(h.sqlite, "SELECT id FROM task_contributions WHERE user_id = ? AND task_id = 501 AND kind = 'work' ORDER BY id", A);
  const c = await Ops.correctOwnProgress({ db: h.d1, nowMs: ms(5), today: day(5) }, actorOf(A), {
    taskId: 501,
    requestId: uid('c'),
    expectedRevision: rev(h),
    items: [{ sliceId: slice!.id }],
  });
  assert.equal(c.ok, true, JSON.stringify(c));
  near(monthly(h).get(A) ?? 0, 0, 'A залруулсны дараа');
});

test('залруулж-сэргээх: оноо давхар тоологдохгүй (буцаалт анхны өдөрт, сэргээлт өөрийн өдөрт)', async () => {
  const h = makeDb();
  await split(h);
  await progress(h, A, 30, 2);
  const [slice] = rows<{ id: number }>(h.sqlite, "SELECT id FROM task_contributions WHERE user_id = ? AND task_id = 501 AND kind = 'work' ORDER BY id", A);
  const correctionId = uid('c');
  const c = await Ops.correctOwnProgress({ db: h.d1, nowMs: ms(5), today: day(5) }, actorOf(A), {
    taskId: 501, requestId: correctionId, expectedRevision: rev(h), items: [{ sliceId: slice!.id }],
  });
  assert.equal(c.ok, true, JSON.stringify(c));
  near(monthly(h).get(A) ?? 0, 0, 'A залруулсны дараа');
  const rs = await Ops.restoreOwnProgress({ db: h.d1, nowMs: ms(6), today: day(6) }, actorOf(A), {
    taskId: 501, requestId: uid('r'), expectedRevision: rev(h), correctionRequestId: correctionId,
  });
  assert.equal(rs.ok, true, JSON.stringify(rs));
  near(monthly(h).get(A), 3, 'A сэргээлтийн дараа (3, 6 биш)');
});

test('сарын хил: өмнөх сарын ажил орохгүй; legacy таск хуучин LAG-аараа хэвээр', async () => {
  const h = makeDb();
  await split(h);
  await progress(h, A, 30, 2);
  // legacy таск 502 (weight 20): 0 → 50% (9-р сар) → +10
  legacyEntry(h.sqlite, { taskId: 502, userId: B, pct: 50, createdAt: `${day(4)}T09:00:00.000Z`, points: { amount: 10, deltaPct: 10 } });
  const sep = monthly(h);
  near(sep.get(A), 3, 'A (managed)');
  near(sep.get(B), 10, 'B (legacy LAG)');
  const oct = monthly(h, '2026-10-01', '2026-11-01');
  assert.equal(oct.size, 0, 'Аравдугаар сард юу ч алга');
});

test('сарын attribution тоолуур alloc_adj залруулгын мөрийг «бусдын бичсэн» гэж тоолохгүй', async () => {
  const h = makeDb();
  await split(h);
  await progress(h, A, 30, 2);
  const before = rows<{ assignee_id: number; entries_on_assigned_tasks: number }>(
    h.sqlite, Users.MONTHLY_ATTRIBUTION_SQL.replace(/\?1/g, "'2026-09-01'").replace(/\?2/g, "'2026-10-01'"));
  const [slice] = rows<{ id: number }>(h.sqlite, "SELECT id FROM task_contributions WHERE user_id = ? AND task_id = 501 AND kind = 'work' ORDER BY id", A);
  const c = await Ops.correctOwnProgress({ db: h.d1, nowMs: ms(5), today: day(5) }, actorOf(A), {
    taskId: 501, requestId: uid('c'), expectedRevision: rev(h), items: [{ sliceId: slice!.id }],
  });
  assert.equal(c.ok, true, JSON.stringify(c));
  const after = rows<{ assignee_id: number; entries_on_assigned_tasks: number }>(
    h.sqlite, Users.MONTHLY_ATTRIBUTION_SQL.replace(/\?1/g, "'2026-09-01'").replace(/\?2/g, "'2026-10-01'"));
  assert.deepEqual(after, before, 'залруулга тоолуурыг нэмэгдүүлэхгүй');
});
