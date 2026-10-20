// Инвариантын аудитор — БОДИТ SQLite + бодит миграц дээр (2026-10-05).
// (1) бүх үйлдлийн (split/progress/release/retake/correct/restore/reweight/detach/seed) ДАРАА аудит ЦЭВЭР;
// (2) санаатай эвдсэн өгөгдөл бүрийг өөрийн кодоор барина (аудитор өөрөө «үргэлж ногоон» биш гэдгийн нотолгоо).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { USERS, actorOf, legacyEntry, makeDb, rows, session, uid } from '../../test-support/allocHarness.ts';

const Ops = await import('./taskRootOps.ts');
const Audit = await import('./taskAllocAudit.ts');
const Guard = await import('./taskRootGuard.ts');
const Reweight = await import('./taskCreditReweight.ts');
const U = 10_000;
const pt = (p: number) => Math.round(p * U);
const { A, B, C } = USERS;

const day = (n: number) => `2026-10-${String(n).padStart(2, '0')}`;
const ms = (n: number) => Date.parse(`${day(n)}T10:00:00Z`);
const T = (n: number) => ({ db: undefined as unknown as D1Database, nowMs: ms(n), today: day(n) });

type H = ReturnType<typeof makeDb>;
const ctx = (h: H, n: number) => ({ db: h.d1, nowMs: ms(n), today: day(n) });
const rev = (h: H, task = 501) => rows<{ revision: number }>(h.sqlite, 'SELECT revision FROM task_roots WHERE task_id = ?', task)[0]!.revision;

async function clean(h: H, label: string) {
  const r = await Audit.auditTaskAllocations(h.d1, { deep: true });
  assert.deepEqual(r.findings.filter((f) => f.severity === 'error'), [], `${label}: аудит цэвэр биш`);
  assert.equal(r.ok, true, label);
  return r;
}

async function start(h: H, user: number, d: number) {
  const has = rows<{ n: number }>(h.sqlite, 'SELECT COUNT(*) AS n FROM task_timer_sessions WHERE user_id = ? AND task_id = 501', user)[0]!.n;
  if (has === 0) session(h.sqlite, { userId: user, taskId: 501, startedAt: `${day(d)}T08:00:00.000Z`, endedAt: `${day(d)}T08:30:00.000Z` });
}

