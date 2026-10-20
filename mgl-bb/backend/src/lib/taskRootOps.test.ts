// Таскийн хуваарилалтын мутацууд — БОДИТ SQLite + бодит миграц (0376–0379) дээр (2026-10-02).
// Хуваах/засах, seed, өөрийн явц (оноо, буцаалт, QA, дуусах), буцаах/шилжүүлэх/дахин авах, идемпотент, CAS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLE, USERS, actorOf, legacyEntry, makeDb, rows, session, sum, uid } from '../../test-support/allocHarness.ts';

const Ops = await import('./taskRootOps.ts');
const Store = await import('./taskRootStore.ts');
const U = 10_000;
const pt = (p: number) => Math.round(p * U);
const { A, B, C, SENIOR, ADMIN } = USERS;

const NOW = Date.parse('2026-10-02T10:00:00Z');
const T0 = '2026-10-02T09:00:00.000Z';
const ctxOf = (d1: D1Database, nowMs = NOW) => ({ db: d1, nowMs, today: '2026-10-02' });

/** 40/60 хуваалт: A=40, B=60 (managed болгоно). */
async function splitAB(h: ReturnType<typeof makeDb>, taskId = 501, a = 40, b = 60) {
  const r = await Ops.applyAllocation(ctxOf(h.d1), actorOf(A), {
    taskId,
    requestId: uid('split'),
    expectedRevision: 0,
    mode: 'total',
    targets: [
      { userId: A, targetUnits: pt(a) },
      { userId: B, targetUnits: pt(b) },
    ],
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw new Error('unreachable');
  return r.data;
}

const alloc = (h: ReturnType<typeof makeDb>, taskId: number, userId: number) =>
  rows<{ target_units: number; done_units: number; floor_units: number; released_units: number; ordinal: number; revision: number }>(
    h.sqlite,
    'SELECT target_units, done_units, floor_units, released_units, ordinal, revision FROM task_allocations WHERE task_id = ? AND user_id = ?',
    taskId,
    userId,
  )[0];
const pointsNet = (h: ReturnType<typeof makeDb>, userId: number, taskId = 501) =>
  sum(h.sqlite, `SELECT SUM(amount) AS v FROM user_points WHERE user_id = ? AND task_id = ?`, userId, taskId);
const rootRow = (h: ReturnType<typeof makeDb>, taskId = 501) =>
  rows<{ revision: number; unattributed_units: number; unallocated_units: number; slack_units: number; completed_at: string | null; next_ordinal: number }>(
    h.sqlite,
    'SELECT * FROM task_roots WHERE task_id = ?',
    taskId,
  )[0];
const latestPct = (h: ReturnType<typeof makeDb>, taskId = 501) =>
  sum(h.sqlite, `SELECT percentage AS v FROM progress_entries WHERE task_id = ? AND status = 'approved' ORDER BY created_at DESC, id DESC LIMIT 1`, taskId);

/* ------------------------------------------------------------------ */
/*  1. Хуваах / managed болгох                                          */
/* ------------------------------------------------------------------ */

test('хуваах 40/60: нэг таск, жин ХӨДЛӨХГҮЙ, шинэ таск үүсэхгүй, оноо/явц бичигдэхгүй', async () => {
  const h = makeDb();
  const tasksBefore = sum(h.sqlite, 'SELECT COUNT(*) AS v FROM tasks');
  const data = await splitAB(h);
  assert.equal(data.converted, true);
  assert.equal(data.root.revision, 1);
  assert.equal(data.root.root_done_units, 0);
  assert.equal(data.root.unallocated_units, 0);
  assert.deepEqual(
    data.root.participants.map((p) => [p.user_id, p.ordinal, p.target_units, p.done_units]),
    [
      [A, 1, pt(40), 0],
      [B, 2, pt(60), 0],
    ],
  );
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM tasks'), tasksBefore); // шинэ таск үгүй
  assert.equal(sum(h.sqlite, 'SELECT weight_percent AS v FROM tasks WHERE id = 501'), 10); // W хөдлөөгүй
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM user_points'), 0); // хуваалт оноо өгөхгүй
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM progress_entries'), 0);
  assert.equal(rootRow(h)?.next_ordinal, 3);
  const op = rows<{ kind: string }>(h.sqlite, 'SELECT kind FROM task_ops');
  assert.deepEqual(op.map((o) => o.kind), ['split']);
});

test('ижил request_id дахин ирвэл анхны үр дүн, дахин бичигдэхгүй (идемпотент)', async () => {
  const h = makeDb();
  const requestId = uid('split');
  const input = {
    taskId: 501,
    requestId,
    expectedRevision: 0,
    mode: 'total' as const,
    targets: [
      { userId: A, targetUnits: pt(40) },
      { userId: B, targetUnits: pt(60) },
    ],
  };
  const first = await Ops.applyAllocation(ctxOf(h.d1), actorOf(A), input);
  const again = await Ops.applyAllocation(ctxOf(h.d1), actorOf(A), input);
  assert.equal(first.ok && again.ok, true);
  if (first.ok && again.ok) {
    assert.equal(again.replayed, true);
    assert.deepEqual(again.data, first.data);
  }
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_allocations'), 2);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_ops'), 1);
});

test('request_id өөр хэрэглэгч/таскт ашиглагдвал REQUEST_REUSED', async () => {
  const h = makeDb();
  const requestId = uid('split');
  await Ops.applyAllocation(ctxOf(h.d1), actorOf(A), {
    taskId: 501, requestId, expectedRevision: 0, mode: 'total',
    targets: [{ userId: A, targetUnits: pt(40) }, { userId: B, targetUnits: pt(60) }],
  });
  const r = await Ops.applyAllocation(ctxOf(h.d1), actorOf(B), {
    taskId: 501, requestId, expectedRevision: 0, mode: 'total',
    targets: [{ userId: A, targetUnits: pt(40) }, { userId: B, targetUnits: pt(60) }],
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'REQUEST_REUSED');
});

test('хуучирсан revision → 409 STALE_REVISION + одоогийн төлөв, юу ч бичигдэхгүй', async () => {
  const h = makeDb();
  await splitAB(h);
  const before = sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_ops');
  const stale = await Ops.applyAllocation(ctxOf(h.d1), actorOf(A), {
    taskId: 501, requestId: uid('edit'), expectedRevision: 0, mode: 'total',
    targets: [{ userId: A, targetUnits: pt(50) }, { userId: B, targetUnits: pt(50) }],
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) {
    assert.equal(stale.status, 409);
    assert.equal(stale.code, 'STALE_REVISION');
    assert.equal((stale.extra?.current as { revision: number }).revision, 1);
  }
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_ops'), before);
  assert.equal(alloc(h, 501, A)?.target_units, pt(40)); // өөрчлөгдөөгүй
});

test('засвар 40/60 → 50/50: оролцогч засна, ordinal хэвээр, revision өснө', async () => {
  const h = makeDb();
  await splitAB(h);
  const r = await Ops.applyAllocation(ctxOf(h.d1), actorOf(B), {
    taskId: 501, requestId: uid('edit'), expectedRevision: 1, mode: 'total',
    targets: [{ userId: A, targetUnits: pt(50) }, { userId: B, targetUnits: pt(50) }],
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(alloc(h, 501, A)?.target_units, pt(50));
  assert.equal(alloc(h, 501, B)?.target_units, pt(50));
  assert.equal(alloc(h, 501, A)?.ordinal, 1);
  assert.equal(rootRow(h)?.revision, 2);
});

test('оролцогч биш инженер (managed таск) засахыг 403, ахлах засна', async () => {
  const h = makeDb();
  await splitAB(h);
  const input = {
    taskId: 501, expectedRevision: 1, mode: 'total' as const,
    targets: [{ userId: A, targetUnits: pt(30) }, { userId: B, targetUnits: pt(70) }],
  };
  const no = await Ops.applyAllocation(ctxOf(h.d1), actorOf(C), { ...input, requestId: uid('edit') });
  assert.equal(no.ok, false);
  if (!no.ok) {
    assert.equal(no.status, 403);
    assert.equal(no.code, 'NOT_PARTICIPANT');
  }
  const yes = await Ops.applyAllocation(ctxOf(h.d1), actorOf(SENIOR), { ...input, requestId: uid('edit') });
  assert.equal(yes.ok, true);
});

test('шинэ хүн нэмэх: eligible биш (client/идэвхгүй/админ) татгалзана; шинэ хүн ordinal 3', async () => {
  const h = makeDb();
  await splitAB(h);
  h.sqlite.exec(`INSERT INTO users (id, username, full_name, role, status) VALUES (20, 'x', 'Идэвхгүй', 'engineer', 'inactive'), (21, 'cl', 'Клиент', 'client', 'active')`);
  for (const bad of [20, 21, ADMIN]) {
    const r = await Ops.applyAllocation(ctxOf(h.d1), actorOf(A), {
      taskId: 501, requestId: uid('edit'), expectedRevision: 1, mode: 'total',
      targets: [{ userId: A, targetUnits: pt(30) }, { userId: B, targetUnits: pt(40) }, { userId: bad, targetUnits: pt(30) }],
    });
    assert.equal(r.ok, false, `user ${bad}`);
    if (!r.ok) assert.equal(r.code, 'USER_NOT_ELIGIBLE');
  }
  const ok = await Ops.applyAllocation(ctxOf(h.d1), actorOf(A), {
    taskId: 501, requestId: uid('edit'), expectedRevision: 1, mode: 'total',
    targets: [{ userId: A, targetUnits: pt(30) }, { userId: B, targetUnits: pt(40) }, { userId: C, targetUnits: pt(30) }],
  });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(alloc(h, 501, C)?.ordinal, 3);
});

test('нийлбэр 100 биш / давхардсан хүн / хийсэнээс бага зорилт → татгалзана, юу ч бичигдэхгүй', async () => {
  const h = makeDb();
  const bad = await Ops.applyAllocation(ctxOf(h.d1), actorOf(A), {
    taskId: 501, requestId: uid('split'), expectedRevision: 0, mode: 'total',
    targets: [{ userId: A, targetUnits: pt(40) }, { userId: B, targetUnits: pt(50) }],
  });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.code, 'SUM_MISMATCH');
  const dup = await Ops.applyAllocation(ctxOf(h.d1), actorOf(A), {
    taskId: 501, requestId: uid('split'), expectedRevision: 0, mode: 'total',
    targets: [{ userId: A, targetUnits: pt(50) }, { userId: A, targetUnits: pt(50) }],
  });
  assert.equal(dup.ok, false);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_roots'), 0);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_ops'), 0);
});

test('хуваагдах биш таск (жин 0, цагаар бодох төсөл), идэвхгүй төсөл → татгалзана', async () => {
  const h = makeDb();
  const meeting = await Ops.applyAllocation(ctxOf(h.d1), actorOf(A), {
    taskId: 503, requestId: uid('split'), expectedRevision: 0, mode: 'total',
    targets: [{ userId: A, targetUnits: pt(50) }, { userId: B, targetUnits: pt(50) }],
  });
  assert.equal(meeting.ok, false);
  if (!meeting.ok) assert.equal(meeting.code, 'NOT_SPLITTABLE');
  const hours = await Ops.applyAllocation(ctxOf(h.d1), actorOf(A), {
    taskId: 601, requestId: uid('split'), expectedRevision: 0, mode: 'total',
    targets: [{ userId: A, targetUnits: pt(50) }, { userId: B, targetUnits: pt(50) }],
  });
  assert.equal(hours.ok, false);
  if (!hours.ok) assert.equal(hours.code, 'HOURS_MODE');
  h.sqlite.exec(`UPDATE projects SET status = 'archived' WHERE id = 10`);
  const arch = await Ops.applyAllocation(ctxOf(h.d1), actorOf(A), {
    taskId: 501, requestId: uid('split'), expectedRevision: 0, mode: 'total',
    targets: [{ userId: A, targetUnits: pt(50) }, { userId: B, targetUnits: pt(50) }],
  });
  assert.equal(arch.ok, false);
  if (!arch.ok) assert.equal(arch.code, 'PROJECT_INACTIVE');
});

/* ------------------------------------------------------------------ */
/*  2. Өөрийн явц: оноо, буцаалт                                        */
/* ------------------------------------------------------------------ */

test('өөрийн явц: хүчинтэй цагийн сэшнгүй бол TAKE_REQUIRED; сэшнтэй бол root=10%, оноо = 10 пункт × 0.1', async () => {
  const h = makeDb();
  const data = await splitAB(h);
  const noSession = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), {
    taskId: 501, requestId: uid('prog'), expectedRevision: data.root.revision, doneUnits: pt(10),
  });
  assert.equal(noSession.ok, false);
  if (!noSession.ok) assert.equal(noSession.code, 'TAKE_REQUIRED');

  session(h.sqlite, { userId: A, taskId: 501, startedAt: T0, endedAt: '2026-10-02T09:30:00.000Z' });
  const r = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), {
    taskId: 501, requestId: uid('prog'), expectedRevision: data.root.revision, doneUnits: pt(10),
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  assert.equal(r.data.kind, 'increase');
  assert.equal(r.data.root.root_done_units, pt(10));
  assert.equal(alloc(h, 501, A)?.done_units, pt(10));
  assert.equal(latestPct(h), 10);
  assert.equal(pointsNet(h, A), 1); // 10 пункт × coef 0.1 × complexity 100% = 1
  assert.equal(pointsNet(h, B), 0); // бусдад оноо хуваагдахгүй
  // Projection = actor-ын тайлан (source alloc), root progress 10
  const pe = rows<{ source: string; user_id: number; percentage: number }>(h.sqlite, 'SELECT source, user_id, percentage FROM progress_entries');
  assert.deepEqual(pe.map((x) => [x.source, x.user_id, x.percentage]), [['alloc', A, 10]]);
});

test('ижил утга дахин хадгалах = noop: бичлэг, оноо, ops үүсэхгүй', async () => {
  const h = makeDb();
  const data = await splitAB(h);
  session(h.sqlite, { userId: A, taskId: 501, startedAt: T0, endedAt: '2026-10-02T09:30:00.000Z' });
  const r1 = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: data.root.revision, doneUnits: pt(10) });
  assert.equal(r1.ok, true);
  const rev = rootRow(h)?.revision ?? 0;
  const r2 = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: rev, doneUnits: pt(10) });
  assert.equal(r2.ok, true);
  if (r2.ok) assert.equal(r2.data.noop, true);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM progress_entries'), 1);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM user_points'), 1);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_ops'), 2); // split + 1 progress
  assert.equal(rootRow(h)?.revision, rev);
});

test('нэмээд буцаах: сөрөг оноо АНХНЫ өдөрт, цэвэр оноо буурна, projection alloc_adj', async () => {
  const h = makeDb();
  const data = await splitAB(h);
  session(h.sqlite, { userId: A, taskId: 501, startedAt: T0, endedAt: '2026-10-02T09:30:00.000Z' });
  let rev = data.root.revision;
  const up = await Ops.setOwnProgress(ctxOf(h.d1, NOW), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: rev, doneUnits: pt(25) });
  assert.equal(up.ok, true, JSON.stringify(up));
  rev = rootRow(h)!.revision;
  const originalAwardedAt = rows<{ awarded_at: string }>(h.sqlite, 'SELECT awarded_at FROM user_points WHERE reverses_points_id IS NULL')[0]!.awarded_at;
  assert.equal(pointsNet(h, A), 2.5);

  // Хоёр хоногийн дараа буцаана (өөр өдөр) — буцаалт анхны өдөрт бичигдэх ёстой.
  const later = NOW + 2 * 24 * 3600 * 1000;
  const down = await Ops.setOwnProgress(
    { db: h.d1, nowMs: later, today: '2026-10-04' },
    actorOf(A),
    { taskId: 501, requestId: uid('p'), expectedRevision: rev, doneUnits: pt(15) },
  );
  assert.equal(down.ok, true, JSON.stringify(down));
  if (!down.ok) return;
  assert.equal(down.data.kind, 'decrease');
  assert.equal(down.data.root.root_done_units, pt(15));
  assert.equal(alloc(h, 501, A)?.done_units, pt(15));
  assert.ok(Math.abs(pointsNet(h, A) - 1.5) < 1e-9, `net ${pointsNet(h, A)}`);
  const rev1 = rows<{ amount: number; awarded_at: string; reverses_points_id: number | null; recorded_at: string }>(
    h.sqlite, 'SELECT amount, awarded_at, reverses_points_id, recorded_at FROM user_points WHERE reverses_points_id IS NOT NULL');
  assert.equal(rev1.length, 1);
  assert.ok(rev1[0]!.amount < 0);
  assert.equal(rev1[0]!.awarded_at, originalAwardedAt); // анхны өдөр
  assert.notEqual(rev1[0]!.recorded_at, originalAwardedAt); // бичигдсэн цаг тусдаа
  assert.ok(rev1[0]!.reverses_points_id! > 0);
  const lastPe = rows<{ source: string; percentage: number }>(h.sqlite, 'SELECT source, percentage FROM progress_entries ORDER BY id DESC LIMIT 1')[0]!;
  assert.equal(lastPe.source, 'alloc_adj');
  assert.equal(lastPe.percentage, 15);
  assert.equal(latestPct(h), 15);
});