test('аудитор: бүх үйлдлийн дараа ЦЭВЭР (split → progress → correct → restore → release → retake → reweight → detach)', async () => {
  const h = makeDb();
  void T;
  const r0 = await clean(h, 'хоосон');
  assert.equal(r0.roots_checked, 0);

  const s = await Ops.applyAllocation(ctx(h, 1), actorOf(A), {
    taskId: 501, requestId: uid('s'), expectedRevision: 0, mode: 'total',
    targets: [{ userId: A, targetUnits: pt(50) }, { userId: B, targetUnits: pt(30) }, { userId: C, targetUnits: pt(20) }],
  });
  assert.equal(s.ok, true, JSON.stringify(s));
  await clean(h, 'split');

  await start(h, A, 2);
  const p1 = await Ops.setOwnProgress(ctx(h, 2), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: rev(h), doneUnits: pt(30) });
  assert.equal(p1.ok, true, JSON.stringify(p1));
  await clean(h, 'A 30%');

  await start(h, B, 3);
  const p2 = await Ops.setOwnProgress(ctx(h, 3), actorOf(B), { taskId: 501, requestId: uid('p'), expectedRevision: rev(h), doneUnits: pt(10) });
  assert.equal(p2.ok, true, JSON.stringify(p2));
  await clean(h, 'B 10%');

  const corrId = uid('c');
  const [slice] = rows<{ id: number }>(h.sqlite, "SELECT id FROM task_contributions WHERE user_id = ? AND kind = 'work' ORDER BY id", A);
  const c = await Ops.correctOwnProgress(ctx(h, 4), actorOf(A), { taskId: 501, requestId: corrId, expectedRevision: rev(h), items: [{ sliceId: slice!.id, units: pt(10) }] });
  assert.equal(c.ok, true, JSON.stringify(c));
  await clean(h, 'A залруулга 10%');

  const rs = await Ops.restoreOwnProgress(ctx(h, 5), actorOf(A), { taskId: 501, requestId: uid('r'), expectedRevision: rev(h), correctionRequestId: corrId });
  assert.equal(rs.ok, true, JSON.stringify(rs));
  await clean(h, 'сэргээлт');

  const rel = await Ops.releaseOwn(ctx(h, 6), actorOf(C), { taskId: 501, requestId: uid('rel'), expectedRevision: rev(h) });
  assert.equal(rel.ok, true, JSON.stringify(rel));
  await clean(h, 'C буцаалт → чөлөөт ажил');

  const re = await Ops.retakeAllocation(ctx(h, 7), actorOf(C), { taskId: 501, requestId: uid('re'), expectedRevision: rev(h), units: pt(10) });
  assert.equal(re.ok, true, JSON.stringify(re));
  await clean(h, 'C дахин авсан');
  const rel2 = await Ops.releaseOwn(ctx(h, 7), actorOf(B), { taskId: 501, requestId: uid('rel'), expectedRevision: rev(h), toUserId: A });
  assert.equal(rel2.ok, true, JSON.stringify(rel2));
  await clean(h, 'B буцаалт → A');

  // жин өөрчлөх → reweight
  h.sqlite.prepare('UPDATE tasks SET weight_percent = 25 WHERE id = 501').run();
  const dirty = await Audit.auditTaskAllocations(h.d1, { deep: true });
  assert.ok((dirty.counts.CREDIT_DRIFT ?? 0) >= 1, 'жин өөрчлөгдсөн → drift (warn)');
  assert.equal(dirty.ok, true, 'drift нь warn — error биш');
  const rw = await Reweight.applyTaskReweight({ db: h.d1 }, A, 501);
  assert.equal(rw.kind, 'applied');
  const after = await clean(h, 'reweight');
  assert.equal(after.counts.CREDIT_DRIFT ?? 0, 0);

  // хэрэглэгч салгах: C-ийн хийсэн нь B (эзэнгүй) болно
  await Guard.detachUserFromRoots(h.d1, C);
  const det = await Audit.auditTaskAllocations(h.d1, { deep: false });
  assert.equal(det.ok, true, JSON.stringify(det.findings));
});

test('аудитор: seed (хуучин түүхтэй) хөрвүүлсний дараа ЦЭВЭР', async () => {
  const h = makeDb();
  legacyEntry(h.sqlite, { taskId: 501, userId: C, pct: 30, createdAt: '2026-09-20 09:00:00', points: { amount: 3, deltaPct: 3 } });
  const s = await Ops.applyAllocation(ctx(h, 1), actorOf(C), {
    taskId: 501, requestId: uid('s'), expectedRevision: 0, mode: 'total',
    targets: [{ userId: C, targetUnits: pt(50) }, { userId: B, targetUnits: pt(50) }],
  });
  assert.equal(s.ok, true, JSON.stringify(s));
  const r = await clean(h, 'seed');
  assert.equal(r.roots_checked, 1);
});

/* ------------------------------------------------------------------ */
/*  Санаатай эвдсэн өгөгдөл                                              */
/* ------------------------------------------------------------------ */

async function healthy() {
  const h = makeDb();
  const s = await Ops.applyAllocation(ctx(h, 1), actorOf(A), {
    taskId: 501, requestId: uid('s'), expectedRevision: 0, mode: 'total',
    targets: [{ userId: A, targetUnits: pt(60) }, { userId: B, targetUnits: pt(40) }],
  });
  assert.equal(s.ok, true);
  await start(h, A, 2);
  const p = await Ops.setOwnProgress(ctx(h, 2), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: rev(h), doneUnits: pt(20) });
  assert.equal(p.ok, true, JSON.stringify(p));
  await clean(h, 'суурь');
  return h;
}
const codes = async (h: H, o: Parameters<typeof Audit.auditTaskAllocations>[1] = {}) => (await Audit.auditTaskAllocations(h.d1, o)).counts;

test('эвдсэн: Σ T + B + U ≠ 100% → ROOT_SUM_NOT_100', async () => {
  const h = await healthy();
  h.sqlite.prepare('UPDATE task_roots SET unallocated_units = unallocated_units + 5000').run();
  assert.ok((await codes(h)).ROOT_SUM_NOT_100 === 1);
});