test('хуваалт засахад доод хязгаар L = D түгжигдэнэ: ердийн «−» L-ээс доош орохгүй (BELOW_FLOOR)', async () => {
  const h = makeDb();
  const data = await splitAB(h);
  session(h.sqlite, { userId: A, taskId: 501, startedAt: T0, endedAt: '2026-10-02T09:30:00.000Z' });
  await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: data.root.revision, doneUnits: pt(20) });
  let rev = rootRow(h)!.revision;
  // 50/50 болгож засна → L_A = 20
  const edit = await Ops.applyAllocation(ctxOf(h.d1), actorOf(B), {
    taskId: 501, requestId: uid('edit'), expectedRevision: rev, mode: 'total',
    targets: [{ userId: A, targetUnits: pt(50) }, { userId: B, targetUnits: pt(50) }],
  });
  assert.equal(edit.ok, true, JSON.stringify(edit));
  assert.equal(alloc(h, 501, A)?.floor_units, pt(20));
  rev = rootRow(h)!.revision;
  const below = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: rev, doneUnits: pt(19) });
  assert.equal(below.ok, false);
  if (!below.ok) assert.equal(below.code, 'BELOW_FLOOR');
  // Харин L-ээс дээш нэмээд буцаавал болно
  const up = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: rev, doneUnits: pt(30) });
  assert.equal(up.ok, true);
  rev = rootRow(h)!.revision;
  const down = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: rev, doneUnits: pt(25) });
  assert.equal(down.ok, true, JSON.stringify(down));
});

test('өөр хүний хэсгийн явц, зорилтоос хэтрэх, оролцогч биш хүн → татгалзана', async () => {
  const h = makeDb();
  const data = await splitAB(h);
  session(h.sqlite, { userId: A, taskId: 501, startedAt: T0, endedAt: '2026-10-02T09:30:00.000Z' });
  const over = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: data.root.revision, doneUnits: pt(41) });
  assert.equal(over.ok, false);
  if (!over.ok) assert.equal(over.code, 'OVER_TARGET');
  const stranger = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(C), { taskId: 501, requestId: uid('p'), expectedRevision: data.root.revision, doneUnits: pt(5) });
  assert.equal(stranger.ok, false);
  if (!stranger.ok) assert.equal(stranger.code, 'NO_ALLOCATION');
  // Админ биш хүн ownerUserId-аар өөр хүнийг засаж чадахгүй
  const spoof = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(B), { taskId: 501, requestId: uid('p'), expectedRevision: data.root.revision, doneUnits: pt(5), ownerUserId: A });
  assert.equal(spoof.ok, false);
  if (!spoof.ok) assert.equal(spoof.code, 'NOT_OWNER');
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM user_points'), 0);
});

test('өөрийн хэсгийн зорилтод хүрэх → QA заавал; хариулсны дараа таймер зөвхөн ӨӨРИЙНХ зогсоно, root дуусаагүй', async () => {
  const h = makeDb();
  const data = await splitAB(h);
  session(h.sqlite, { userId: A, taskId: 501, startedAt: T0, endedAt: '2026-10-02T09:30:00.000Z' });
  const running = session(h.sqlite, { userId: A, taskId: 501, startedAt: '2026-10-02T09:40:00.000Z' }); // явж буй
  const bRunning = session(h.sqlite, { userId: B, taskId: 501, startedAt: '2026-10-02T09:45:00.000Z' });
  void running;
  const noQa = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: data.root.revision, doneUnits: pt(40) });
  assert.equal(noQa.ok, false);
  if (!noQa.ok) {
    assert.equal(noQa.code, 'completion_qa required');
    assert.equal((noQa.extra?.scopes as { own: boolean; root: boolean }).own, true);
    assert.equal((noQa.extra?.scopes as { own: boolean; root: boolean }).root, false);
  }
  // Асуултын бичиг хэрэггүй → ямар ч зүйл commit-лэгдээгүй
  assert.equal(alloc(h, 501, A)?.done_units, 0);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM user_points'), 0);
  const withQa = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), {
    taskId: 501, requestId: uid('p'), expectedRevision: data.root.revision, doneUnits: pt(40),
    completionQa: { done: 'Хийсэн', issues: 'Үгүй', next: 'Үгүй' },
  });
  assert.equal(withQa.ok, true, JSON.stringify(withQa));
  if (withQa.ok) {
    assert.equal(withQa.data.reached_own_cap, true);
    assert.equal(withQa.data.completed_root, false);
  }
  const sessions = rows<{ user_id: number; ended_at: string | null; end_reason: string | null; end_note: string | null }>(
    h.sqlite, 'SELECT user_id, ended_at, end_reason, end_note FROM task_timer_sessions WHERE ended_at IS NOT NULL OR user_id = 4');
  const a = sessions.filter((s) => s.user_id === A && s.end_note === 'alloc_complete');
  assert.equal(a.length, 1);
  const bSess = rows<{ ended_at: string | null }>(h.sqlite, 'SELECT ended_at FROM task_timer_sessions WHERE id = ?', bRunning)[0]!;
  assert.equal(bSess.ended_at, null); // B-ийн таймер хөдлөөгүй
  assert.equal(rootRow(h)?.completed_at, null);
  // root progress 40, QA нь өөрийн хэсгийн слайст (root-ийн classic completion_qa биш)
  assert.equal(latestPct(h), 40);
  assert.equal(sum(h.sqlite, `SELECT COUNT(*) AS v FROM progress_entries WHERE completion_qa IS NOT NULL`), 0);
  const slice = rows<{ qa_json: string | null }>(h.sqlite, `SELECT qa_json FROM task_contributions WHERE kind = 'work'`)[0]!;
  assert.ok(slice.qa_json && JSON.parse(slice.qa_json).own);
});

test('root 100% болох: нэг QA, classic completion_qa, БҮХ таймер зогсоно, төсөл автоматаар архивлагдана', async () => {
  const h = makeDb();
  const data = await splitAB(h, 501, 40, 60);
  for (const u of [A, B]) session(h.sqlite, { userId: u, taskId: 501, startedAt: T0, endedAt: '2026-10-02T09:30:00.000Z' });
  const qa = { done: 'a', issues: 'b', next: 'c' };
  const rA = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: data.root.revision, doneUnits: pt(40), completionQa: qa });
  assert.equal(rA.ok, true, JSON.stringify(rA));
  session(h.sqlite, { userId: B, taskId: 501, startedAt: '2026-10-02T09:50:00.000Z' }); // B явж байна
  const rev = rootRow(h)!.revision;
  const rB = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(B), { taskId: 501, requestId: uid('p'), expectedRevision: rev, doneUnits: pt(60), completionQa: qa });
  assert.equal(rB.ok, true, JSON.stringify(rB));
  if (!rB.ok) return;
  assert.equal(rB.data.completed_root, true);
  assert.equal(rB.data.root.complete, true);
  assert.equal(latestPct(h), 100);
  const finalEntry = rows<{ completion_qa: string | null }>(h.sqlite, `SELECT completion_qa FROM progress_entries ORDER BY id DESC LIMIT 1`)[0]!;
  assert.deepEqual(JSON.parse(finalEntry.completion_qa!), qa);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_timer_sessions WHERE ended_at IS NULL'), 0);
  assert.ok(rootRow(h)!.completed_at);
  // Төслийн явц 10% (500 жин 10 × 100%) — 100 биш тул архивлагдахгүй
  assert.equal(sum(h.sqlite, `SELECT COUNT(*) AS v FROM projects WHERE id = 10 AND status = 'archived'`), 0);
});

test('төсөл 100% хүрвэл автоматаар архивлагдаж auto_archived_at; залруулгаар хувь буурвал дахин нээгдэнэ; гараар архивласан нээгдэхгүй', async () => {
  const h = makeDb();
  // Төсөл 10-ын бусад таскийг 100% болгож, зөвхөн 501 үлдээнэ
  for (const t of [502, 503, 504]) h.sqlite.exec(`UPDATE tasks SET weight_percent = 0 WHERE id = ${t}`);
  h.sqlite.exec(`UPDATE tasks SET weight_percent = 100 WHERE id = 501`);
  const data = await splitAB(h, 501, 40, 60);
  for (const u of [A, B]) session(h.sqlite, { userId: u, taskId: 501, startedAt: T0, endedAt: '2026-10-02T09:30:00.000Z' });
  const qa = { done: 'a', issues: 'b', next: 'c' };
  await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: data.root.revision, doneUnits: pt(40), completionQa: qa });
  let rev = rootRow(h)!.revision;
  const done = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(B), { taskId: 501, requestId: uid('p'), expectedRevision: rev, doneUnits: pt(60), completionQa: qa });
  assert.equal(done.ok, true, JSON.stringify(done));
  const proj = rows<{ status: string; auto_archived_at: string | null }>(h.sqlite, 'SELECT status, auto_archived_at FROM projects WHERE id = 10')[0]!;
  assert.equal(proj.status, 'archived');
  assert.ok(proj.auto_archived_at, 'auto_archived_at тэмдэглэгдсэн');

  // B өөрийн хэсгийг бууруулна (L_B = 0) → root 100-аас буурна → төсөл дахин нээгдэнэ
  rev = rootRow(h)!.revision;
  const down = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(B), { taskId: 501, requestId: uid('p'), expectedRevision: rev, doneUnits: pt(50) });
  assert.equal(down.ok, true, JSON.stringify(down));
  if (down.ok) assert.equal(down.data.reopened_root, true);
  const reopened = rows<{ status: string; auto_archived_at: string | null }>(h.sqlite, 'SELECT status, auto_archived_at FROM projects WHERE id = 10')[0]!;
  assert.equal(reopened.status, 'active');
  assert.equal(reopened.auto_archived_at, null);
  assert.equal(rootRow(h)!.completed_at, null);

  // Гараар архивлавал (auto_archived_at NULL) залруулга хориотой, төсөл нээгдэхгүй
  h.sqlite.exec(`UPDATE projects SET status = 'archived', auto_archived_at = NULL WHERE id = 10`);
  rev = rootRow(h)!.revision;
  const blocked = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(B), { taskId: 501, requestId: uid('p'), expectedRevision: rev, doneUnits: pt(40) });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.code, 'PROJECT_INACTIVE');
  assert.equal(sum(h.sqlite, `SELECT COUNT(*) AS v FROM projects WHERE id = 10 AND status = 'archived'`), 1);
});

test('хоёр хүн ЗЭРЭГ хадгалах (ижил revision): яг нэг нь амжилттай, нөгөө нь STALE — давхар оноо үгүй', async () => {
  const h = makeDb();
  const data = await splitAB(h);
  for (const u of [A, B]) session(h.sqlite, { userId: u, taskId: 501, startedAt: T0, endedAt: '2026-10-02T09:30:00.000Z' });
  const [ra, rb] = await Promise.all([
    Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: data.root.revision, doneUnits: pt(10) }),
    Ops.setOwnProgress(ctxOf(h.d1), actorOf(B), { taskId: 501, requestId: uid('p'), expectedRevision: data.root.revision, doneUnits: pt(10) }),
  ]);
  const oks = [ra, rb].filter((r) => r.ok);
  const stales = [ra, rb].filter((r) => !r.ok && r.code === 'STALE_REVISION');
  assert.equal(oks.length, 1, JSON.stringify([ra, rb]));
  assert.equal(stales.length, 1);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM user_points'), 1);
  // Дахин оролдвол (шинэ revision-оор) амжилттай, root = 20
  const loser = !ra.ok ? actorOf(A) : actorOf(B);
  const rev = rootRow(h)!.revision;
  const retry = await Ops.setOwnProgress(ctxOf(h.d1), loser, { taskId: 501, requestId: uid('p'), expectedRevision: rev, doneUnits: pt(10) });
  assert.equal(retry.ok, true);
  assert.equal(latestPct(h), 20);
});

test('нэг секундэд хоёр хадгалалт: projection created_at ХАТУУ өснө, хамгийн сүүлийн хувь зөв', async () => {
  const h = makeDb();
  const data = await splitAB(h);
  for (const u of [A, B]) session(h.sqlite, { userId: u, taskId: 501, startedAt: T0, endedAt: '2026-10-02T09:30:00.000Z' });
  let rev = data.root.revision;
  const steps: Array<[number, number]> = [[A, 5], [B, 10], [A, 15], [B, 20]];
  for (const [u, p] of steps) {
    const r = await Ops.setOwnProgress(ctxOf(h.d1, NOW), actorOf(u), { taskId: 501, requestId: uid('p'), expectedRevision: rev, doneUnits: pt(p) });
    assert.equal(r.ok, true, JSON.stringify(r));
    rev = rootRow(h)!.revision;
  }
  const times = rows<{ created_at: string; percentage: number }>(h.sqlite, 'SELECT created_at, percentage FROM progress_entries ORDER BY id');
  for (let i = 1; i < times.length; i++) assert.ok(times[i]!.created_at > times[i - 1]!.created_at, `${times[i - 1]!.created_at} < ${times[i]!.created_at}`);
  assert.equal(latestPct(h), 35); // A15 + B20
  // Хуучин (BC) helper-ээр уншихад ч хамгийн сүүлийнх
  const viaHelper = h.sqlite
    .prepare(`SELECT COALESCE((SELECT x.percentage FROM progress_entries x WHERE x.task_id = 501 AND x.status = 'approved' ORDER BY x.created_at DESC, x.id DESC LIMIT 1), 0) AS v`)
    .get() as { v: number };
  assert.equal(viaHelper.v, 35);
});

/* ------------------------------------------------------------------ */
/*  3. Буцаах / шилжүүлэх / дахин авах                                  */
/* ------------------------------------------------------------------ */

test('үлдсэн ажлаа буцаах: хийсэн нь хэвээр, ирээдүй чөлөөт ажилд, таймер зогсоно, оноо хөдлөхгүй', async () => {
  const h = makeDb();
  const data = await splitAB(h);
  session(h.sqlite, { userId: A, taskId: 501, startedAt: T0, endedAt: '2026-10-02T09:30:00.000Z' });
  await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: data.root.revision, doneUnits: pt(15) });
  const run = session(h.sqlite, { userId: A, taskId: 501, startedAt: '2026-10-02T09:40:00.000Z' });
  const pointsBefore = pointsNet(h, A);
  const rev = rootRow(h)!.revision;
  const r = await Ops.releaseOwn(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('rel'), expectedRevision: rev });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  assert.equal(r.data.released_units, pt(25)); // 40 − 15
  assert.equal(alloc(h, 501, A)?.target_units, pt(15));
  assert.equal(alloc(h, 501, A)?.done_units, pt(15)); // хийсэн хэвээр
  assert.equal(alloc(h, 501, A)?.released_units, pt(25)); // дахин авахад санал болгоно
  assert.equal(rootRow(h)?.unallocated_units, pt(25));
  assert.equal(pointsNet(h, A), pointsBefore); // оноо хөдлөхгүй
  const s = rows<{ ended_at: string | null; end_note: string | null }>(h.sqlite, 'SELECT ended_at, end_note FROM task_timer_sessions WHERE id = ?', run)[0]!;
  assert.ok(s.ended_at);
  assert.equal(s.end_note, 'alloc_release');
});

test('шилжүүлэх: ирээдүй хүлээн авагчид, хийсэн нь БУСАДАД шилжихгүй; B-ийн хийсэн хэвээр', async () => {
  const h = makeDb();
  const data = await splitAB(h);
  session(h.sqlite, { userId: A, taskId: 501, startedAt: T0, endedAt: '2026-10-02T09:30:00.000Z' });
  await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: data.root.revision, doneUnits: pt(10) });
  const rev = rootRow(h)!.revision;
  const r = await Ops.releaseOwn(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('rel'), expectedRevision: rev, toUserId: B });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(alloc(h, 501, B)?.target_units, pt(90)); // 60 + 30
  assert.equal(alloc(h, 501, A)?.target_units, pt(10));
  assert.equal(rootRow(h)?.unallocated_units, 0);
  assert.equal(alloc(h, 501, A)?.done_units, pt(10)); // хийсэн нь А-д л
});

test('дахин авах: өмнөх хийсэн хэмжээнээс үргэлжилнэ (тэгээс биш); чөлөөтэй хэмжээнээс их хүсвэл татгалзана', async () => {
  const h = makeDb();
  const data = await splitAB(h);
  session(h.sqlite, { userId: A, taskId: 501, startedAt: T0, endedAt: '2026-10-02T09:30:00.000Z' });
  await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: data.root.revision, doneUnits: pt(15) });
  let rev = rootRow(h)!.revision;
  await Ops.releaseOwn(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('rel'), expectedRevision: rev });
  rev = rootRow(h)!.revision;
  const tooMuch = await Ops.retakeAllocation(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('re'), expectedRevision: rev, units: pt(30) });
  assert.equal(tooMuch.ok, false);
  if (!tooMuch.ok) {
    assert.equal(tooMuch.code, 'BAD_VALUE');
    assert.equal(tooMuch.extra?.available_units, pt(25));
  }
  const ok = await Ops.retakeAllocation(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('re'), expectedRevision: rev });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const a = alloc(h, 501, A)!;
  assert.equal(a.done_units, pt(15)); // тэгээс эхлэхгүй
  assert.equal(a.target_units, pt(40));
  assert.equal(a.released_units, 0);
  assert.equal(rootRow(h)?.unallocated_units, 0);
  assert.equal(a.ordinal, 1); // ижил оролцогч — ижил дугаар
});