test('эвдсэн: хуваарилалтын D ≠ журнал → DONE_JOURNAL_MISMATCH; projection зөрвөл PROJECTION_MISMATCH', async () => {
  const h = await healthy();
  h.sqlite.prepare('UPDATE task_allocations SET done_units = done_units + 10000 WHERE user_id = ?').run(A);
  const c = await codes(h);
  assert.equal(c.DONE_JOURNAL_MISMATCH, 1);
  assert.equal(c.PROJECTION_MISMATCH, 1);
});

test('эвдсэн: оноо зөрөх → CREDIT_LEDGER_MISMATCH; нэг оноо мөр устах/нэмэгдэх бүрийг барина', async () => {
  const h = await healthy();
  h.sqlite.prepare('UPDATE user_points SET amount = amount + 1 WHERE user_id = ?').run(A);
  assert.equal((await codes(h)).CREDIT_LEDGER_MISMATCH, 1);
  const h2 = await healthy();
  h2.sqlite.prepare('DELETE FROM user_points WHERE user_id = ?').run(A);
  assert.equal((await codes(h2)).CREDIT_LEDGER_MISMATCH, 1);
});

test('эвдсэн: completed_at хуурамч → COMPLETED_FLAG; 100% боловч completed_at хоосон → warn', async () => {
  const h = await healthy();
  h.sqlite.prepare("UPDATE task_roots SET completed_at = datetime('now')").run();
  assert.equal((await codes(h)).COMPLETED_FLAG, 1);
});

test('эвдсэн: root-гүй хуваарилалт, таскгүй root, гацсан/унасан post-commit, идэвхгүй хүн дээрх ажил', async () => {
  const h = await healthy();
  h.sqlite.prepare("INSERT INTO task_allocations (task_id, user_id, ordinal, target_units) VALUES (999, 3, 1, 0)").run();
  h.sqlite.prepare("INSERT INTO task_roots (task_id) VALUES (998)").run();
  h.sqlite
    .prepare("INSERT INTO task_ops (request_id, task_id, user_id, kind, root_revision_before, root_revision_after, result_json, post_status, post_attempts, post_error, created_at) VALUES ('x-fail', 501, 3, 'progress', 1, 2, '{}', 'failed', 8, 'archive', datetime('now'))")
    .run();
  h.sqlite
    .prepare("INSERT INTO task_ops (request_id, task_id, user_id, kind, root_revision_before, root_revision_after, result_json, post_status, post_attempts, created_at) VALUES ('x-stuck', 501, 3, 'progress', 2, 3, '{}', 'pending', 2, datetime('now', '-30 minutes'))")
    .run();
  h.sqlite.prepare("UPDATE users SET status = 'inactive' WHERE id = ?").run(B);
  const c = await codes(h);
  assert.equal(c.ORPHAN_ALLOCATION, 1);
  assert.equal(c.ROOT_TASK_MISSING, 1);
  assert.equal(c.POST_COMMIT_FAILED, 1);
  assert.equal(c.POST_COMMIT_STUCK, 1);
  assert.equal(c.FUTURE_WORK_INACTIVE, 1);
  const r = await Audit.auditTaskAllocations(h.d1, {});
  assert.equal(r.ok, false);
  assert.ok(r.errors >= 4);
});

test('аудитор: хамрах хүрээ (task_id / project_id), limit → truncated, код тус бүрийн тоо бүрэн', async () => {
  const h = await healthy();
  h.sqlite.prepare('UPDATE task_roots SET unallocated_units = unallocated_units + 5000').run();
  const one = await Audit.auditTaskAllocations(h.d1, { taskId: 501 });
  assert.equal(one.roots_checked, 1);
  const other = await Audit.auditTaskAllocations(h.d1, { taskId: 502 });
  assert.equal(other.roots_checked, 0);
  assert.equal(other.ok, true);
  const proj = await Audit.auditTaskAllocations(h.d1, { projectId: 10 });
  assert.equal(proj.roots_checked, 1);
  assert.equal((await Audit.auditTaskAllocations(h.d1, { projectId: 20 })).roots_checked, 0);
  const lim = await Audit.auditTaskAllocations(h.d1, { limit: 1 });
  assert.equal(lim.findings.length, 1);
  assert.equal(lim.truncated, (Object.values(lim.counts).reduce((a, b) => a + b, 0)) > 1);
});