test('шинэ хүн чөлөөт ажлаас авна → шинэ ordinal; eligible биш хүн авч чадахгүй', async () => {
  const h = makeDb();
  const data = await splitAB(h);
  session(h.sqlite, { userId: A, taskId: 501, startedAt: T0, endedAt: '2026-10-02T09:30:00.000Z' });
  await Ops.releaseOwn(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('rel'), expectedRevision: data.root.revision });
  const rev = rootRow(h)!.revision;
  const admin = await Ops.retakeAllocation(ctxOf(h.d1), actorOf(ADMIN), { taskId: 501, requestId: uid('re'), expectedRevision: rev });
  assert.equal(admin.ok, false);
  if (!admin.ok) assert.equal(admin.code, 'ROLE_NOT_ALLOWED');
  const c = await Ops.retakeAllocation(ctxOf(h.d1), actorOf(C), { taskId: 501, requestId: uid('re'), expectedRevision: rev, units: pt(10) });
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.equal(alloc(h, 501, C)?.ordinal, 3);
  assert.equal(rootRow(h)?.unallocated_units, pt(30)); // 40 − 10
});

/* ------------------------------------------------------------------ */
/*  4. Хуучин түүхийг seed хийх                                         */
/* ------------------------------------------------------------------ */

test('seed (цэвэр): C хуучин 0→30 — слайс нь хуучин оноо мөр рүү ЛАВЛАНА, ШИНЭ оноо үүсэхгүй, явц хөдлөхгүй', async () => {
  const h = makeDb();
  // coef(501) = 0.1: 30 пункт = 3 төслийн %
  const e = legacyEntry(h.sqlite, { taskId: 501, userId: C, pct: 30, createdAt: '2026-09-20 09:00:00', points: { amount: 3, deltaPct: 3 } });
  const pointsBefore = sum(h.sqlite, 'SELECT COUNT(*) AS v FROM user_points');
  const r = await Ops.applyAllocation(ctxOf(h.d1), actorOf(C), {
    taskId: 501, requestId: uid('split'), expectedRevision: 0, mode: 'total',
    targets: [{ userId: C, targetUnits: pt(50) }, { userId: B, targetUnits: pt(50) }],
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  assert.equal(r.data.root.root_done_units, pt(30));
  assert.equal(alloc(h, 501, C)?.done_units, pt(30));
  assert.equal(alloc(h, 501, C)?.floor_units, pt(30)); // хийсэн нь түгжигдсэн
  assert.equal(alloc(h, 501, C)?.ordinal, 1); // seed хийсэн хүн эхэлж
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM user_points'), pointsBefore); // шинэ оноо үгүй
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM progress_entries'), 1);
  assert.equal(latestPct(h), 30);
  const seed = rows<{ kind: string; points_id: number; units: number; awarded_at: string; credit_open_amount: number }>(
    h.sqlite, `SELECT kind, points_id, units, awarded_at, credit_open_amount FROM task_contributions`);
  assert.equal(seed.length, 1);
  assert.equal(seed[0]!.kind, 'seed');
  assert.equal(seed[0]!.points_id, 1);
  assert.equal(seed[0]!.units, pt(30));
  assert.equal(seed[0]!.awarded_at, '2026-09-20 09:00:00'); // анхны өдөр
  assert.equal(seed[0]!.credit_open_amount, 3);
  void e;
});

test('seed (эргэлзээтэй 77→8): хийсэн нь эзэнгүй B=8, slack=69; шинэ хийсэн нь slack-ийг ДҮҮРГЭЖ давхар төлөхгүй', async () => {
  const h = makeDb();
  legacyEntry(h.sqlite, { taskId: 501, userId: C, pct: 77, createdAt: '2026-09-20 09:00:00', points: { amount: 7.7, deltaPct: 7.7 } });
  legacyEntry(h.sqlite, { taskId: 501, userId: A, pct: 8, createdAt: '2026-09-21 09:00:00' }); // буурсан → оноо буцаагдаагүй
  const r = await Ops.applyAllocation(ctxOf(h.d1), actorOf(A), {
    taskId: 501, requestId: uid('split'), expectedRevision: 0, mode: 'total',
    targets: [{ userId: A, targetUnits: pt(46) }, { userId: B, targetUnits: pt(46) }],
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  const root = rootRow(h)!;
  assert.equal(root.unattributed_units, pt(8));
  assert.equal(root.slack_units, pt(69));
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_contributions'), 0); // слайс үгүй (эзэнгүй)
  // B (шинэ) 46 хийх хүртэл → slack-д ордог → оноо 0
  session(h.sqlite, { userId: B, taskId: 501, startedAt: T0, endedAt: '2026-10-02T09:30:00.000Z' });
  const up1 = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(B), { taskId: 501, requestId: uid('p'), expectedRevision: rootRow(h)!.revision, doneUnits: pt(46) });
  assert.equal(up1.ok, false); // 46 нь зорилт — QA хэрэгтэй
  const up2 = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(B), { taskId: 501, requestId: uid('p'), expectedRevision: rootRow(h)!.revision, doneUnits: pt(40) });
  assert.equal(up2.ok, true, JSON.stringify(up2));
  assert.equal(pointsNet(h, B), 0); // бүгд slack-аар хаагдсан
  assert.equal(rootRow(h)!.slack_units, pt(29)); // 69 − 40
  // Хоёр дахь хэсэг: 40→46 (6 нэгж) slack 29 → бас хаагдана
  const up3 = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(B), { taskId: 501, requestId: uid('p'), expectedRevision: rootRow(h)!.revision, doneUnits: pt(46), completionQa: { done: 'x', issues: 'y', next: 'z' } });
  assert.equal(up3.ok, true, JSON.stringify(up3));
  assert.equal(pointsNet(h, B), 0);
  assert.equal(rootRow(h)!.slack_units, pt(23));
});

test('seed: нэг юм дутуу 100%-тай таск managed болгох боломжгүй (TASK_COMPLETED); хуучин хуваалтын хийгдсэн хэсэг татгалзана', async () => {
  const h = makeDb();
  legacyEntry(h.sqlite, { taskId: 501, userId: C, pct: 100, createdAt: '2026-09-20 09:00:00', points: { amount: 10, deltaPct: 10 } });
  const done = await Ops.applyAllocation(ctxOf(h.d1), actorOf(C), {
    taskId: 501, requestId: uid('split'), expectedRevision: 0, mode: 'total',
    targets: [{ userId: C, targetUnits: pt(50) }, { userId: B, targetUnits: pt(50) }],
  });
  assert.equal(done.ok, false);
  if (!done.ok) assert.equal(done.code, 'TASK_COMPLETED');
  h.sqlite.exec(`INSERT INTO progress_entries (task_id, user_id, percentage, date, status, source, created_at) VALUES (502, 3, 100, '2026-09-20', 'approved', 'split', '2026-09-20 10:00:00')`);
  const part = await Ops.applyAllocation(ctxOf(h.d1), actorOf(C), {
    taskId: 502, requestId: uid('split'), expectedRevision: 0, mode: 'total',
    targets: [{ userId: C, targetUnits: pt(50) }, { userId: B, targetUnits: pt(50) }],
  });
  assert.equal(part.ok, false);
});

test('seed batch нь зэрэг ирсэн хуучин бичлэгтэй уралдвал (хуучин хувь seed-ээс хойш өөрчлөгдсөн) → STALE, юу ч бичигдэхгүй', async () => {
  const h = makeDb();
  legacyEntry(h.sqlite, { taskId: 501, userId: C, pct: 30, createdAt: '2026-09-20 09:00:00', points: { amount: 3, deltaPct: 3 } });
  // facts-ийг уншсаны ДАРАА (batch-аас өмнө) хуучин бичлэг орж ирнэ
  const realFirst = h.d1.prepare.bind(h.d1);
  let injected = false;
  (h.d1 as unknown as { prepare: typeof h.d1.prepare }).prepare = ((sql: string) => {
    if (!injected && /INSERT INTO task_ops/.test(sql)) {
      injected = true;
      legacyEntry(h.sqlite, { taskId: 501, userId: C, pct: 40, createdAt: '2026-10-02 08:00:00', points: { amount: 1, deltaPct: 1 } });
    }
    return realFirst(sql);
  }) as typeof h.d1.prepare;
  const r = await Ops.applyAllocation(ctxOf(h.d1), actorOf(C), {
    taskId: 501, requestId: uid('split'), expectedRevision: 0, mode: 'total',
    targets: [{ userId: C, targetUnits: pt(50) }, { userId: B, targetUnits: pt(50) }],
  });
  assert.equal(injected, true);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'STALE_REVISION');
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_roots'), 0);
});

/* ------------------------------------------------------------------ */
/*  5. Хуучин writer, recalc, харагдац                                  */
/* ------------------------------------------------------------------ */

test('managed таск дээр хуучин submitProgressEntry → 409 MANAGED_ROOT (админ ч)', async () => {
  const h = makeDb();
  await splitAB(h);
  const { submitProgressEntry } = await import('../routes/progress.ts');
  for (const u of [A, ADMIN]) {
    const r = await submitProgressEntry(
      { db: h.d1, ai: undefined as never, waitUntil: () => undefined, user: actorOf(u) },
      { task_id: 501, percentage: 50 },
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 409);
      assert.equal((r.body as { error: string }).error, 'MANAGED_ROOT');
    }
  }
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM progress_entries'), 0);
});

test('recalculateProjectPoints: managed таскийн оноо/буцаалтыг ХӨНДӨХГҮЙ, бусад таскийг дахин тооцно', async () => {
  const h = makeDb();
  const data = await splitAB(h);
  session(h.sqlite, { userId: A, taskId: 501, startedAt: T0, endedAt: '2026-10-02T09:30:00.000Z' });
  await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: data.root.revision, doneUnits: pt(30) });
  await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: rootRow(h)!.revision, doneUnits: pt(20) });
  // Өөр (хуучин) таск 504 дээр хуучин оноо
  legacyEntry(h.sqlite, { taskId: 504, userId: C, pct: 50, createdAt: '2026-09-20 09:00:00', points: { amount: 999, deltaPct: 999 } });
  const before = rows<{ id: number; amount: number }>(h.sqlite, 'SELECT id, amount FROM user_points WHERE task_id = 501 ORDER BY id');
  const { recalculateProjectPoints } = await import('../routes/progress.ts');
  await recalculateProjectPoints(h.d1, 10);
  const after = rows<{ id: number; amount: number }>(h.sqlite, 'SELECT id, amount FROM user_points WHERE task_id = 501 ORDER BY id');
  assert.deepEqual(after, before); // managed мөрүүд (+/− буцаалт) хэвээр
  assert.ok(Math.abs(pointsNet(h, A) - 2) < 1e-9);
  // Хуучин таск 504: 999 → дахин тооцоход бодит дүн (50% × coef 0.1 = 5)
  assert.ok(Math.abs(pointsNet(h, C, 504) - 5) < 1e-9, `504: ${pointsNet(h, C, 504)}`);
});

test('/my-tasks-ийн хуваарилалтын тойм ба харагдац: overview managed/preview', async () => {
  const h = makeDb();
  const pre = await Ops.loadAllocationOverview(h.d1, actorOf(A), 501);
  assert.equal(pre.ok, true);
  if (pre.ok) {
    assert.equal(pre.data.managed, false);
    assert.equal(pre.data.preview?.attribution, 'empty');
    assert.equal(pre.data.allowed.edit, true);
  }
  await splitAB(h);
  const post = await Ops.loadAllocationOverview(h.d1, actorOf(A), 501);
  assert.equal(post.ok, true);
  if (post.ok) {
    assert.equal(post.data.managed, true);
    assert.equal(post.data.me?.target_units, pt(40));
    assert.equal(post.data.allowed.progress, true);
    assert.equal(post.data.allowed.retake, false);
  }
  const stranger = await Ops.loadAllocationOverview(h.d1, actorOf(C), 501);
  assert.equal(stranger.ok, true);
  if (stranger.ok) {
    assert.equal(stranger.data.me, null);
    assert.equal(stranger.data.allowed.edit, false);
    assert.equal(stranger.data.allowed.progress, false);
  }
});

test('invariant: ямар ч дарааллын мутацийн дараа Σ T + B + U = 100 ба root_done = Σ D + B', async () => {
  const h = makeDb();
  const data = await splitAB(h);
  for (const u of [A, B]) session(h.sqlite, { userId: u, taskId: 501, startedAt: T0, endedAt: '2026-10-02T09:30:00.000Z' });
  let rev = data.root.revision;
  const ops: Array<() => Promise<unknown>> = [
    () => Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: rootRow(h)!.revision, doneUnits: pt(12) }),
    () => Ops.setOwnProgress(ctxOf(h.d1), actorOf(B), { taskId: 501, requestId: uid('p'), expectedRevision: rootRow(h)!.revision, doneUnits: pt(33) }),
    () => Ops.releaseOwn(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('r'), expectedRevision: rootRow(h)!.revision }),
    () => Ops.retakeAllocation(ctxOf(h.d1), actorOf(C), { taskId: 501, requestId: uid('r'), expectedRevision: rootRow(h)!.revision, units: pt(10) }),
    () => Ops.setOwnProgress(ctxOf(h.d1), actorOf(B), { taskId: 501, requestId: uid('p'), expectedRevision: rootRow(h)!.revision, doneUnits: pt(20) }),
  ];
  void rev;
  for (const op of ops) {
    await op();
    const snap = await Store.loadRoot(h.d1, 501);
    assert.ok(snap);
    const { checkRootInvariants, rootDoneUnits } = await import('./taskAllocation.ts');
    assert.deepEqual(checkRootInvariants(snap!.state), []);
    // projection-ийн хувь = root_done
    const pct = latestPct(h);
    assert.equal(Math.round(pct * U), rootDoneUnits(snap!.state));
  }
  assert.ok(ROLE[A]);
});

/* ------------------------------------------------------------------ */
/*  6. Өөрийн бүртгэлийг засах (доод хязгаараас доош) ба сэргээх         */
/* ------------------------------------------------------------------ */

/** A 30 хийж (оноо 3), хуваалтыг 50/50 болгож засна → L_A = 30 (энгийн «−» хаагдсан). */
async function aDid30Floor30(h: ReturnType<typeof makeDb>) {
  const data = await splitAB(h);
  session(h.sqlite, { userId: A, taskId: 501, startedAt: T0, endedAt: '2026-10-02T09:30:00.000Z' });
  const up = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: data.root.revision, doneUnits: pt(30) });
  assert.equal(up.ok, true, JSON.stringify(up));
  const edit = await Ops.applyAllocation(ctxOf(h.d1), actorOf(A), {
    taskId: 501, requestId: uid('edit'), expectedRevision: rootRow(h)!.revision, mode: 'total',
    targets: [{ userId: A, targetUnits: pt(50) }, { userId: B, targetUnits: pt(50) }],
  });
  assert.equal(edit.ok, true, JSON.stringify(edit));
  assert.equal(alloc(h, 501, A)?.floor_units, pt(30));
}
const openSlices = (h: ReturnType<typeof makeDb>, userId: number) =>
  rows<{ id: number; units_open: number; credit_open_amount: number; awarded_at: string; kind: string }>(
    h.sqlite,
    `SELECT id, units_open, credit_open_amount, awarded_at, kind FROM task_contributions WHERE user_id = ? AND kind IN ('work','seed') AND units_open > 0 ORDER BY id`,
    userId,
  );

test('доод хязгаараас доош: ердийн «−» хаагдсан, харин ТУСДАА залруулга (correct) хүчингүй болгож оноог АНХНЫ өдөрт буцаана', async () => {
  const h = makeDb();
  await aDid30Floor30(h);
  const [slice] = openSlices(h, A);
  const originalAwarded = slice!.awarded_at;
  assert.equal(pointsNet(h, A), 3);
  const later = NOW + 3 * 24 * 3600 * 1000;
  const r = await Ops.correctOwnProgress(
    { db: h.d1, nowMs: later, today: '2026-10-05' },
    actorOf(A),
    { taskId: 501, requestId: uid('c'), expectedRevision: rootRow(h)!.revision, items: [{ sliceId: slice!.id }] },
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  assert.equal(r.data.reversed_units, pt(30));
  assert.ok(Math.abs(r.data.reversed.amount - 3) < 1e-9);
  assert.equal(alloc(h, 501, A)?.done_units, 0);
  assert.equal(alloc(h, 501, A)?.floor_units, 0); // доод хязгаар хамт буурна
  assert.equal(r.data.root.root_done_units, 0);
  assert.ok(Math.abs(pointsNet(h, A)) < 1e-9);
  const rev = rows<{ amount: number; awarded_at: string; recorded_at: string; reverses_points_id: number }>(
    h.sqlite,
    'SELECT amount, awarded_at, recorded_at, reverses_points_id FROM user_points WHERE reverses_points_id IS NOT NULL',
  );
  assert.equal(rev.length, 1);
  assert.equal(rev[0]!.awarded_at, originalAwarded); // анхны өдөр
  assert.notEqual(rev[0]!.recorded_at, originalAwarded);
  assert.equal(latestPct(h), 0);
  assert.equal(rows<{ source: string }>(h.sqlite, 'SELECT source FROM progress_entries ORDER BY id DESC LIMIT 1')[0]!.source, 'alloc_adj');
  // Хэсэг УСТААГҮЙ (аудит) — units_open 0
  assert.equal(sum(h.sqlite, 'SELECT units_open AS v FROM task_contributions WHERE id = ?', slice!.id), 0);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_contributions WHERE id = ?', slice!.id), 1);
});

test('хэсэгчилсэн залруулга: 30-аас 10-ыг хүчингүй болгоно → D=20, цэвэр оноо 2.0; бусдын D, оноо хөдлөхгүй', async () => {
  const h = makeDb();
  await aDid30Floor30(h);
  session(h.sqlite, { userId: B, taskId: 501, startedAt: T0, endedAt: '2026-10-02T09:30:00.000Z' });
  await Ops.setOwnProgress(ctxOf(h.d1), actorOf(B), { taskId: 501, requestId: uid('p'), expectedRevision: rootRow(h)!.revision, doneUnits: pt(15) });
  const bPoints = pointsNet(h, B);
  const [slice] = openSlices(h, A);
  const r = await Ops.correctOwnProgress(ctxOf(h.d1), actorOf(A), {
    taskId: 501, requestId: uid('c'), expectedRevision: rootRow(h)!.revision, items: [{ sliceId: slice!.id, units: pt(10) }],
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(alloc(h, 501, A)?.done_units, pt(20));
  assert.equal(alloc(h, 501, A)?.floor_units, pt(20)); // min(30, 20)
  assert.ok(Math.abs(pointsNet(h, A) - 2) < 1e-9);
  assert.equal(pointsNet(h, B), bPoints); // бусдын оноо хөдөлсөнгүй
  assert.equal(alloc(h, 501, B)?.done_units, pt(15));
  assert.equal(latestPct(h), 35); // 20 + 15
});

test('залруулсны дараа ДАХИН хийвэл хууль ёсны оноо дахин авна (HWM-д хаагдахгүй), давхар төлөгдөхгүй', async () => {
  const h = makeDb();
  await aDid30Floor30(h);
  const [slice] = openSlices(h, A);
  const c = await Ops.correctOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('c'), expectedRevision: rootRow(h)!.revision, items: [{ sliceId: slice!.id }] });
  assert.equal(c.ok, true);
  assert.ok(Math.abs(pointsNet(h, A)) < 1e-9);
  const redo = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: rootRow(h)!.revision, doneUnits: pt(30) });
  assert.equal(redo.ok, true, JSON.stringify(redo));
  assert.ok(Math.abs(pointsNet(h, A) - 3) < 1e-9, `net ${pointsNet(h, A)}`); // 3, 6 биш
  const again = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: rootRow(h)!.revision, doneUnits: pt(30) });
  assert.equal(again.ok && again.data.noop, true);
  assert.ok(Math.abs(pointsNet(h, A) - 3) < 1e-9);
});

test('залруулгын хаалт: өөрийнх биш/хүчингүй хэсэг, хэтэрсэн хэмжээ, давхардсан, хоосон, өөр хүнд админ биш', async () => {
  const h = makeDb();
  await aDid30Floor30(h);
  const [slice] = openSlices(h, A);
  const base = { taskId: 501, expectedRevision: rootRow(h)!.revision };
  const foreign = await Ops.correctOwnProgress(ctxOf(h.d1), actorOf(B), { ...base, requestId: uid('c'), items: [{ sliceId: slice!.id }] });
  assert.equal(foreign.ok, false);
  if (!foreign.ok) assert.equal(foreign.code, 'SLICE_NOT_FOUND');
  const over = await Ops.correctOwnProgress(ctxOf(h.d1), actorOf(A), { ...base, requestId: uid('c'), items: [{ sliceId: slice!.id, units: pt(31) }] });
  assert.equal(over.ok, false);
  if (!over.ok) assert.equal(over.code, 'BAD_UNITS');
  const dup = await Ops.correctOwnProgress(ctxOf(h.d1), actorOf(A), { ...base, requestId: uid('c'), items: [{ sliceId: slice!.id }, { sliceId: slice!.id }] });
  assert.equal(dup.ok, false);
  const none = await Ops.correctOwnProgress(ctxOf(h.d1), actorOf(A), { ...base, requestId: uid('c'), items: [] });
  assert.equal(none.ok, false);
  const spoof = await Ops.correctOwnProgress(ctxOf(h.d1), actorOf(B), { ...base, requestId: uid('c'), items: [{ sliceId: slice!.id }], ownerUserId: A });
  assert.equal(spoof.ok, false);
  if (!spoof.ok) assert.equal(spoof.code, 'NOT_OWNER');
  // Админ өөр хүний бүртгэлийг засна (actor ≠ owner аудитад)
  const admin = await Ops.correctOwnProgress(ctxOf(h.d1), actorOf(ADMIN), { ...base, requestId: uid('c'), items: [{ sliceId: slice!.id }], ownerUserId: A });
  assert.equal(admin.ok, true, JSON.stringify(admin));
  const ev = rows<{ actor_id: number; user_id: number }>(h.sqlite, `SELECT actor_id, user_id FROM task_contributions WHERE kind = 'correction'`);
  assert.deepEqual(ev.map((e) => [e.actor_id, e.user_id]), [[ADMIN, A]]);
  assert.equal(pointsNet(h, B), 0);
});

test('сэргээлт: залруулгыг буцаана — D, анхны оноо (анхны өдөр) буцна, ШИНЭ давхар оноо үгүй; дахин сэргээх боломжгүй', async () => {
  const h = makeDb();
  await aDid30Floor30(h);
  const [slice] = openSlices(h, A);
  const cReq = uid('c');
  const c = await Ops.correctOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: cReq, expectedRevision: rootRow(h)!.revision, items: [{ sliceId: slice!.id }] });
  assert.equal(c.ok, true);
  assert.ok(Math.abs(pointsNet(h, A)) < 1e-9);
  const records = await Ops.loadOwnRecords(h.d1, 501, A);
  assert.equal(records.slices.length, 0);
  assert.equal(records.corrections.length, 1);
  assert.equal(records.corrections[0]!.request_id, cReq);
  assert.equal(records.corrections[0]!.units, pt(30));

  const r = await Ops.restoreOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('rs'), expectedRevision: rootRow(h)!.revision, correctionRequestId: cReq });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  assert.equal(r.data.restored_units, pt(30));
  assert.equal(alloc(h, 501, A)?.done_units, pt(30));
  assert.ok(Math.abs(pointsNet(h, A) - 3) < 1e-9); // анхных нь — 6 биш
  const [back] = openSlices(h, A);
  assert.equal(back!.id, slice!.id); // ИЖИЛ хэсэг буцсан
  assert.equal(back!.units_open, pt(30));
  assert.equal(back!.awarded_at, slice!.awarded_at); // анхны өдөр
  assert.equal(latestPct(h), 30);
  assert.equal(sum(h.sqlite, `SELECT COUNT(*) AS v FROM task_contributions WHERE kind = 'correction' AND restored_at IS NULL`), 0);
  // Дахин сэргээх — аль хэдийн сэргээгдсэн
  const twice = await Ops.restoreOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('rs'), expectedRevision: rootRow(h)!.revision, correctionRequestId: cReq });
  assert.equal(twice.ok, false);
  if (!twice.ok) assert.equal(twice.code, 'NOTHING_TO_RESTORE');
});

test('сэргээлт татгалзана: зорилт хүрэлцэхгүй (үлдсэнээ буцаасан), өөр хүн тэр ажлыг хийсэн (root>100), өөр хүнд', async () => {
  const h = makeDb();
  await aDid30Floor30(h);
  const [slice] = openSlices(h, A);
  const cReq = uid('c');
  await Ops.correctOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: cReq, expectedRevision: rootRow(h)!.revision, items: [{ sliceId: slice!.id }] });
  // A үлдсэн ажлаа бүгдийг нь буцаана (T=D=0) → сэргээхэд зорилт хүрэлцэхгүй
  await Ops.releaseOwn(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('rel'), expectedRevision: rootRow(h)!.revision });
  const noTarget = await Ops.restoreOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('rs'), expectedRevision: rootRow(h)!.revision, correctionRequestId: cReq });
  assert.equal(noTarget.ok, false);
  if (!noTarget.ok) {
    assert.equal(noTarget.code, 'RESTORE_OVER_TARGET');
    assert.equal(noTarget.extra?.available_units, 0);
  }
  // B чөлөөт ажлыг авч ӨӨРӨӨ root-ийг дүүргэнэ
  await Ops.retakeAllocation(ctxOf(h.d1), actorOf(B), { taskId: 501, requestId: uid('re'), expectedRevision: rootRow(h)!.revision, units: pt(50) });
  session(h.sqlite, { userId: B, taskId: 501, startedAt: T0, endedAt: '2026-10-02T09:30:00.000Z' });
  const bFull = await Ops.setOwnProgress(ctxOf(h.d1), actorOf(B), {
    taskId: 501, requestId: uid('p'), expectedRevision: rootRow(h)!.revision, doneUnits: pt(100),
    completionQa: { done: 'a', issues: 'b', next: 'c' },
  });
  assert.equal(bFull.ok, true, JSON.stringify(bFull));
  const over = await Ops.restoreOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('rs'), expectedRevision: rootRow(h)!.revision, correctionRequestId: cReq });
  assert.equal(over.ok, false);
  if (!over.ok) assert.ok(['RESTORE_OVER_TARGET', 'RESTORE_OVER_ROOT', 'PROJECT_INACTIVE'].includes(over.code), over.code);
  // Өөр хүнд (админ биш)
  const spoof = await Ops.restoreOwnProgress(ctxOf(h.d1), actorOf(B), { taskId: 501, requestId: uid('rs'), expectedRevision: rootRow(h)!.revision, correctionRequestId: cReq, ownerUserId: A });
  assert.equal(spoof.ok, false);
  if (!spoof.ok) assert.equal(spoof.code, 'NOT_OWNER');
});

test('сэргээлт зорилтод хүрвэл дуусгах асуулт заавал; хариулбал тэр хүний таймер зогсоно', async () => {
  const h = makeDb();
  const data = await splitAB(h);
  session(h.sqlite, { userId: A, taskId: 501, startedAt: T0, endedAt: '2026-10-02T09:30:00.000Z' });
  // A 40 (зорилт) хүртэл — QA-тай
  await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: data.root.revision, doneUnits: pt(40), completionQa: { done: 'a', issues: 'b', next: 'c' } });
  const slices = openSlices(h, A);
  const cReq = uid('c');
  const c = await Ops.correctOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: cReq, expectedRevision: rootRow(h)!.revision, items: slices.map((s) => ({ sliceId: s.id })) });
  assert.equal(c.ok, true, JSON.stringify(c));
  const running = session(h.sqlite, { userId: A, taskId: 501, startedAt: '2026-10-02T09:45:00.000Z' });
  const noQa = await Ops.restoreOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('rs'), expectedRevision: rootRow(h)!.revision, correctionRequestId: cReq });
  assert.equal(noQa.ok, false);
  if (!noQa.ok) assert.equal(noQa.code, 'completion_qa required');
  assert.equal(alloc(h, 501, A)?.done_units, 0); // юу ч commit-лэгдээгүй
  const ok = await Ops.restoreOwnProgress(ctxOf(h.d1), actorOf(A), {
    taskId: 501, requestId: uid('rs'), expectedRevision: rootRow(h)!.revision, correctionRequestId: cReq,
    completionQa: { done: 'x', issues: 'y', next: 'z' },
  });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  if (ok.ok) assert.equal(ok.data.reached_own_cap, true);
  assert.ok(rows<{ ended_at: string | null }>(h.sqlite, 'SELECT ended_at FROM task_timer_sessions WHERE id = ?', running)[0]!.ended_at);
});

test('seed хийсэн хуучин хэсгийн залруулга: хуучин оноо мөр рүү эсрэг мөр (анхны өдөр), шинэ оноо биш', async () => {
  const h = makeDb();
  legacyEntry(h.sqlite, { taskId: 501, userId: C, pct: 30, createdAt: '2026-09-20 09:00:00', points: { amount: 3, deltaPct: 3 } });
  const r = await Ops.applyAllocation(ctxOf(h.d1), actorOf(C), {
    taskId: 501, requestId: uid('split'), expectedRevision: 0, mode: 'total',
    targets: [{ userId: C, targetUnits: pt(50) }, { userId: B, targetUnits: pt(50) }],
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  const [seed] = openSlices(h, C);
  assert.equal(seed!.kind, 'seed');
  const c = await Ops.correctOwnProgress(ctxOf(h.d1), actorOf(C), { taskId: 501, requestId: uid('c'), expectedRevision: rootRow(h)!.revision, items: [{ sliceId: seed!.id }] });
  assert.equal(c.ok, true, JSON.stringify(c));
  const rev = rows<{ amount: number; awarded_at: string; reverses_points_id: number }>(
    h.sqlite,
    'SELECT amount, awarded_at, reverses_points_id FROM user_points WHERE reverses_points_id IS NOT NULL',
  );
  assert.equal(rev.length, 1);
  assert.equal(rev[0]!.awarded_at, '2026-09-20 09:00:00'); // хуучин мөрийн анхны өдөр
  assert.equal(rev[0]!.reverses_points_id, 1); // хуучин мөр
  assert.ok(Math.abs(pointsNet(h, C)) < 1e-9);
  assert.equal(alloc(h, 501, C)?.done_units, 0);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM user_points WHERE reverses_points_id IS NULL'), 1); // шинэ оноо үгүй
});

test('дууссан root-ийн залруулга төслийг (автомат архивласан) дахин нээнэ; гараар архивласан бол хаалттай', async () => {
  const h = makeDb();
  for (const t of [502, 503, 504]) h.sqlite.exec(`UPDATE tasks SET weight_percent = 0 WHERE id = ${t}`);
  h.sqlite.exec(`UPDATE tasks SET weight_percent = 100 WHERE id = 501`);
  const data = await splitAB(h, 501, 40, 60);
  for (const u of [A, B]) session(h.sqlite, { userId: u, taskId: 501, startedAt: T0, endedAt: '2026-10-02T09:30:00.000Z' });
  const qa = { done: 'a', issues: 'b', next: 'c' };
  await Ops.setOwnProgress(ctxOf(h.d1), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: data.root.revision, doneUnits: pt(40), completionQa: qa });
  await Ops.setOwnProgress(ctxOf(h.d1), actorOf(B), { taskId: 501, requestId: uid('p'), expectedRevision: rootRow(h)!.revision, doneUnits: pt(60), completionQa: qa });
  assert.equal(rows<{ status: string }>(h.sqlite, 'SELECT status FROM projects WHERE id = 10')[0]!.status, 'archived');
  const slices = openSlices(h, B);
  const c = await Ops.correctOwnProgress(ctxOf(h.d1), actorOf(B), { taskId: 501, requestId: uid('c'), expectedRevision: rootRow(h)!.revision, items: [{ sliceId: slices[0]!.id, units: pt(10) }] });
  assert.equal(c.ok, true, JSON.stringify(c));
  if (c.ok) assert.equal(c.data.reopened_root, true);
  const proj = rows<{ status: string; auto_archived_at: string | null }>(h.sqlite, 'SELECT status, auto_archived_at FROM projects WHERE id = 10')[0]!;
  assert.equal(proj.status, 'active');
  assert.equal(proj.auto_archived_at, null);
  assert.equal(rootRow(h)!.completed_at, null);
  // Гараар архивласан → залруулга хаалттай
  h.sqlite.exec(`UPDATE projects SET status = 'archived', auto_archived_at = NULL WHERE id = 10`);
  const blocked = await Ops.correctOwnProgress(ctxOf(h.d1), actorOf(B), { taskId: 501, requestId: uid('c'), expectedRevision: rootRow(h)!.revision, items: [{ sliceId: slices[0]!.id, units: pt(5) }] });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.code, 'PROJECT_INACTIVE');
});

test('залруулга идемпотент + stale + оноо нийлбэр (SUM) уншигчдад цэвэр нэтлэнэ', async () => {
  const h = makeDb();
  await aDid30Floor30(h);
  const [slice] = openSlices(h, A);
  const input = { taskId: 501, requestId: uid('c'), expectedRevision: rootRow(h)!.revision, items: [{ sliceId: slice!.id, units: pt(10) }] };
  const first = await Ops.correctOwnProgress(ctxOf(h.d1), actorOf(A), input);
  const again = await Ops.correctOwnProgress(ctxOf(h.d1), actorOf(A), input);
  assert.equal(first.ok && again.ok, true);
  if (first.ok && again.ok) {
    assert.equal(again.replayed, true);
    assert.deepEqual(again.data, first.data);
  }
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM user_points WHERE reverses_points_id IS NOT NULL'), 1); // нэг л удаа
  const stale = await Ops.correctOwnProgress(ctxOf(h.d1), actorOf(A), { ...input, requestId: uid('c') });
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.code, 'STALE_REVISION');
  // Тэргүүлэгчийн хүснэгтийн SUM(amount) цэвэр: 3 − 1 = 2
  assert.ok(Math.abs(sum(h.sqlite, 'SELECT SUM(amount) AS v FROM user_points WHERE user_id = ?', A) - 2) < 1e-9);
});
